// Small web server on this pc only (127.0.0.1), so the dashboard can hand over recordings.
// Only the dashboard's own addresses may talk to it (Origin check), never another website.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { UploadStart, WorkerHealth } from "../lib/youtube/protocol.ts";
import { isRenderFileName } from "../lib/youtube/render.ts";
import { safeMediaPath } from "../lib/dreamnest/steps.ts";
import { StoreError, type Store } from "./store.ts";

/**
 * One byte range from a Range header ("bytes=0-", "bytes=100-199", "bytes=-500"), as the video player asks for it.
 * null: no (usable) range, send the whole file; "invalid": outside the file (416).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return "invalid";
  return { start, end };
}

export type ServerOptions = {
  store: Store;
  allowedOrigins: string[];
  health: () => WorkerHealth;
  /** Folder with the montage previews (pakket 53); without it /renders does not exist. */
  rendersDir?: string;
  /** Called after a new recording arrived (local mode runs the intake, queue mode wakes the queue). */
  onReceived?: (fingerprint: string) => void;
  log?: (msg: string) => void;
  /** Dreamnest media on this pc (only with FEATURE_DREAMNEST); without it /dreamnest answers 404. */
  dreamnestDir?: string;
  /** YouTube connection (fase D1); without it the /youtube addresses answer 404. */
  youtube?: YouTubeRoutes;
};

/** What the server needs from the YouTube connection; index.ts wires it to worker/youtube.ts and Supabase. */
export type YouTubeRoutes = {
  connect: (channelRowId: string) => Promise<string>;
  /** Google sends the browser back here; returns the Dutch text for the page Milan sees. */
  callback: (query: URLSearchParams) => Promise<{ ok: boolean; message: string }>;
  /** channelRowId (fase 0.5): the status of that channel's own sign-in; without it the default channel. */
  status: (channelRowId?: string) => Promise<unknown>;
  disconnect: (channelRowId: string) => Promise<void>;
  /** Fase E: fetch the statistics now (the dashboard's "Nu verversen"). */
  refresh?: () => Promise<string | null>;
};

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** A small page in the browser tab where Google sent Milan back. */
export function callbackPage(ok: boolean, message: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube koppelen</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a}h1{font-size:1.25rem}p{line-height:1.5}.ok{color:#166534}.err{color:#991b1b}</style></head>
<body><h1 class="${ok ? "ok" : "err"}">${ok ? "YouTube is gekoppeld" : "Koppelen lukte niet"}</h1><p>${escapeHtml(message)}</p><p>Je kunt dit tabblad sluiten en teruggaan naar YouTube Studio.</p></body></html>`;
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new StoreError(413, "Verzoek te groot");
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new StoreError(400, "Ongeldig verzoek");
  }
}

export function createWorkerServer({ store, allowedOrigins, health, rendersDir, dreamnestDir, onReceived, youtube, log = () => {} }: ServerOptions) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };

    // Browsers always send Origin across sites; programs on this pc itself do not need it.
    if (origin && !allowedOrigins.includes(origin)) {
      log(`Geweigerd verzoek van ${origin}`);
      return send(403, { error: "Dit adres mag de werker niet gebruiken" });
    }
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET, HEAD, POST, PUT, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, range");
      res.setHeader("access-control-allow-private-network", "true");
      res.setHeader("access-control-max-age", "600");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") return send(200, health());
      if (req.method === "GET" && url.pathname === "/recordings") return send(200, await store.list());

      // Montage previews. The dashboard asks with crossorigin, so the Origin check above applies; without Origin no preview,
      // so another website cannot show Milan's footage by guessing an address.
      const sendFile = async (file: string, contentType: string) => {
        const info = await stat(file).catch(() => null);
        if (!info?.isFile()) return send(404, { error: "Deze preview staat niet (meer) op deze pc" });
        const range = parseRange(req.headers.range, info.size);
        const base = { "content-type": contentType, "accept-ranges": "bytes", "cache-control": "private, no-store", "access-control-expose-headers": "content-range, content-length, accept-ranges" };
        if (range === "invalid") {
          res.writeHead(416, { ...base, "content-range": `bytes */${info.size}` });
          return res.end();
        }
        const { start, end } = range ?? { start: 0, end: info.size - 1 };
        res.writeHead(range ? 206 : 200, { ...base, "content-length": String(end - start + 1), ...(range ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}) });
        if (req.method === "HEAD" || info.size === 0) return res.end();
        // The player often stops halfway a range (seeking); that is not an error.
        return void (await pipeline(createReadStream(file, { start, end }), res).catch(() => {}));
      };
      if ((req.method === "GET" || req.method === "HEAD") && parts[0] === "renders" && parts.length === 2 && rendersDir) {
        const name = decodeURIComponent(parts[1]);
        if (!origin) return send(403, { error: "Preview alleen via het dashboard" });
        if (!isRenderFileName(name)) return send(400, { error: "Ongeldige bestandsnaam" });
        return sendFile(join(rendersDir, name), name.endsWith(".jpg") ? "image/jpeg" : "video/mp4");
      }
      // Dreamnest keyframes, clips and previews: the same rules (Origin required), only media inside the Dreamnest folder.
      if ((req.method === "GET" || req.method === "HEAD") && parts[0] === "dreamnest" && parts.length > 1 && dreamnestDir) {
        const rel = parts.slice(1).map(decodeURIComponent).join("/");
        if (!origin) return send(403, { error: "Preview alleen via het dashboard" });
        if (!safeMediaPath(rel)) return send(400, { error: "Ongeldige bestandsnaam" });
        const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
        return sendFile(join(dreamnestDir, ...rel.split("/")), ext === "mp4" ? "video/mp4" : ext === "m4a" ? "audio/mp4" : ext === "png" ? "image/png" : "image/jpeg");
      }

      // YouTube connection. Starting, status and disconnecting only from the dashboard (Origin required),
      // so another program or website cannot start a sign-in. The callback is a plain page visit from Google:
      // it is only accepted with a state this worker handed out itself (single use, 10 minutes).
      if (youtube && req.method === "GET" && url.pathname === "/oauth/callback") {
        const { ok, message } = await youtube.callback(url.searchParams);
        log(ok ? `YouTube: ${message}` : `YouTube koppelen mislukt: ${message}`);
        res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "referrer-policy": "no-referrer" });
        return res.end(callbackPage(ok, message));
      }
      if (youtube && parts[0] === "youtube" && parts.length === 2) {
        if (!origin) return send(403, { error: "Alleen via het dashboard" });
        if (req.method === "GET" && parts[1] === "status") {
          const ch = url.searchParams.get("channel");
          return send(200, await youtube.status(isUuid(ch) ? ch : undefined));
        }
        if (req.method === "POST" && parts[1] === "refresh" && youtube.refresh) return send(200, { message: await youtube.refresh() });
        if (req.method === "POST" && (parts[1] === "connect" || parts[1] === "disconnect")) {
          const body = (await readJson(req)) as { channelId?: unknown };
          if (!isUuid(body.channelId)) throw new StoreError(400, "Onbekend kanaal");
          if (parts[1] === "connect") return send(200, { url: await youtube.connect(body.channelId) });
          await youtube.disconnect(body.channelId);
          return send(200, { ok: true });
        }
      }

      if (parts[0] === "uploads") {
        if (req.method === "POST" && parts.length === 1) {
          const body = (await readJson(req)) as Partial<UploadStart>;
          const input: UploadStart = {
            fingerprint: String(body.fingerprint ?? ""),
            size: Number(body.size),
            name: String(body.name ?? ""),
            label: String(body.label ?? ""),
            isTest: body.isTest === true,
          };
          return send(200, await store.start(input));
        }
        const fp = parts[1] ?? "";
        if (req.method === "PUT" && parts.length === 2) {
          const offset = Number(url.searchParams.get("offset"));
          const length = Number(req.headers["content-length"]);
          if (!Number.isSafeInteger(offset) || offset < 0) throw new StoreError(400, "Ongeldige positie");
          return send(200, { received: await store.append(fp, offset, length, req) });
        }
        if (req.method === "POST" && parts.length === 3 && parts[2] === "complete") {
          const result = await store.complete(fp);
          if (!result.duplicateOf) {
            log(`Opname ontvangen: ${result.recording.label} (${result.recording.size} bytes)`);
            onReceived?.(fp);
          }
          return send(200, result);
        }
      }
      return send(404, { error: "Onbekend adres" });
    } catch (e) {
      req.resume(); // drain an unread upload piece, so the browser receives the answer
      if (e instanceof StoreError) return send(e.status, { error: e.message, received: e.received });
      // Paused or connection lost: what arrived is kept and the next attempt continues from there.
      if (req.destroyed || (e as NodeJS.ErrnoException).code === "ECONNRESET") return log("Upload onderbroken; hij kan later verder.");
      log(`Fout: ${e instanceof Error ? e.stack : String(e)}`);
      if (!res.headersSent) send(500, { error: "Er ging iets mis in de werker" });
    }
  });
}

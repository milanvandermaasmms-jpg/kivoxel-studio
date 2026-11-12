// Resumable upload to YouTube (fase D3). Protocol: developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// (read 12-11-2026). The session address works like a key, so it stays on this pc (never in Supabase).
// No double uploads: an earlier session is always asked first how far it got; an expired session is only replaced
// after the channel's upload list shows the video is not there.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { YouTube } from "./youtube.ts";

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
/** Pieces must be a multiple of 256 KiB; 8 MiB keeps progress lively without many requests. */
export const CHUNK = 32 * 256 * 1024;

export type UploadMeta = {
  title: string;
  description: string;
  tags: string[];
  category_id: string;
  language: "en" | "nl";
  made_for_kids: boolean;
  contains_synthetic_media: boolean;
  /** Fase D4: private (optionally with publish_at), unlisted or public. Without it: private. */
  visibility?: "private" | "unlisted" | "public";
  publish_at?: string | null;
};
type StatusMeta = Pick<UploadMeta, "made_for_kids" | "contains_synthetic_media" | "visibility" | "publish_at">;

/** The status part. publishAt only with private: YouTube itself makes the video public at that moment. */
export function statusPart(m: StatusMeta) {
  const visibility = m.visibility ?? "private";
  if (m.publish_at && visibility !== "private") throw new Error("Inplannen kan alleen privé");
  return { privacyStatus: visibility, ...(m.publish_at ? { publishAt: new Date(m.publish_at).toISOString() } : {}), selfDeclaredMadeForKids: m.made_for_kids, containsSyntheticMedia: m.contains_synthetic_media };
}

/** The video resource for videos.insert. */
export function videoResource(m: UploadMeta) {
  return {
    snippet: { title: m.title, description: m.description, tags: m.tags, categoryId: m.category_id, defaultLanguage: m.language, defaultAudioLanguage: m.language },
    status: statusPart(m),
  };
}

/** "bytes=0-524287" -> next byte to send (524288); no header -> 0. */
export function nextByte(range: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

export type Processing = { uploadStatus: string; processingStatus: string | null; privacyStatus: string | null; reason: string | null };
export type UploadResult = { videoId: string; resumed: boolean; adopted: boolean; bytes: number };
type Session = { uri: string; size: number; startedAt: string; metaHash: string };
type Fetch = typeof fetch;

class Expired extends Error {}
class Retryable extends Error {}

export function createUploader(o: { yt: YouTube; sessionDir: string; fetch?: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; chunk?: number }) {
  const http = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const chunk = o.chunk ?? CHUNK;
  const sessionFile = (key: string) => join(o.sessionDir, `${key.replace(/[^A-Za-z0-9-]/g, "")}.json`);

  async function readSession(key: string): Promise<Session | null> {
    try {
      return JSON.parse(await readFile(sessionFile(key), "utf8")) as Session;
    } catch {
      return null;
    }
  }
  const auth = async () => ({ authorization: `Bearer ${await o.yt.accessToken()}` });

  /** Asks YouTube how much of a session arrived: a number (next byte), a finished video ID, or Expired. */
  async function query(s: Session): Promise<number | { id: string }> {
    const res = await http(s.uri, { method: "PUT", headers: { ...(await auth()), "content-range": `bytes */${s.size}`, "content-length": "0" } });
    if (res.status === 308) return nextByte(res.headers.get("range"));
    if (res.status === 200 || res.status === 201) return { id: String(((await res.json()) as { id?: string }).id) };
    if (res.status === 404 || res.status === 410) throw new Expired("De uploadsessie is verlopen");
    throw new Retryable(`YouTube antwoordde ${res.status} op de voortgangsvraag`);
  }

  /** Looks in the channel's own upload list for a video with this title since the session started (2 units). */
  async function findRecent(title: string, since: string): Promise<string | null> {
    const headers = await auth();
    await o.yt.spend("channels.list");
    const ch = (await (await http(`${API}/channels?part=contentDetails&mine=true`, { headers })).json()) as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] };
    const list = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!list) return null;
    await o.yt.spend("playlistItems.list");
    const items = (await (await http(`${API}/playlistItems?part=snippet&maxResults=25&playlistId=${encodeURIComponent(list)}`, { headers })).json()) as { items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[] };
    const hit = items.items?.find((i) => i.snippet?.title === title && (i.snippet?.publishedAt ?? "") >= since);
    return hit?.snippet?.resourceId?.videoId ?? null;
  }

  async function start(key: string, file: string, size: number, meta: UploadMeta, metaHash: string): Promise<Session> {
    await o.yt.spend("videos.insert", true);
    const res = await http(UPLOAD_URL, {
      method: "POST",
      headers: { ...(await auth()), "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(size), "x-upload-content-type": "video/mp4" },
      body: JSON.stringify(videoResource(meta)),
    });
    const uri = res.headers.get("location");
    if (!res.ok || !uri) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") throw new Error("YouTube-quotum of uploadlimiet voor vandaag is op; morgen weer.");
      throw new Error(`YouTube weigerde de upload te starten: ${body.error?.message ?? res.status}`);
    }
    const s: Session = { uri, size, startedAt: new Date(now()).toISOString(), metaHash };
    await mkdir(o.sessionDir, { recursive: true });
    await writeFile(sessionFile(key), JSON.stringify(s), "utf8");
    return s;
  }

  async function sendFrom(s: Session, file: string, from: number, signal: AbortSignal, onProgress: (sent: number, total: number) => void): Promise<{ id: string }> {
    const fh = await open(file, "r");
    try {
      let pos = from;
      for (;;) {
        if (signal.aborted) throw new DOMException("Geannuleerd", "AbortError");
        const end = Math.min(pos + chunk, s.size) - 1;
        const buf = Buffer.alloc(end - pos + 1);
        await fh.read(buf, 0, buf.length, pos);
        let res: Response;
        try {
          res = await http(s.uri, { method: "PUT", headers: { ...(await auth()), "content-length": String(buf.length), "content-range": `bytes ${pos}-${end}/${s.size}` }, body: buf, signal });
        } catch (e) {
          if (signal.aborted) throw e;
          throw new Retryable(`Verbinding verbroken: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (res.status === 308) {
          pos = nextByte(res.headers.get("range"));
          onProgress(pos, s.size);
          continue;
        }
        if (res.status === 200 || res.status === 201) {
          onProgress(s.size, s.size);
          return { id: String(((await res.json()) as { id?: string }).id) };
        }
        if (res.status === 404 || res.status === 410) throw new Expired("De uploadsessie is verlopen");
        if (res.status >= 500 || res.status === 429) throw new Retryable(`YouTube antwoordde ${res.status}`);
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`YouTube weigerde de upload: ${body.error?.message ?? res.status}`);
      }
    } finally {
      await fh.close();
    }
  }

  return {
    /**
     * Uploads one file for one publication (key). Resumes an unfinished session, adopts a finished one, and only
     * starts a new session after checking the channel. Returns the YouTube video ID.
     */
    async upload(a: { key: string; file: string; meta: UploadMeta; signal: AbortSignal; onProgress: (sent: number, total: number) => void; onEvent: (message: string) => Promise<void> | void }): Promise<UploadResult> {
      if (!existsSync(a.file)) throw new Error("De montage staat niet (meer) op deze pc. Maak de montage opnieuw.");
      const size = (await stat(a.file)).size;
      const metaHash = createHash("sha256").update(JSON.stringify(videoResource(a.meta))).update(String(size)).digest("hex");
      let s = await readSession(a.key);
      let resumed = false;
      let from = 0;
      const prev = s;
      if (prev) {
        try {
          const r = await query(prev);
          if (typeof r === "object") {
            await rm(sessionFile(a.key), { force: true });
            await a.onEvent("Deze upload was al klaar bij YouTube; het video-ID is overgenomen (geen tweede upload)");
            return { videoId: r.id, resumed: true, adopted: true, bytes: prev.size };
          }
          if (prev.metaHash === metaHash) {
            from = r;
            resumed = true;
            await a.onEvent(`Verder met de upload vanaf ${(r / 1048576).toFixed(1)} MB`);
          } else {
            await a.onEvent("Titel, tekst of montage is gewijzigd: de onafgemaakte upload wordt niet afgemaakt, er start een nieuwe");
            s = null;
          }
        } catch (e) {
          if (!(e instanceof Expired)) throw e;
          const found = await findRecent(a.meta.title, prev.startedAt);
          await rm(sessionFile(a.key), { force: true });
          if (found) {
            await a.onEvent("De video stond al in de uploadlijst van het kanaal; die wordt gebruikt (geen tweede upload)");
            return { videoId: found, resumed: true, adopted: true, bytes: prev.size };
          }
          await a.onEvent("De vorige uploadsessie was verlopen en de video staat niet op het kanaal; er start een nieuwe");
          s = null;
        }
      }
      if (!s) s = await start(a.key, a.file, size, a.meta, metaHash);
      a.onProgress(from, size);

      for (let attempt = 0; ; attempt++) {
        try {
          const done = await sendFrom(s, a.file, from, a.signal, a.onProgress);
          await rm(sessionFile(a.key), { force: true });
          return { videoId: done.id, resumed, adopted: false, bytes: size };
        } catch (e) {
          if (a.signal.aborted) throw e;
          if (e instanceof Expired) {
            // Keep the session file: the next attempt checks the upload list before starting again.
            throw new Error("De uploadsessie bij YouTube is verlopen; de volgende poging kijkt eerst of de video er al staat");
          }
          if (!(e instanceof Retryable) || attempt >= 5) throw e;
          const wait = Math.min(60_000, 1000 * 2 ** attempt);
          await a.onEvent(`${e.message}; opnieuw proberen over ${Math.round(wait / 1000)} s (poging ${attempt + 2})`);
          await sleep(wait);
          const r = await query(s).catch((q) => {
            if (q instanceof Expired) throw new Error("De uploadsessie bij YouTube is verlopen; de volgende poging kijkt eerst of de video er al staat");
            return from;
          });
          if (typeof r === "object") {
            await rm(sessionFile(a.key), { force: true });
            return { videoId: r.id, resumed: true, adopted: false, bytes: size };
          }
          from = r;
          resumed = true;
        }
      }
    },

    /**
     * Changes only the visibility of a video already on YouTube (videos.update part=status, 50 units).
     * The whole status part is sent, so audience and AI notice stay as Milan chose them.
     */
    async setStatus(videoId: string, m: StatusMeta): Promise<void> {
      const status = statusPart(m);
      await o.yt.spend("videos.update");
      const res = await http(`${API}/videos?part=status`, { method: "PUT", headers: { ...(await auth()), "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify({ id: videoId, status }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`YouTube weigerde de wijziging: ${body.error?.message ?? res.status}`);
      }
    },

    /**
     * Uploads a caption track (captions.insert, 400 units; scope youtube.force-ssl). Returns the track ID.
     * Multipart: the snippet as JSON, then the SRT file.
     */
    async insertCaption(videoId: string, language: string, srt: string): Promise<string> {
      await o.yt.spend("captions.insert");
      const boundary = `kivoxel${Date.now().toString(36)}`;
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify({ snippet: { videoId, language, name: "", isDraft: false } }),
        `--${boundary}`,
        "Content-Type: application/octet-stream",
        "",
        srt,
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const res = await http(`${UPLOAD_BASE}/captions?part=snippet&uploadType=multipart`, { method: "POST", headers: { ...(await auth()), "content-type": `multipart/related; boundary=${boundary}` }, body });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !json.id) throw new Error(`YouTube weigerde de ondertitels: ${json.error?.message ?? res.status}`);
      return json.id;
    },

    /** Sets a custom thumbnail (thumbnails.set, 50 units). A 403 means the channel may not use custom thumbnails yet. */
    async setThumbnail(videoId: string, jpeg: Buffer): Promise<void> {
      await o.yt.spend("thumbnails.set");
      const res = await http(`${UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, { method: "POST", headers: { ...(await auth()), "content-type": "image/jpeg", "content-length": String(jpeg.length) }, body: new Uint8Array(jpeg) });
      if (res.status === 403) throw new Error("YouTube staat eigen thumbnails voor dit kanaal nog niet toe. Verifieer het kanaal eenmalig via https://www.youtube.com/verify en probeer het daarna opnieuw.");
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`YouTube weigerde de thumbnail: ${json.error?.message ?? res.status}`);
      }
    },

    /** Processing state after the upload (videos.list, 1 unit). */
    async processing(videoId: string): Promise<Processing> {
      await o.yt.spend("videos.list");
      const res = await http(`${API}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { headers: await auth() });
      const json = (await res.json().catch(() => ({}))) as { items?: { status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string }; processingDetails?: { processingStatus?: string; processingFailureReason?: string } }[] };
      const item = json.items?.[0];
      if (!item) return { uploadStatus: "missing", processingStatus: null, privacyStatus: null, reason: "YouTube vindt deze video niet (verwijderd?)" };
      return {
        uploadStatus: item.status?.uploadStatus ?? "unknown",
        processingStatus: item.processingDetails?.processingStatus ?? null,
        privacyStatus: item.status?.privacyStatus ?? null,
        reason: item.status?.rejectionReason ?? item.status?.failureReason ?? item.processingDetails?.processingFailureReason ?? null,
      };
    },
  };
}
export type Uploader = ReturnType<typeof createUploader>;

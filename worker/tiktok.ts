// 24-11-2026 (Milan: "alle shorts die voor youtube bestemd zijn moeten ook op TikTok"): the TikTok connection, on this pc.
// Like YouTube: sign in with TikTok (OAuth 2.0 + PKCE), tokens and the app's own keys encrypted on this pc only, never in
// the browser, Supabase or Git. Shorts go to Milan's TikTok INBOX as a draft (Content Posting API, "upload"): he opens
// the TikTok app and publishes with one tap, so publishing stays his click. TikTok only allows an https return address,
// so TikTok sends Milan to the studio's own public page (/kivoxel/tiktok), which hands the code to this worker.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import { dirname } from "node:path";
import { decrypt, encrypt, pkce } from "./youtube.ts";

export const TT_SCOPES = ["user.info.basic", "video.upload"];
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const MB = 1024 * 1024;

type Fetch = typeof fetch;
type App = { clientKey: string; clientSecret: string; savedAt: string };
type Tokens = { access_token: string; refresh_token: string; expires_at: number; refresh_expires_at: number; open_id: string; scope: string; username: string | null; display_name: string | null; consented_at: string };
export type TikTokStatus = { configured: boolean; connected: boolean; username: string | null; displayName: string | null; scopes: string[]; consentedAt: string | null; redirectUri: string };

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** TikTok's chunk rules: one piece up to 64 MB; above that pieces of 10 MB, the last one takes the rest. Pure, tested. */
export function chunkPlan(size: number): { chunkSize: number; count: number; ranges: { start: number; end: number }[] } {
  if (size <= 64 * MB) return { chunkSize: size, count: 1, ranges: [{ start: 0, end: size - 1 }] };
  const chunkSize = 10 * MB;
  const count = Math.floor(size / chunkSize);
  const ranges = Array.from({ length: count }, (_, i) => ({ start: i * chunkSize, end: i === count - 1 ? size - 1 : (i + 1) * chunkSize - 1 }));
  return { chunkSize, count, ranges };
}

export function tiktokAuthUrl(o: { clientKey: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({ client_key: o.clientKey, scope: TT_SCOPES.join(","), response_type: "code", redirect_uri: o.redirectUri, state: o.state, code_challenge: o.challenge, code_challenge_method: "S256" });
  return `${AUTH_URL}?${q.toString()}`;
}

export function createTikTok(o: { key: Buffer; appFile: string; tokenFile: string; redirectUri: string; fetch?: Fetch; now?: () => number }) {
  const http = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const pending = new Map<string, { verifier: string; createdAt: number }>();

  async function readEnc<T>(file: string): Promise<T | null> {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(decrypt(o.key, await readFile(file, "utf8"))) as T;
    } catch {
      return null;
    }
  }
  async function writeEnc(file: string, value: unknown) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, encrypt(o.key, JSON.stringify(value)), "utf8");
    await rename(`${file}.tmp`, file);
  }
  const app = () => readEnc<App>(o.appFile);
  const load = () => readEnc<Tokens>(o.tokenFile);

  async function tokenRequest(body: Record<string, string>) {
    const res = await http(`${API}/oauth/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body: new URLSearchParams(body).toString() });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.error) throw new Error(`TikTok weigerde het inloggen: ${String(json.error ?? res.status)}${json.error_description ? ` (${String(json.error_description)})` : ""}`);
    return json;
  }

  async function accessToken(): Promise<string> {
    const t = await load();
    const a = await app();
    if (!t || !a) throw new Error("TikTok is niet gekoppeld");
    if (t.expires_at - now() > 60_000) return t.access_token;
    if (t.refresh_expires_at <= now()) throw new Error("De TikTok-koppeling is verlopen (na een jaar): koppel opnieuw");
    const json = await tokenRequest({ client_key: a.clientKey, client_secret: a.clientSecret, grant_type: "refresh_token", refresh_token: t.refresh_token });
    const next: Tokens = { ...t, access_token: String(json.access_token), refresh_token: String(json.refresh_token ?? t.refresh_token), expires_at: now() + Number(json.expires_in ?? 86_400) * 1000, refresh_expires_at: now() + Number(json.refresh_expires_in ?? 31_536_000) * 1000 };
    await writeEnc(o.tokenFile, next);
    return next.access_token;
  }

  async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = await accessToken();
    const res = await http(`${API}${path}`, { method: init.method ?? "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code?: string; message?: string } };
    if (!res.ok || (json.error?.code && json.error.code !== "ok")) throw new Error(`TikTok gaf een fout: ${json.error?.code ?? res.status}${json.error?.message ? ` (${json.error.message})` : ""}`);
    return json.data as T;
  }

  async function userInfo() {
    const d = await api<{ user?: { open_id?: string; username?: string; display_name?: string } }>("/user/info/?fields=open_id,username,display_name", { method: "GET" });
    return { username: d.user?.username ?? null, displayName: d.user?.display_name ?? null };
  }

  return {
    /** The app keys from TikTok for Developers, stored encrypted (they never pass through the chat or Git). */
    async setApp(clientKey: string, clientSecret: string) {
      if (!/^[A-Za-z0-9]{8,64}$/.test(clientKey) || !/^[A-Za-z0-9_-]{16,128}$/.test(clientSecret)) throw new Error("Dit lijken geen TikTok-app-sleutels");
      await writeEnc(o.appFile, { clientKey, clientSecret, savedAt: new Date(now()).toISOString() } satisfies App);
    },
    async start(): Promise<string> {
      const a = await app();
      if (!a) throw new Error("TikTok is nog niet ingesteld: de app-sleutels ontbreken");
      for (const [s, p] of pending) if (now() - p.createdAt > 10 * 60_000) pending.delete(s);
      const state = b64url(randomBytes(24));
      const { verifier, challenge } = pkce();
      pending.set(state, { verifier, createdAt: now() });
      return tiktokAuthUrl({ clientKey: a.clientKey, redirectUri: o.redirectUri, state, challenge });
    },
    async callback(query: URLSearchParams): Promise<{ username: string | null }> {
      const state = query.get("state") ?? "";
      const p = pending.get(state);
      pending.delete(state);
      if (!p || now() - p.createdAt > 10 * 60_000) throw new Error("Deze koppeling is verlopen of niet door deze werker gestart. Klik in de studio opnieuw op TikTok koppelen.");
      if (query.get("error")) throw new Error(query.get("error") === "access_denied" ? "Je hebt geen toestemming gegeven." : `TikTok meldde: ${query.get("error")}`);
      const a = (await app())!;
      const json = await tokenRequest({ client_key: a.clientKey, client_secret: a.clientSecret, code: query.get("code") ?? "", grant_type: "authorization_code", redirect_uri: o.redirectUri, code_verifier: p.verifier });
      const granted = String(json.scope ?? "").split(",");
      const missing = TT_SCOPES.filter((s) => !granted.includes(s));
      if (missing.length) throw new Error(`Niet alle toestemmingen gegeven (${missing.join(", ")}). Koppel opnieuw en sta alles toe.`);
      await writeEnc(o.tokenFile, { access_token: String(json.access_token), refresh_token: String(json.refresh_token), expires_at: now() + Number(json.expires_in ?? 86_400) * 1000, refresh_expires_at: now() + Number(json.refresh_expires_in ?? 31_536_000) * 1000, open_id: String(json.open_id ?? ""), scope: String(json.scope ?? ""), username: null, display_name: null, consented_at: new Date(now()).toISOString() } satisfies Tokens);
      const u = await userInfo().catch(() => ({ username: null, displayName: null }));
      const t = (await load())!;
      await writeEnc(o.tokenFile, { ...t, username: u.username, display_name: u.displayName });
      return { username: u.username };
    },
    async status(): Promise<TikTokStatus> {
      const t = await load();
      return { configured: !!(await app()), connected: !!t, username: t?.username ?? null, displayName: t?.display_name ?? null, scopes: t ? t.scope.split(",").filter(Boolean) : [], consentedAt: t?.consented_at ?? null, redirectUri: o.redirectUri };
    },
    /** Puts a video in Milan's TikTok inbox as a draft. Returns TikTok's publish_id. */
    async toInbox(file: string, onProgress?: (sent: number, total: number) => void): Promise<string> {
      const size = (await stat(file)).size;
      const plan = chunkPlan(size);
      const init = await api<{ publish_id: string; upload_url: string }>("/post/publish/inbox/video/init/", { body: { source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count } } });
      const fh = await open(file, "r");
      try {
        for (const r of plan.ranges) {
          const buf = Buffer.alloc(r.end - r.start + 1);
          await fh.read(buf, 0, buf.length, r.start);
          const res = await http(init.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(buf.length), "content-range": `bytes ${r.start}-${r.end}/${size}` }, body: buf });
          if (!res.ok && res.status !== 206) throw new Error(`TikTok nam het stuk ${r.start}-${r.end} niet aan (${res.status})`);
          onProgress?.(r.end + 1, size);
        }
      } finally {
        await fh.close();
      }
      return init.publish_id;
    },
    async publishStatus(publishId: string): Promise<{ status: string; reason: string | null }> {
      const d = await api<{ status?: string; fail_reason?: string }>("/post/publish/status/fetch/", { body: { publish_id: publishId } });
      return { status: d.status ?? "UNKNOWN", reason: d.fail_reason ?? null };
    },
    async disconnect(): Promise<void> {
      const t = await load();
      const a = await app();
      if (t && a) await http(`${API}/oauth/revoke/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_key: a.clientKey, client_secret: a.clientSecret, token: t.access_token }).toString() }).catch(() => undefined);
      await rm(o.tokenFile, { force: true });
    },
  };
}
export type TikTok = ReturnType<typeof createTikTok>;

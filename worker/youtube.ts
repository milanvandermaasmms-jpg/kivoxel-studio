// YouTube connection (fase D1). The worker on Milan's pc does the sign-in (OAuth 2.0 for desktop apps, loopback + PKCE)
// and keeps the tokens encrypted on this pc only: never in the browser, never in Supabase (2.2 chapter 17).
// Sources (12-11-2026): docs/youtube-koppeling.md.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

/** Only what is needed: uploading and managing our own videos (fase D), and reading statistics (fase E). No revenue. */
export const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"];
export const SCOPE_LABEL: Record<string, string> = {
  "https://www.googleapis.com/auth/youtube.upload": "Video's uploaden naar je kanaal",
  "https://www.googleapis.com/auth/youtube.force-ssl": "Je eigen video's beheren: titel, beschrijving, ondertitels en thumbnail",
  "https://www.googleapis.com/auth/yt-analytics.readonly": "Statistieken van je kanaal bekijken (alleen lezen)",
};
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE: a random verifier and its SHA-256 challenge (RFC 7636, S256). */
export function pkce(random = randomBytes(32)): { verifier: string; challenge: string } {
  const verifier = b64url(random);
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** The Google sign-in address. offline + consent: Google returns a refresh token, so one sign-in is enough. */
export function authUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string; scopes?: string[] }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: (o.scopes ?? YT_SCOPES).join(" "),
    access_type: "offline",
    prompt: "consent",
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** AES-256-GCM with a 32-byte key: iv (12) + tag (16) + ciphertext, as base64. */
export function encrypt(key: Buffer, text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function decrypt(key: Buffer, data: string): string {
  const raw = Buffer.from(data, "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** Quota resets at midnight Pacific Time; the day key follows that clock. */
export const quotaDay = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
/** Costs in units (determine_quota_cost, 12-11-2026). Uploads have their own bucket of 100 per day. */
export const QUOTA_COST: Record<string, number> = { "channels.list": 1, "videos.list": 1, "playlistItems.list": 1, "videos.update": 50, "thumbnails.set": 50, "captions.insert": 400, "search.list": 100 };
export const QUOTA_DAILY = 10_000;
export const UPLOADS_DAILY = 100;

export type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope: string; consented_at: string; channel_id: string | null };
export type ChannelInfo = { id: string; title: string; thumbnail: string | null };
export type YouTubeStatus = { configured: boolean; connected: boolean; channelId: string | null; consentedAt: string | null; scopes: string[]; quota: { day: string; units: number; uploads: number; limitUnits: number; limitUploads: number } };

type Fetch = typeof fetch;
type Pending = { verifier: string; channelRowId: string; createdAt: number };

export function createYouTube(o: { clientId?: string; clientSecret?: string; redirectUri: string; key: Buffer; tokenFile: string; quotaFile: string; fetch?: Fetch; now?: () => number }) {
  const http = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const configured = !!(o.clientId && o.clientSecret);
  const pending = new Map<string, Pending>();

  async function load(): Promise<Tokens | null> {
    if (!existsSync(o.tokenFile)) return null;
    try {
      return JSON.parse(decrypt(o.key, await readFile(o.tokenFile, "utf8"))) as Tokens;
    } catch {
      return null; // wrong key or damaged file: treat as not connected, Milan connects again
    }
  }
  async function save(t: Tokens) {
    const tmp = `${o.tokenFile}.tmp`;
    await writeFile(tmp, encrypt(o.key, JSON.stringify(t)), "utf8");
    await rename(tmp, o.tokenFile);
  }

  async function readQuota() {
    const day = quotaDay(new Date(now()));
    try {
      const q = JSON.parse(await readFile(o.quotaFile, "utf8")) as { day: string; units: number; uploads: number };
      if (q.day === day) return q;
    } catch {
      /* no file yet */
    }
    return { day, units: 0, uploads: 0 };
  }
  /** Counts quota before a call; refuses cleanly when the day budget would be exceeded. */
  async function spend(call: string, upload = false) {
    const q = await readQuota();
    const cost = upload ? 0 : (QUOTA_COST[call] ?? 1);
    if (upload ? q.uploads + 1 > UPLOADS_DAILY : q.units + cost > QUOTA_DAILY) throw new Error(`YouTube-quotum voor vandaag is op (${upload ? `${q.uploads} van ${UPLOADS_DAILY} uploads` : `${q.units} van ${QUOTA_DAILY} eenheden`}); morgen (Pacific-tijd) weer beschikbaar`);
    await writeFile(o.quotaFile, JSON.stringify({ day: q.day, units: q.units + cost, uploads: q.uploads + (upload ? 1 : 0) }), "utf8");
  }

  async function tokenRequest(body: Record<string, string>) {
    const res = await http(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Google weigerde het inloggen: ${String(json.error ?? res.status)}${json.error_description ? ` (${String(json.error_description)})` : ""}`);
    return json;
  }

  /** A valid access token, refreshed when it (almost) expired. */
  async function accessToken(): Promise<string> {
    const t = await load();
    if (!t) throw new Error("YouTube is niet gekoppeld");
    if (t.expires_at - now() > 60_000) return t.access_token;
    const json = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: o.clientId!, client_secret: o.clientSecret! });
    const next = { ...t, access_token: String(json.access_token), expires_at: now() + Number(json.expires_in ?? 3600) * 1000 };
    await save(next);
    return next.access_token;
  }

  /** The channel of the signed-in account (channels.list mine=true, 1 unit). */
  async function myChannel(): Promise<ChannelInfo> {
    const token = await accessToken();
    await spend("channels.list");
    const res = await http(`${API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as { items?: { id: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`YouTube gaf een fout: ${json.error?.message ?? res.status}`);
    const item = json.items?.[0];
    if (!item) throw new Error("Dit Google-account heeft geen YouTube-kanaal. Log in met het account van Kivoxel.");
    const thumbs = item.snippet?.thumbnails ?? {};
    return { id: item.id, title: item.snippet?.title ?? item.id, thumbnail: thumbs.medium?.url ?? thumbs.default?.url ?? null };
  }

  return {
    configured,
    /** Step 1: the sign-in address for the channel row in Supabase that should be linked. */
    start(channelRowId: string): string {
      if (!configured) throw new Error("YouTube is nog niet ingesteld: YOUTUBE_CLIENT_ID en YOUTUBE_CLIENT_SECRET ontbreken in worker/.env.local");
      for (const [s, p] of pending) if (now() - p.createdAt > 10 * 60_000) pending.delete(s);
      const state = b64url(randomBytes(24));
      const { verifier, challenge } = pkce();
      pending.set(state, { verifier, channelRowId, createdAt: now() });
      return authUrl({ clientId: o.clientId!, redirectUri: o.redirectUri, state, challenge });
    },
    /** Step 2: Google sends Milan back here. The state must match a sign-in this worker started (single use). */
    async callback(query: URLSearchParams): Promise<{ channelRowId: string; channel: ChannelInfo }> {
      const state = query.get("state") ?? "";
      const p = pending.get(state);
      pending.delete(state);
      if (!p || now() - p.createdAt > 10 * 60_000) throw new Error("Deze koppeling is verlopen of niet door deze werker gestart. Klik in het dashboard opnieuw op YouTube koppelen.");
      if (query.get("error")) throw new Error(query.get("error") === "access_denied" ? "Je hebt geen toestemming gegeven, of dit account staat niet als testgebruiker in Google Cloud." : `Google meldde: ${query.get("error")}`);
      const json = await tokenRequest({ grant_type: "authorization_code", code: query.get("code") ?? "", redirect_uri: o.redirectUri, client_id: o.clientId!, client_secret: o.clientSecret!, code_verifier: p.verifier });
      if (!json.refresh_token) throw new Error("Google gaf geen vernieuwingssleutel terug. Haal Kivoxel Studio weg bij https://myaccount.google.com/permissions en koppel opnieuw.");
      const granted = String(json.scope ?? "").split(" ");
      const missing = YT_SCOPES.filter((s) => !granted.includes(s));
      if (missing.length) throw new Error(`Niet alle toestemmingen gegeven (${missing.map((s) => SCOPE_LABEL[s]).join(", ")}). Koppel opnieuw en vink alles aan.`);
      await save({ access_token: String(json.access_token), refresh_token: String(json.refresh_token), expires_at: now() + Number(json.expires_in ?? 3600) * 1000, scope: String(json.scope ?? ""), consented_at: new Date(now()).toISOString(), channel_id: null });
      const channel = await myChannel();
      const t = (await load())!;
      await save({ ...t, channel_id: channel.id });
      return { channelRowId: p.channelRowId, channel };
    },
    async status(): Promise<YouTubeStatus> {
      const t = await load();
      const q = await readQuota();
      return { configured, connected: !!t, channelId: t?.channel_id ?? null, consentedAt: t?.consented_at ?? null, scopes: t ? t.scope.split(" ").filter(Boolean) : [], quota: { ...q, limitUnits: QUOTA_DAILY, limitUploads: UPLOADS_DAILY } };
    },
    /** Re-reads the channel (name and picture) to show it is still connected. */
    myChannel,
    /** Revokes the access at Google and deletes the tokens on this pc. */
    async disconnect(): Promise<void> {
      const t = await load();
      if (t) await http(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: "POST" }).catch(() => undefined);
      await rm(o.tokenFile, { force: true });
    },
    /** Deletes the tokens on this pc only, without revoking at Google (fase 0.5: another channel may share the same Google grant). */
    async forget(): Promise<void> {
      await rm(o.tokenFile, { force: true });
    },
    accessToken,
    spend,
  };
}
export type YouTube = ReturnType<typeof createYouTube>;

// Fake database and worker for the browser tests. TESTDATA only: no real names, no real videos.
import type { Page, Route } from "@playwright/test";

export const STUDIO = "00000000-0000-4000-8000-000000000001";
export const USER = "00000000-0000-4000-8000-000000000002";
export const CHANNEL = "00000000-0000-4000-8000-000000000003";
export const REC = "00000000-0000-4000-8000-000000000004";
export const V_REVIEW = "00000000-0000-4000-8000-000000000010";
export const V_HELD = "00000000-0000-4000-8000-000000000011";
const NOW = "2026-11-24T12:00:00.000Z";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
export const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER, email: "test@example.invalid", role: "authenticated", exp })}.c2ln`;

export const session = {
  access_token: TOKEN,
  refresh_token: "test-refresh",
  token_type: "bearer",
  expires_in: 3600 * 24,
  expires_at: exp,
  user: { id: USER, email: "test@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: NOW },
};

const script = (id: string, video: string) => ({ id, studio_id: STUDIO, video_id: video, version: 1, status: "approved", top_line: "TESTDATA HOOK", hook: "Testdata hook line.", lines: [{ at_ms: 0, text: "Testdata line." }], edit_plan: [], target_ms: 15000, titles: ["TESTDATA Short"], hooks: [], chosen_hook: null, loop_line: null, created_at: NOW, model: "gratis-engine" });
const render = (id: string, video: string) => ({ id, studio_id: STUDIO, video_id: video, script_id: `${video}-s`, job_id: `${video}-j`, file_name: `${video}-v1.mp4`, duration_ms: 15000, width: 1080, height: 1920, voice_name: null, tts_characters: 0, is_test: false, created_at: NOW, privacy_blur: false, game_muted: false, channel_id: CHANNEL, thumbnails: [], qc: { items: [], contentValue: { level: "bevestigd", summary: "Inhoud bevestigd: TESTDATA" } } });

/** Rows per table. Filters in the request are ignored: every test uses a tiny, consistent set. */
export function tables(): Record<string, unknown[]> {
  return {
    studio_members: [{ id: "m1", studio_id: STUDIO, user_id: USER, display_name: "Test", role: "eigenaar" }],
    studios: [{ id: STUDIO, name: "TESTDATA Studio" }],
    yt_channels: [{ id: CHANNEL, studio_id: STUDIO, name: "KIVOXEL", slug: "kivoxel", is_default: true, status: "active", language: "en", audience: null, brand_color: null, youtube_channel_id: null, made_for_kids: false, created_at: NOW }],
    yt_recordings: [{ id: REC, studio_id: STUDIO, channel_id: CHANNEL, label: "TESTDATA opname minecraft", fingerprint: "a".repeat(64), duration_ms: 600000, created_at: NOW, status: "ready" }],
    yt_videos: [
      { id: V_REVIEW, studio_id: STUDIO, recording_id: REC, channel_id: CHANNEL, format: "A", status: "review", review_note: null, promise: "TESTDATA review", plan_key: "p1", is_test: false, language: "en", created_at: NOW, youtube_video_id: null, yt_video_moments: [] },
      { id: V_HELD, studio_id: STUDIO, recording_id: REC, channel_id: CHANNEL, format: "A", status: "archived", review_note: "Studio (inhoud): Inhoud niet bevestigd: alleen een hard geluid.", promise: "TESTDATA held", plan_key: "p2", is_test: false, language: "en", created_at: NOW, youtube_video_id: null, yt_video_moments: [] },
    ],
    yt_scripts: [script(`${V_REVIEW}-s`, V_REVIEW), script(`${V_HELD}-s`, V_HELD)],
    yt_renders: [render("r1", V_REVIEW), render("r2", V_HELD)],
  };
}

export type Recorded = { method: string; table: string; body: unknown; query: string };

/** Answers every database, auth and worker request. Returns the list of writes the page made. */
export async function mockStudio(page: Page, opts: { lessons?: unknown } = {}): Promise<Recorded[]> {
  const writes: Recorded[] = [];
  const data = tables();
  await page.addInitScript(([s]) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-"));
    if (key) localStorage.removeItem(key);
    // The project ref comes from NEXT_PUBLIC_SUPABASE_URL; the app reads the session under sb-<ref>-auth-token.
    (window as unknown as { __testSession: unknown }).__testSession = s;
  }, [session]);
  await page.route(/supabase\.co\/auth\/v1\/.*/, (route: Route) => route.fulfill({ json: route.request().url().includes("/user") ? session.user : session }));
  await page.route(/supabase\.co\/rest\/v1\/.*/, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      writes.push({ method: req.method(), table, body: req.postDataJSON?.() ?? null, query: url.search });
      return route.fulfill({ status: req.method() === "POST" ? 201 : 200, json: [] });
    }
    if (table.startsWith("rpc/")) return route.fulfill({ json: [] });
    const rows = data[table] ?? [];
    const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (single) return rows.length ? route.fulfill({ json: rows[0] }) : route.fulfill({ status: 406, json: { code: "PGRST116", message: "no rows", details: null, hint: null } });
    return route.fulfill({ json: rows, headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
  });
  // The app talks to the worker on 127.0.0.1:3210 (lib/youtube/protocol.ts). Every port on this machine is answered
  // by the mock, so a test can never reach the real worker (24-11-2026: an earlier version only caught "localhost").
  await page.route(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):3210\/.*/, async (route: Route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (route.request().method() === "POST") {
      writes.push({ method: "POST", table: `worker${p}`, body: route.request().postDataJSON?.() ?? null, query: "" });
      return route.fulfill({ json: opts.lessons ?? {} });
    }
    const json: Record<string, unknown> = {
      "/health": { ok: true, version: "test", ffmpeg: "test", queue: "supabase", dataDir: "C:/TESTDATA", analysis: null, voice: false, youtube: false, inbox: null, multiChannel: true, dreamnest: false },
      "/incidents": { checkedAt: NOW, health: { status: "operationeel", text: "Operationeel" }, incidents: [] },
      "/lessons": opts.lessons ?? { version: 0, builtAt: null, lessons: [], off: [], history: [], applied: {} },
      "/recordings": [{ fingerprint: "a".repeat(64) }],
      "/music": [],
      "/register": { builtAt: null, entries: [], counts: {}, running: null },
      "/voice-plan": [],
    };
    if (p in json) return route.fulfill({ json: json[p] });
    if (p.startsWith("/renders/")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ json: {} });
  });
  return writes;
}

/** Puts the fake session where supabase-js looks for it (before the app loads). */
export async function signIn(page: Page) {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://odrzruieoqtcffyypsaj.supabase.co").hostname.split(".")[0];
  await page.addInitScript(([key, s]) => localStorage.setItem(key as string, JSON.stringify(s)), [`sb-${ref}-auth-token`, session]);
}

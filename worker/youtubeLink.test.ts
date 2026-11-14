import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createYouTube, YT_SCOPES } from "./youtube.ts";
import { createYouTubeLink, linkError, type ChannelDb, type ChannelRow, type LinkFields } from "./youtubeLink.ts";

const UC = "UCabcdefghijklmnopqrstuv";
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(rows: Record<string, ChannelRow & LinkFields>, channelId = UC, failUpdate = false) {
  dir = mkdtempSync(join(tmpdir(), "ytl-"));
  const fakeFetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: YT_SCOPES.join(" ") }));
    if (u.includes("/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: channelId, snippet: { title: "Kivoxel", thumbnails: {} } }] }));
    return new Response("");
  }) as typeof fetch;
  const yt = createYouTube({ clientId: "c", clientSecret: "s", redirectUri: "http://127.0.0.1:3210/oauth/callback", key: randomBytes(32), tokenFile: join(dir, "t.enc"), quotaFile: join(dir, "q.json"), fetch: fakeFetch });
  const db: ChannelDb = {
    get: async (id) => rows[id] ?? null,
    connected: async () => Object.values(rows).find((r) => r.youtube_connected_at) ?? null,
    update: async (id, f) => {
      if (failUpdate) throw new Error("Migratie 036 is nog niet uitgevoerd; daarna werkt koppelen.");
      Object.assign(rows[id], f);
    },
  };
  const link = createYouTubeLink(yt, null, db, () => "2026-11-12T12:00:00.000Z");
  const signIn = async (rowId: string) => link.callback(new URLSearchParams({ state: new URL(await link.connect(rowId)).searchParams.get("state")!, code: "x" }));
  return { yt, link, rows, signIn };
}
const row = (id: string, extra: Partial<ChannelRow> = {}): ChannelRow => ({ id, youtube_channel_id: null, youtube_connected_at: null, ...extra });

describe("linking a channel row to YouTube", () => {
  it("writes only the connection state to the channel row", async () => {
    const { rows, signIn, yt } = setup({ a: row("a") });
    expect(await signIn("a")).toEqual({ ok: true, message: `Gekoppeld met het YouTube-kanaal "Kivoxel" (${UC}).` });
    expect(rows.a).toMatchObject({ youtube_channel_id: UC, youtube_title: "Kivoxel", youtube_connected_at: "2026-11-12T12:00:00.000Z", youtube_error: null });
    expect(JSON.stringify(rows)).not.toMatch(/"r"|access|refresh/);
    expect((await yt.status()).connected).toBe(true);
  });

  it("refuses a second channel while one is linked, and a different YouTube channel for the same row", async () => {
    const s = setup({ a: row("a", { youtube_connected_at: "x" }), b: row("b") });
    await expect(s.link.connect("b")).rejects.toThrow(/al een ander kanaal gekoppeld/);
    await expect(s.link.connect("onbekend")).rejects.toThrow(/bestaat niet/);
    const t = setup({ a: row("a", { youtube_channel_id: "UCzzzzzzzzzzzzzzzzzzzzzz" }) });
    const result = await t.signIn("a");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ander YouTube-kanaal/);
    expect((await t.yt.status()).connected).toBe(false);
  });

  it("keeps no tokens when the database cannot store the link", async () => {
    const { signIn, yt } = setup({ a: row("a") }, UC, true);
    expect(await signIn("a")).toEqual({ ok: false, message: "Migratie 036 is nog niet uitgevoerd; daarna werkt koppelen." });
    expect((await yt.status()).connected).toBe(false);
  });

  it("disconnecting clears the row and the tokens; sync refreshes the name", async () => {
    const { rows, signIn, link, yt } = setup({ a: row("a") });
    await signIn("a");
    expect(await link.sync()).toBe('gekoppeld met "Kivoxel"');
    await link.disconnect("a");
    expect(rows.a).toMatchObject({ youtube_channel_id: null, youtube_connected_at: null });
    expect((await yt.status()).connected).toBe(false);
    expect(await link.sync()).toBeNull();
  });

  it("explains an expired test-mode consent in plain Dutch", () => {
    expect(linkError(new Error("Google weigerde het inloggen: invalid_grant (Token has been expired or revoked.)"))).toMatch(/7 dagen.*Opnieuw koppelen/);
  });
});

describe("one YouTube sign-in per channel (fase 0.5, FEATURE_DREAMNEST)", () => {
  it("KIVOXEL keeps its own token file; Dreamnest gets its own; each channel is checked on its own", async () => {
    dir = mkdtempSync(join(tmpdir(), "ytl-"));
    let who = UC;
    let revokes = 0;
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/revoke")) revokes++;
      if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: YT_SCOPES.join(" ") }));
      if (u.includes("/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: who, snippet: { title: who === UC ? "Kivoxel" : "Dreamnest", thumbnails: {} } }] }));
      return new Response("");
    }) as typeof fetch;
    const make = (file: string) => createYouTube({ clientId: "c", clientSecret: "s", redirectUri: "http://127.0.0.1:3210/oauth/callback", key: randomBytes(32), tokenFile: join(dir, file), quotaFile: join(dir, "q.json"), fetch: fakeFetch });
    const kivoxel = make("youtube-tokens.enc");
    const others = new Map<string, ReturnType<typeof createYouTube>>();
    const forChannel = (id: string) => others.get(id) ?? others.set(id, make(`youtube-tokens-${id}.enc`)).get(id)!;
    const rows: Record<string, ChannelRow & LinkFields> = { k: row("k", { is_default: true }), d: row("d") };
    const db: ChannelDb = { get: async (id) => rows[id] ?? null, connected: async () => Object.values(rows).find((r) => r.youtube_connected_at) ?? null, connectedAll: async () => Object.values(rows).filter((r) => r.youtube_connected_at), update: async (id, f) => void Object.assign(rows[id], f) };
    const link = createYouTubeLink(kivoxel, null, db, () => "2026-11-14T12:00:00.000Z", forChannel);
    const signIn = async (id: string) => link.callback(new URLSearchParams({ state: new URL(await link.connect(id)).searchParams.get("state")!, code: "x" }));

    expect((await signIn("k")).ok).toBe(true);
    // Same Google account, Google picked the Kivoxel channel for Dreamnest: refused, and KIVOXEL's grant is not revoked.
    const wrong = await signIn("d");
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toMatch(/hoort al bij een ander kanaal/);
    expect(rows.d.youtube_connected_at).toBeNull();
    expect(await link.tokensChannelId("d")).toBeNull();
    expect(await link.tokensChannelId("k")).toBe(UC);
    expect(revokes).toBe(0);
    who = "UCdreamnestdreamnestdrea";
    expect((await signIn("d")).ok).toBe(true); // a second channel is allowed now
    expect(rows.k.youtube_channel_id).toBe(UC);
    expect(rows.d.youtube_channel_id).toBe("UCdreamnestdreamnestdrea");
    expect(await link.tokensChannelId("k")).toBe(UC);
    expect(await link.tokensChannelId("d")).toBe("UCdreamnestdreamnestdrea");
    expect(((await link.status("d")) as { channelId: string }).channelId).toBe("UCdreamnestdreamnestdrea");
    expect(((await link.status()) as { channelId: string }).channelId).toBe(UC); // without a channel: KIVOXEL, as before

    // Disconnecting Dreamnest leaves KIVOXEL linked.
    await link.disconnect("d");
    expect(await link.tokensChannelId("d")).toBeNull();
    expect(await link.tokensChannelId("k")).toBe(UC);
  });
});

describe("undoing a wrong link (fase 0.5)", () => {
  it("unlinking a channel that shares KIVOXEL's Google grant only deletes its own tokens, never revokes", async () => {
    dir = mkdtempSync(join(tmpdir(), "ytl-"));
    let revokes = 0;
    const fakeFetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/revoke")) revokes++;
      if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: YT_SCOPES.join(" ") }));
      if (u.includes("/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: UC, snippet: { title: "Kivoxel", thumbnails: {} } }] }));
      return new Response("");
    }) as typeof fetch;
    const make = (file: string) => createYouTube({ clientId: "c", clientSecret: "s", redirectUri: "http://127.0.0.1:3210/oauth/callback", key: randomBytes(32), tokenFile: join(dir, file), quotaFile: join(dir, "q.json"), fetch: fakeFetch });
    const kivoxel = make("youtube-tokens.enc");
    const dn = make("youtube-tokens-d.enc");
    const rows: Record<string, ChannelRow & LinkFields> = { k: row("k", { is_default: true }), d: row("d") };
    const db: ChannelDb = { get: async (id) => rows[id] ?? null, connected: async () => null, connectedAll: async () => Object.values(rows).filter((r) => r.youtube_connected_at), update: async (id, f) => void Object.assign(rows[id], f) };
    // The state on Milan's pc on 14-11: both sign-ins hold Kivoxel tokens, the Dreamnest row says Kivoxel (made before this check existed).
    const plain = createYouTubeLink(kivoxel, null, db);
    await plain.callback(new URLSearchParams({ state: new URL(await plain.connect("k")).searchParams.get("state")!, code: "x" }));
    const old = createYouTubeLink(dn, null, { ...db, connected: async () => null });
    await old.callback(new URLSearchParams({ state: new URL(await old.connect("d")).searchParams.get("state")!, code: "x" }));
    expect(rows.d.youtube_channel_id).toBe(UC);

    const link = createYouTubeLink(kivoxel, null, db, undefined, () => dn);
    await link.disconnect("d");
    expect(revokes).toBe(0);
    expect(rows.d.youtube_connected_at).toBeNull();
    expect((await dn.status()).connected).toBe(false);
    expect((await kivoxel.status()).channelId).toBe(UC);
  });
});

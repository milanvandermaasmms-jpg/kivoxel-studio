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

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authUrl, createYouTube, decrypt, encrypt, pkce, quotaDay, YT_SCOPES } from "./youtube.ts";

describe("sign-in pieces", () => {
  it("makes a PKCE verifier and its S256 challenge", () => {
    const { verifier, challenge } = pkce(Buffer.alloc(32, 7));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("asks Google for offline access with exactly the needed scopes", () => {
    const u = new URL(authUrl({ clientId: "123-abc.apps.googleusercontent.com", redirectUri: "http://127.0.0.1:3210/oauth/callback", state: "s1", challenge: "c1" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", access_type: "offline", prompt: "consent", code_challenge_method: "S256", state: "s1", redirect_uri: "http://127.0.0.1:3210/oauth/callback" });
    expect(u.searchParams.get("scope")?.split(" ")).toEqual(YT_SCOPES);
  });

  it("encrypts tokens so they cannot be read or changed without the key", () => {
    const key = randomBytes(32);
    const box = encrypt(key, '{"refresh_token":"geheim"}');
    expect(box).not.toContain("geheim");
    expect(decrypt(key, box)).toBe('{"refresh_token":"geheim"}');
    expect(() => decrypt(randomBytes(32), box)).toThrow();
    const raw = Buffer.from(box, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(key, raw.toString("base64"))).toThrow();
  });

  it("counts the quota day in Pacific time", () => {
    expect(quotaDay(new Date("2026-11-12T07:30:00Z"))).toBe("2026-11-11");
    expect(quotaDay(new Date("2026-11-12T09:30:00Z"))).toBe("2026-11-12");
  });
});

describe("connecting with a fake Google", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function setup(grantedScope = YT_SCOPES.join(" ")) {
    dir = mkdtempSync(join(tmpdir(), "yt-"));
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u.split("?")[0]}`);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get("grant_type") === "authorization_code") {
          expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
          return new Response(JSON.stringify({ access_token: "a1", refresh_token: "refresh-geheim-123", expires_in: 3600, scope: grantedScope }), { status: 200 });
        }
        return new Response(JSON.stringify({ access_token: "a2", expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith("https://www.googleapis.com/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ id: "UCabcdefghijklmnopqrstuv", snippet: { title: "Kivoxel", thumbnails: { default: { url: "https://yt3.example/k.jpg" } } } }] }), { status: 200 });
      if (u.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    let clock = Date.parse("2026-11-12T12:00:00Z");
    const yt = createYouTube({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-test", redirectUri: "http://127.0.0.1:3210/oauth/callback", key: randomBytes(32), tokenFile: join(dir, "tokens.enc"), quotaFile: join(dir, "quota.json"), fetch: fakeFetch, now: () => clock });
    return { yt, calls, tick: (ms: number) => (clock += ms) };
  }

  it("links the channel, keeps the tokens encrypted and counts quota", async () => {
    const { yt } = setup();
    const url = new URL(yt.start("row-1"));
    const result = await yt.callback(new URLSearchParams({ state: url.searchParams.get("state")!, code: "c" }));
    expect(result).toEqual({ channelRowId: "row-1", channel: { id: "UCabcdefghijklmnopqrstuv", title: "Kivoxel", thumbnail: "https://yt3.example/k.jpg" } });
    expect(readFileSync(join(dir, "tokens.enc"), "utf8")).not.toContain("refresh-geheim");
    const status = await yt.status();
    expect(status).toMatchObject({ connected: true, channelId: "UCabcdefghijklmnopqrstuv", quota: { units: 1, uploads: 0 } });
  });

  it("refuses a callback it did not start, or one used twice", async () => {
    const { yt } = setup();
    await expect(yt.callback(new URLSearchParams({ state: "vreemd", code: "c" }))).rejects.toThrow(/verlopen of niet door deze werker gestart/);
    const state = new URL(yt.start("row-1")).searchParams.get("state")!;
    await yt.callback(new URLSearchParams({ state, code: "c" }));
    await expect(yt.callback(new URLSearchParams({ state, code: "c" }))).rejects.toThrow(/verlopen/);
  });

  it("explains a refusal and missing permissions", async () => {
    const { yt } = setup("https://www.googleapis.com/auth/youtube.upload");
    const s1 = new URL(yt.start("row-1")).searchParams.get("state")!;
    await expect(yt.callback(new URLSearchParams({ state: s1, error: "access_denied" }))).rejects.toThrow(/testgebruiker/);
    const s2 = new URL(yt.start("row-1")).searchParams.get("state")!;
    await expect(yt.callback(new URLSearchParams({ state: s2, code: "c" }))).rejects.toThrow(/Niet alle toestemmingen/);
  });

  it("refreshes an expired access token, and disconnecting removes the tokens", async () => {
    const { yt, calls, tick } = setup();
    const state = new URL(yt.start("row-1")).searchParams.get("state")!;
    await yt.callback(new URLSearchParams({ state, code: "c" }));
    expect(await yt.accessToken()).toBe("a1");
    tick(2 * 3_600_000);
    expect(await yt.accessToken()).toBe("a2");
    await yt.disconnect();
    expect(existsSync(join(dir, "tokens.enc"))).toBe(false);
    expect(calls).toContain("POST https://oauth2.googleapis.com/revoke");
    expect((await yt.status()).connected).toBe(false);
  });

  it("refuses cleanly when the day quota is used up", async () => {
    const { yt } = setup();
    for (let i = 0; i < 25; i++) await yt.spend("captions.insert");
    await expect(yt.spend("captions.insert")).rejects.toThrow(/quotum voor vandaag is op/);
  });

  it("says what is missing when the client is not set", () => {
    dir = mkdtempSync(join(tmpdir(), "yt-"));
    const yt = createYouTube({ redirectUri: "x", key: randomBytes(32), tokenFile: join(dir, "t"), quotaFile: join(dir, "q") });
    expect(yt.configured).toBe(false);
    expect(() => yt.start("row")).toThrow(/YOUTUBE_CLIENT_ID/);
  });
});

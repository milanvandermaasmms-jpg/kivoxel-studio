import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerServer, parseRange } from "./server";
import { createStore } from "./store";

describe("byte ranges for the video player", () => {
  it("reads the usual forms", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-30", 100)).toEqual({ start: 70, end: 99 });
  });

  it("refuses ranges outside the file", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=20-10", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});

describe("montage previews", () => {
  it("serves a preview in pieces, only to the dashboard and only with a safe name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fmk-renders-"));
    const rendersDir = join(dir, "renders");
    await mkdir(rendersDir);
    const name = "abc-v1-12345678.mp4";
    await writeFile(join(rendersDir, name), Buffer.from("0123456789"));
    await writeFile(join(dir, "geheim.mp4"), "secret");
    const server = createWorkerServer({ store: createStore(dir, async () => ({ durationMs: 1, width: 1, height: 1, fps: 1, videoCodec: "h264", audioCodec: null })), allowedOrigins: ["http://localhost:3100"], rendersDir, health: () => ({ ok: true, version: "t", ffmpeg: null, queue: "local", dataDir: dir }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/renders/`;
    const origin = "http://localhost:3100";
    try {
      const part = await fetch(base + name, { headers: { origin, range: "bytes=2-5" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(await part.text()).toBe("2345");
      const whole = await fetch(base + name, { headers: { origin } });
      expect(whole.status).toBe(200);
      expect(await whole.text()).toBe("0123456789");
      expect((await fetch(base + name, { headers: { origin, range: "bytes=50-" } })).status).toBe(416);
      expect((await fetch(base + name)).status).toBe(403);
      expect((await fetch(base + name, { headers: { origin: "https://evil.example" } })).status).toBe(403);
      expect((await fetch(base + "..%2Fgeheim.mp4", { headers: { origin } })).status).toBe(400);
      expect((await fetch(base + "nope-v1-00000000.mp4", { headers: { origin } })).status).toBe(404);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("YouTube connection addresses", () => {
  it("only lets the dashboard start or end a connection, and shows a safe page after Google", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fmk-yt-"));
    const seen: string[] = [];
    const server = createWorkerServer({
      store: createStore(dir, async () => ({ durationMs: 1, width: 1, height: 1, fps: 1, videoCodec: "h264", audioCodec: null })),
      allowedOrigins: ["http://localhost:3100"],
      health: () => ({ ok: true, version: "t", ffmpeg: null, queue: "local", dataDir: dir }),
      youtube: {
        connect: async (id) => (seen.push(`connect ${id}`), "https://accounts.google.com/o/oauth2/v2/auth?x=1"),
        callback: async (q) => (q.get("state") === "goed" ? { ok: true, message: "Gekoppeld met <Kivoxel>" } : { ok: false, message: "verlopen" }),
        status: async () => ({ connected: false }),
        disconnect: async (id) => void seen.push(`disconnect ${id}`),
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const origin = "http://localhost:3100";
    const id = "11111111-2222-3333-4444-555555555555";
    const post = (path: string, body: unknown, headers: Record<string, string> = { origin }) => fetch(base + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const ok = await post("/youtube/connect", { channelId: id });
      expect(await ok.json()).toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
      expect((await post("/youtube/connect", { channelId: id }, {})).status).toBe(403);
      expect((await post("/youtube/connect", { channelId: id }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await post("/youtube/connect", { channelId: "../x" })).status).toBe(400);
      expect((await fetch(base + "/youtube/status")).status).toBe(403);
      expect(await (await fetch(base + "/youtube/status", { headers: { origin } })).json()).toEqual({ connected: false });
      expect((await post("/youtube/disconnect", { channelId: id })).status).toBe(200);
      expect(seen).toEqual([`connect ${id}`, `disconnect ${id}`]);

      const page = await fetch(base + "/oauth/callback?state=goed&code=c");
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      const html = await page.text();
      expect(html).toContain("&lt;Kivoxel&gt;");
      expect(html).not.toContain("<Kivoxel>");
      expect((await fetch(base + "/oauth/callback?state=fout")).status).toBe(400);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

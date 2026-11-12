import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { YouTube } from "./youtube.ts";
import { createUploader, nextByte, videoResource, type UploadMeta } from "./youtubeUpload.ts";

const meta: UploadMeta = { title: "[TEST] Minecraft: testbeeld", description: "#minecraft", tags: ["minecraft"], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false };
const SIZE = 10 * 1024;
const CHUNK = 4 * 1024;

/** A small fake of YouTube's resumable upload: keeps what arrived and can drop the line or expire the session. */
function fakeYouTube(opts: { failPutAt?: number[]; uploads?: { title: string; publishedAt: string; videoId: string }[] } = {}) {
  const sessions = new Map<string, { size: number; received: number; done: boolean; body: unknown }>();
  const calls: string[] = [];
  let puts = 0;
  let n = 0;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const h = new Headers(init?.headers);
    if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
      calls.push("start");
      const uri = `https://upload.example/session/${++n}`;
      sessions.set(uri, { size: Number(h.get("x-upload-content-length")), received: 0, done: false, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200, headers: { location: uri } });
    }
    if (u.startsWith("https://upload.example/session/")) {
      const s = sessions.get(u);
      if (!s) return new Response("", { status: 404 });
      const range = h.get("content-range")!;
      if (range.startsWith("bytes */")) {
        calls.push("query");
        if (s.done) return new Response(JSON.stringify({ id: "vid12345678" }), { status: 200 });
        return new Response("", { status: 308, headers: s.received ? { range: `bytes=0-${s.received - 1}` } : {} });
      }
      puts++;
      if (opts.failPutAt?.includes(puts)) {
        calls.push("drop");
        throw new TypeError("fetch failed");
      }
      const [, a, b] = /bytes (\d+)-(\d+)\//.exec(range)!;
      expect(Number(a)).toBe(s.received);
      s.received = Number(b) + 1;
      calls.push(`put ${a}-${b}`);
      if (s.received >= s.size) {
        s.done = true;
        return new Response(JSON.stringify({ id: "vid12345678" }), { status: 200 });
      }
      return new Response("", { status: 308, headers: { range: `bytes=0-${s.received - 1}` } });
    }
    if (u.includes("/youtube/v3/channels")) return new Response(JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUlist" } } }] }));
    if (u.includes("/youtube/v3/playlistItems")) return new Response(JSON.stringify({ items: (opts.uploads ?? []).map((v) => ({ snippet: { title: v.title, publishedAt: v.publishedAt, resourceId: { videoId: v.videoId } } })) }));
    if (u.includes("/youtube/v3/videos?part=status")) return new Response(JSON.stringify({ items: [{ status: { uploadStatus: "processed", privacyStatus: "private" }, processingDetails: { processingStatus: "succeeded" } }] }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls, sessions };
}

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(fake: ReturnType<typeof fakeYouTube>) {
  dir = mkdtempSync(join(tmpdir(), "ytu-"));
  const file = join(dir, "montage.mp4");
  writeFileSync(file, Buffer.alloc(SIZE, 1));
  mkdirSync(join(dir, "sessions"), { recursive: true });
  const spent: string[] = [];
  const yt = { accessToken: async () => "token", spend: async (call: string, upload = false) => void spent.push(upload ? "upload" : call) } as unknown as YouTube;
  const up = createUploader({ yt, sessionDir: join(dir, "sessions"), fetch: fake.fetchFn, sleep: async () => {}, chunk: CHUNK, now: () => Date.parse("2026-11-12T18:00:00Z") });
  const progress: number[] = [];
  const events: string[] = [];
  const run = (signal = new AbortController().signal) => up.upload({ key: "pub-1", file, meta, signal, onProgress: (s) => progress.push(s), onEvent: (m) => void events.push(m) });
  return { up, run, progress, events, spent, file };
}

describe("resumable upload", () => {
  it("builds a private video with Milan's choices", () => {
    expect(videoResource(meta).status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
    expect(videoResource(meta).snippet).toMatchObject({ categoryId: "20", defaultLanguage: "en", tags: ["minecraft"] });
    expect(nextByte("bytes=0-524287")).toBe(524288);
    expect(nextByte(null)).toBe(0);
  });

  it("sends the file in pieces and reports progress", async () => {
    const fake = fakeYouTube();
    const s = setup(fake);
    expect(await s.run()).toEqual({ videoId: "vid12345678", resumed: false, adopted: false, bytes: SIZE });
    expect(fake.calls).toEqual(["start", "put 0-4095", "put 4096-8191", "put 8192-10239"]);
    expect(s.progress).toEqual([0, 4096, 8192, SIZE]);
    expect(s.spent).toEqual(["upload"]);
    expect(existsSync(join(dir, "sessions", "pub-1.json"))).toBe(false);
  });

  it("continues where it stopped after a dropped connection", async () => {
    const fake = fakeYouTube({ failPutAt: [2] });
    const s = setup(fake);
    expect((await s.run()).resumed).toBe(true);
    expect(fake.calls).toEqual(["start", "put 0-4095", "drop", "query", "put 4096-8191", "put 8192-10239"]);
    expect(s.events[0]).toMatch(/Verbinding verbroken.*opnieuw proberen/);
  });

  it("resumes an earlier session after a restart instead of starting again", async () => {
    const fake = fakeYouTube();
    const s = setup(fake);
    const stop = new AbortController();
    let first = true;
    await expect(
      s.up.upload({ key: "pub-1", file: s.file, meta, signal: stop.signal, onProgress: (sent) => (sent > 0 && first ? ((first = false), stop.abort()) : undefined), onEvent: () => {} }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual(["start", "put 0-4095"]);
    const again = await s.run();
    expect(again).toMatchObject({ videoId: "vid12345678", resumed: true });
    expect(fake.calls.filter((c) => c === "start")).toHaveLength(1);
    expect(fake.calls.slice(2)).toEqual(["query", "put 4096-8191", "put 8192-10239"]);
  });

  it("adopts a finished upload instead of uploading twice", async () => {
    const fake = fakeYouTube();
    const s = setup(fake);
    await s.run();
    // Pretend the database write failed and the session file stayed behind.
    const [uri] = [...fake.sessions.keys()];
    writeFileSync(join(dir, "sessions", "pub-1.json"), JSON.stringify({ uri, size: SIZE, startedAt: "2026-11-12T18:00:00.000Z", metaHash: "x" }));
    expect(await s.run()).toEqual({ videoId: "vid12345678", resumed: true, adopted: true, bytes: SIZE });
    expect(fake.calls.filter((c) => c === "start")).toHaveLength(1);
  });

  it("after an expired session, looks in the channel first and only then starts anew", async () => {
    const found = fakeYouTube({ uploads: [{ title: meta.title, publishedAt: "2026-11-12T18:05:00Z", videoId: "already9999" }] });
    const s1 = setup(found);
    writeFileSync(join(dir, "sessions", "pub-1.json"), JSON.stringify({ uri: "https://upload.example/session/gone", size: SIZE, startedAt: "2026-11-12T18:00:00.000Z", metaHash: "x" }));
    expect(await s1.run()).toMatchObject({ videoId: "already9999", adopted: true });
    expect(found.calls).not.toContain("start");
    rmSync(dir, { recursive: true, force: true });

    const empty = fakeYouTube({ uploads: [{ title: meta.title, publishedAt: "2026-11-11T10:00:00Z", videoId: "older000000" }] });
    const s2 = setup(empty);
    writeFileSync(join(dir, "sessions", "pub-1.json"), JSON.stringify({ uri: "https://upload.example/session/gone", size: SIZE, startedAt: "2026-11-12T18:00:00.000Z", metaHash: "x" }));
    expect(await s2.run()).toMatchObject({ videoId: "vid12345678", adopted: false });
    expect(s2.events.some((e) => /niet op het kanaal/.test(e))).toBe(true);
  });

  it("says when the montage is gone and reads the processing state", async () => {
    const fake = fakeYouTube();
    const s = setup(fake);
    rmSync(s.file);
    await expect(s.run()).rejects.toThrow(/Maak de montage opnieuw/);
    expect(await s.up.processing("vid12345678")).toEqual({ uploadStatus: "processed", processingStatus: "succeeded", privacyStatus: "private", reason: null });
  });
});

describe("visibility (fase D4)", () => {
  it("schedules only private and sends Milan's choices with every status change", async () => {
    const { statusPart } = await import("./youtubeUpload.ts");
    expect(statusPart({ ...meta, visibility: "private", publish_at: "2026-11-20T17:30:00Z" })).toEqual({ privacyStatus: "private", publishAt: "2026-11-20T17:30:00.000Z", selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
    expect(statusPart({ ...meta, visibility: "public" })).toMatchObject({ privacyStatus: "public" });
    expect(() => statusPart({ ...meta, visibility: "public", publish_at: "2026-11-20T17:30:00Z" })).toThrow(/alleen privé/);
  });

  it("updates the status part of an existing video", async () => {
    const sent: { url: string; body: unknown }[] = [];
    dir = mkdtempSync(join(tmpdir(), "ytu-"));
    const yt = { accessToken: async () => "token", spend: async () => {} } as unknown as YouTube;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await createUploader({ yt, sessionDir: dir, fetch: fetchFn }).setStatus("vid12345678", { ...meta, visibility: "unlisted" });
    expect(sent).toEqual([{ url: "https://www.googleapis.com/youtube/v3/videos?part=status", body: { id: "vid12345678", status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false, containsSyntheticMedia: false } } }]);
  });
});

describe("captions and thumbnail (fase D4b)", () => {
  function capture(status = 200, json: unknown = { id: "cap123" }) {
    const sent: { url: string; headers: Headers; body: string }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers), body: Buffer.isBuffer(init?.body) ? "jpeg" : String(init?.body) });
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
    dir = mkdtempSync(join(tmpdir(), "ytu-"));
    const spent: string[] = [];
    const yt = { accessToken: async () => "token", spend: async (c: string) => void spent.push(c) } as unknown as YouTube;
    return { up: createUploader({ yt, sessionDir: dir, fetch: fetchFn }), sent, spent };
  }

  it("uploads the SRT as a caption track in the video's language", async () => {
    const { up, sent, spent } = capture();
    expect(await up.insertCaption("vid12345678", "en", "1\n00:00:00,000 --> 00:00:01,200\nNo way out.\n")).toBe("cap123");
    expect(spent).toEqual(["captions.insert"]);
    expect(sent[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart");
    expect(sent[0].headers.get("content-type")).toMatch(/^multipart\/related; boundary=/);
    expect(sent[0].body).toContain('{"snippet":{"videoId":"vid12345678","language":"en","name":"","isDraft":false}}');
    expect(sent[0].body).toContain("No way out.");
  });

  it("sets the thumbnail, and explains a 403 in plain Dutch", async () => {
    const ok = capture(200, {});
    await ok.up.setThumbnail("vid12345678", Buffer.from([0xff, 0xd8]));
    expect(ok.sent[0].url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=vid12345678&uploadType=media");
    expect(ok.sent[0].headers.get("content-type")).toBe("image/jpeg");
    rmSync(dir, { recursive: true, force: true });
    const denied = capture(403, { error: { message: "forbidden" } });
    await expect(denied.up.setThumbnail("vid12345678", Buffer.from([0xff]))).rejects.toThrow(/youtube.com\/verify/);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeFingerprint } from "../lib/youtube/fingerprint";
import { CHUNK_SIZE, nextChunk, type CompleteResult, type UploadState } from "../lib/youtube/protocol";
import { createWorkerServer } from "./server";
import { createStore, StoreError } from "./store";

// TESTDATA: random bytes, never real gameplay.
const data = randomBytes(13 * 1024 * 1024);
const fakeProbe = async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 60, videoCodec: "h264", audioCodec: "aac" });
let dir: string;
let store: ReturnType<typeof createStore>;
let fp: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fmk-worker-"));
  store = createStore(dir, fakeProbe);
  await store.init();
  fp = await computeFingerprint(new Blob([data]));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const start = () => store.start({ fingerprint: fp, size: data.length, name: "TESTDATA.mp4", label: "TESTDATA opname", isTest: true });
const piece = (from: number, to: number) => store.append(fp, from, to - from, Readable.from([data.subarray(from, to)]));

describe("worker store", () => {
  it("receives a recording in pieces and resumes after an interruption", async () => {
    expect(await start()).toEqual({ state: "new", received: 0 });
    expect(await piece(0, CHUNK_SIZE)).toBe(CHUNK_SIZE);
    // The browser was closed; choosing the same file again continues where it stopped.
    expect(await start()).toEqual({ state: "partial", received: CHUNK_SIZE });
    await expect(piece(0, CHUNK_SIZE)).rejects.toMatchObject({ status: 409, received: CHUNK_SIZE });
    expect(await piece(CHUNK_SIZE, data.length)).toBe(data.length);
    const { recording, duplicateOf } = await store.complete(fp);
    expect(duplicateOf).toBeNull();
    expect(recording.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(Buffer.compare(await readFile(join(store.recordingsDir, recording.file)), data)).toBe(0);
  });

  it("keeps the part that arrived when a connection breaks halfway a piece", async () => {
    await start();
    // The connection breaks only once the first 1000 bytes are on disk, so the test does not depend on how busy the pc is.
    const part = join(dir, "incoming", `${fp}.part`);
    async function* broken() {
      yield data.subarray(0, 1000);
      for (let i = 0; i < 500 && ((await stat(part).catch(() => null))?.size ?? 0) < 1000; i++) await new Promise((r) => setTimeout(r, 10));
      throw new Error("verbinding weg");
    }
    await expect(store.append(fp, 0, CHUNK_SIZE, broken())).rejects.toThrow();
    expect(await start()).toEqual({ state: "partial", received: 1000 });
    expect(await piece(1000, data.length)).toBe(data.length);
    expect((await store.complete(fp)).duplicateOf).toBeNull();
  });

  it("recognises a second upload of the same file as a duplicate", async () => {
    await start();
    await piece(0, data.length);
    await store.complete(fp);
    const again = await start();
    expect(again.state).toBe("complete");
    expect((await store.complete(fp)).duplicateOf?.fingerprint).toBe(fp);
    expect(await store.list()).toHaveLength(1);
  });

  it("refuses a file that does not match its fingerprint", async () => {
    await start();
    await store.append(fp, 0, data.length, Readable.from([randomBytes(data.length)]));
    await expect(store.complete(fp)).rejects.toMatchObject({ status: 422 });
    expect(await store.list()).toHaveLength(0);
  });

  it("refuses pieces that are larger than announced or outside the file", async () => {
    await start();
    await expect(store.append(fp, 0, 10, Readable.from([data.subarray(0, 20)]))).rejects.toBeInstanceOf(StoreError);
    expect(await start()).toEqual({ state: "new", received: 0 });
    await expect(store.append(fp, 0, 16 * 1024 * 1024, Readable.from([]))).rejects.toMatchObject({ status: 400 });
  });

  it("refuses files that are not video", async () => {
    await expect(store.start({ fingerprint: fp, size: 10, name: "notes.txt", label: "x", isTest: true })).rejects.toMatchObject({ status: 400 });
  });

  it("runs the intake with ffprobe", async () => {
    await start();
    await piece(0, data.length);
    await store.complete(fp);
    expect((await store.intake(fp)).probe?.width).toBe(1920);
  });
});

describe("worker server", () => {
  it("only lets the dashboard in and handles a full upload over HTTP", async () => {
    const server = createWorkerServer({ store, allowedOrigins: ["http://localhost:3100"], health: () => ({ ok: true, version: "t", ffmpeg: null, queue: "local", dataDir: dir }) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { origin: "http://localhost:3100" };
    try {
      expect((await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
      const health = await fetch(`${base}/health`, { headers });
      expect(health.headers.get("access-control-allow-origin")).toBe("http://localhost:3100");

      const begin = async () =>
        (await (await fetch(`${base}/uploads`, { method: "POST", headers, body: JSON.stringify({ fingerprint: fp, size: data.length, name: "TESTDATA.mp4", label: "TESTDATA", isTest: true }) })).json()) as UploadState;
      let state = await begin();
      for (let c = nextChunk(state.received, data.length); c; c = nextChunk(state.received, data.length)) {
        const res = await fetch(`${base}/uploads/${fp}?offset=${c.start}`, { method: "PUT", headers, body: data.subarray(c.start, c.end) });
        state = { state: "partial", received: ((await res.json()) as { received: number }).received };
      }
      const done = (await (await fetch(`${base}/uploads/${fp}/complete`, { method: "POST", headers })).json()) as CompleteResult;
      expect(done.duplicateOf).toBeNull();
      expect((await begin()).state).toBe("complete");
    } finally {
      server.close();
    }
  });
});

describe("fingerprint from disk (fix 14-11-2026: openAsBlob read wrong bytes above 4 GB)", () => {
  it("reads exactly the same bytes as the browser File would", async () => {
    const { diskBlob } = await import("./store.ts");
    const { computeFingerprint } = await import("../lib/youtube/fingerprint.ts");
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "fp-"));
    try {
      const data = Buffer.alloc(40 * 1024 * 1024);
      for (let i = 0; i < data.length; i += 4096) data.writeUInt32LE(i, i);
      const file = join(dir, "x.webm");
      await writeFile(file, data);
      expect(await computeFingerprint(await diskBlob(file))).toBe(await computeFingerprint(new Blob([data])));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

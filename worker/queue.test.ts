import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueue, type Publisher } from "./queue.ts";
import type { Store } from "./store.ts";

type Call = { table: string; op: "select" | "update" | "insert"; values?: Record<string, unknown>; filters: [string, string, unknown][] };

/** A tiny stand-in for the Supabase client: records every call and answers from a script. */
function fakeDb(answers: { running?: unknown[]; claim?: unknown[][]; rows?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  const claims = [...(answers.claim ?? [])];
  const builder = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const chain = {
      select() {
        if (call.op === "select") calls.push(call);
        return chain;
      },
      insert(values: Record<string, unknown>) {
        call.op = "insert";
        call.values = values;
        calls.push(call);
        return chain;
      },
      maybeSingle: () => chain,
      single: () => chain,
      update(values: Record<string, unknown>) {
        call.op = "update";
        call.values = values;
        calls.push(call);
        return chain;
      },
      eq(col: string, v: unknown) {
        call.filters.push(["eq", col, v]);
        return chain;
      },
      in(col: string, v: unknown) {
        call.filters.push(["in", col, v]);
        return chain;
      },
      returns: () => chain,
      then(resolve: (r: unknown) => void) {
        resolve(call.op === "select" && table === "yt_jobs" ? { data: answers.running ?? [], error: null } : call.op === "select" && answers.rows?.[table] ? { data: answers.rows[table], error: null } : { data: null, error: null });
      },
    };
    return chain;
  };
  const db = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: claims.shift() ?? [], error: null }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

const store = {} as Store;
const make = (db: SupabaseClient, logs: string[] = []) => createQueue("http://x", "k", "pc-test", store, (m) => logs.push(m), null, null, db);
const filter = (c: Call, col: string) => c.filters.find((f) => f[1] === col)?.[2];

describe("recovery after a restart", () => {
  it("puts its own interrupted steps back in the queue straight away", async () => {
    const { db, calls } = fakeDb({ running: [{ id: "j1", step: "intake", video_id: null, attempts: 1, max_attempts: 3 }] });
    expect(await make(db).recover()).toBe(1);
    const upd = calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!;
    expect(upd.values).toMatchObject({ status: "queued", locked_by: null, finished_at: null });
    expect(filter(upd, "locked_by")).toBe("pc-test");
    expect(calls.some((c) => c.table === "yt_videos")).toBe(false);
  });

  it("only looks at steps of this worker", async () => {
    const { db, calls } = fakeDb();
    await make(db).recover();
    const sel = calls.find((c) => c.op === "select")!;
    expect(filter(sel, "status")).toBe("running");
    expect(filter(sel, "locked_by")).toBe("pc-test");
  });

  it("gives up after the last attempt and frees the video of a montage", async () => {
    const { db, calls } = fakeDb({ running: [{ id: "j2", step: "render", video_id: "v1", attempts: 3, max_attempts: 3 }] });
    await make(db).recover();
    expect(calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!.values).toMatchObject({ status: "failed", error: "Onderbroken: de werker is opnieuw gestart" });
    const video = calls.find((c) => c.table === "yt_videos")!;
    expect(video.values).toEqual({ status: "scripted" });
    expect(filter(video, "status")).toBe("rendering");
  });
});

describe("a montage that fails", () => {
  const job = (attempts: number) => ({ id: "r1", studio_id: "h", recording_id: null, video_id: "v1", step: "render", attempts, max_attempts: 3, payload: {} });

  it("is tried again while attempts are left, and the video stays on montage", async () => {
    const { db, calls } = fakeDb({ claim: [[job(1)]] });
    await make(db).tick();
    expect(calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!.values).toMatchObject({ status: "queued" });
    expect(calls.some((c) => c.table === "yt_videos")).toBe(false);
  });

  it("frees the video after the last attempt", async () => {
    const logs: string[] = [];
    const { db, calls } = fakeDb({ claim: [[job(3)]] });
    await make(db, logs).tick();
    expect(calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!.values).toMatchObject({ status: "failed" });
    expect(calls.find((c) => c.table === "yt_videos")!.values).toEqual({ status: "scripted" });
    expect(logs.some((l) => l.includes("mislukt"))).toBe(true);
  });
});

describe("a private upload to YouTube", () => {
  const job = { id: "u1", studio_id: "h", recording_id: null, video_id: "v1", step: "upload", attempts: 1, max_attempts: 5, payload: { publication_id: "p1" } };
  const pub = { id: "p1", video_id: "v1", render_id: "r1", title: "[TEST] Minecraft", description: "", tags: [], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false, visibility: "private", publish_at: null, status: "queued", youtube_video_id: null, is_test: true };
  const publisher = (states: string[], uploads: string[] = [], statuses: unknown[] = []): Publisher => ({
    rendersDir: "C:/renders",
    pollMs: 0,
    uploader: {
      upload: async (a: Parameters<Publisher["uploader"]["upload"]>[0]) => {
        uploads.push(a.file.split("\\").join("/"));
        statuses.push({ upload: a.meta.visibility, publish_at: a.meta.publish_at });
        a.onProgress(5, 10);
        a.onProgress(10, 10);
        return { videoId: "vid12345678", resumed: false, adopted: false, bytes: 10 };
      },
      setStatus: async (id: string, m: unknown) => void statuses.push({ id, ...(m as object) }),
      processing: async () => ({ uploadStatus: states.shift() ?? "processed", processingStatus: null, privacyStatus: "private", reason: null }),
    } as unknown as Publisher["uploader"],
  });
  const run = async (rows: Record<string, unknown>, p: Publisher, j: typeof job = job) => {
    const { db, calls } = fakeDb({ claim: [[j]], rows });
    await createQueue("http://x", "k", "pc-test", store, () => {}, null, null, db, p).tick();
    return calls.filter((c) => c.op === "update" && c.table === "yt_publications").map((c) => c.values);
  };

  it("uploads the chosen montage, stores the video ID and waits for processing", async () => {
    const uploads: string[] = [];
    const updates = await run({ yt_publications: pub, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, publisher(["uploaded", "processed"], uploads));
    expect(uploads).toEqual(["C:/renders/m.mp4"]);
    expect(updates).toEqual([{ status: "uploading", error: null }, { youtube_video_id: "vid12345678", status: "processing", error: null }, { status: "uploaded", error: null }]);
  });

  it("does not upload again when the video ID is already known", async () => {
    const uploads: string[] = [];
    const updates = await run({ yt_publications: { ...pub, status: "processing", youtube_video_id: "vid12345678" } }, publisher([], uploads));
    expect(uploads).toEqual([]);
    expect(updates).toEqual([{ status: "uploaded", error: null }]);
  });

  it("refuses a publication that Milan did not send, or one that is not private", async () => {
    const uploads: string[] = [];
    expect(await run({ yt_publications: { ...pub, status: "draft" } }, publisher([], uploads))).toEqual([]);
    expect(await run({ yt_publications: { ...pub, visibility: "public" } }, publisher([], uploads))).toEqual([]);
    expect(await run({ yt_publications: { ...pub, made_for_kids: null } }, publisher([], uploads))).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("marks the publication failed when YouTube rejects the video", async () => {
    const updates = await run({ yt_publications: pub, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, publisher(["rejected"]));
    expect(updates.at(-1)).toMatchObject({ status: "failed" });
  });

  // Fase D4: scheduling and publishing a real (non-test) video.
  const real = { ...pub, is_test: false, title: "Minecraft: echt" };
  it("uploads a scheduled video private with its moment and ends as scheduled", async () => {
    const statuses: unknown[] = [];
    const updates = await run({ yt_publications: { ...real, publish_at: "2026-11-20T17:30:00.000Z" }, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, publisher([], [], statuses));
    expect(statuses).toEqual([{ upload: "private", publish_at: "2026-11-20T17:30:00.000Z" }]);
    expect(updates.at(-1)).toEqual({ status: "scheduled", error: null });
  });

  it("publishes a video that is already on YouTube by changing only its visibility", async () => {
    const statuses: unknown[] = [];
    const uploads: string[] = [];
    const updates = await run({ yt_publications: { ...real, visibility: "public", youtube_video_id: "vid12345678" } }, publisher([], uploads, statuses), { ...job, step: "publish" });
    expect(uploads).toEqual([]);
    expect(statuses).toEqual([{ id: "vid12345678", made_for_kids: false, contains_synthetic_media: false, visibility: "public", publish_at: null }]);
    expect(updates).toEqual([{ status: "published", error: null }]);
  });

  it("never makes a test video public, also not in the worker", async () => {
    const statuses: unknown[] = [];
    expect(await run({ yt_publications: { ...pub, visibility: "public", youtube_video_id: "vid12345678" } }, publisher([], [], statuses), { ...job, step: "publish" })).toEqual([]);
    expect(await run({ yt_publications: { ...pub, publish_at: "2026-11-20T17:30:00.000Z" }, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, publisher([], [], statuses))).toEqual([]);
    expect(statuses).toEqual([]);
  });
});

describe("captions and thumbnail after the upload (fase D4b)", () => {
  it("sends the SRT and the chosen frame, and reports both without failing the step", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "extras-"));
    writeFileSync(join(dir, "m.srt"), "1\n00:00:00,000 --> 00:00:01,200\nNo way out.\n");
    const sent: string[] = [];
    const p: Publisher = {
      rendersDir: dir,
      tmpDir: dir,
      frame: async (_input, atMs, output) => {
        sent.push(`frame ${atMs}`);
        writeFileSync(output, Buffer.from([0xff, 0xd8]));
      },
      uploader: {
        insertCaption: async (_id: string, lang: string, srt: string) => (sent.push(`captions ${lang} ${srt.includes("No way out.")}`), "cap1"),
        setThumbnail: async () => {
          sent.push("thumbnail");
          throw new Error("YouTube staat eigen thumbnails voor dit kanaal nog niet toe.");
        },
        processing: async () => ({ uploadStatus: "processed", processingStatus: null, privacyStatus: "private", reason: null }),
      } as unknown as Publisher["uploader"],
    };
    const pub = { id: "p1", video_id: "v1", render_id: "r1", title: "x", description: "", tags: [], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false, visibility: "private", publish_at: null, status: "queued", youtube_video_id: "vid12345678", is_test: true, captions_enabled: true, thumbnail_ms: 5000, captions_status: null, thumbnail_status: null };
    const { db, calls } = fakeDb({ claim: [[{ id: "e1", studio_id: "h", recording_id: null, video_id: "v1", step: "publish", attempts: 1, max_attempts: 3, payload: { publication_id: "p1", action: "extras" } }]], rows: { yt_publications: pub, yt_renders: { file_name: "m.mp4" } } });
    await createQueue("http://x", "k", "pc-test", store, () => {}, null, null, db, p).tick();
    rmSync(dir, { recursive: true, force: true });
    expect(sent).toEqual(["captions en true", "frame 5000", "thumbnail"]);
    const updates = calls.filter((c) => c.op === "update" && c.table === "yt_publications").map((c) => c.values!);
    expect(String(updates[0].captions_status)).toMatch(/^Klaar op .* \(spoor cap1\)$/);
    expect(String(updates[1].thumbnail_status)).toMatch(/^Mislukt: YouTube staat eigen thumbnails/);
    expect(updates.at(-1)).toEqual({ status: "uploaded", error: null });
    expect(calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values && c.values.status !== "cancelled")!.values).toMatchObject({ status: "done" });
  });
});

describe("AI suggestions (fase 1.6)", () => {
  const job = { id: "s1", studio_id: "h", recording_id: null, video_id: "v1", step: "suggest", attempts: 1, max_attempts: 2, payload: { title: "", description: "" } };

  it("runs in the fast lane, so it never waits behind a montage", async () => {
    const { db, calls } = fakeDb({ claim: [[job]], rows: { yt_videos: { id: "v1", format: "A", language: "nl", is_test: true, channel_id: null } } });
    await make(db).tickFast();
    const done = calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!;
    expect(done.values).toMatchObject({ status: "done" });
    expect((done.values!.result as { source: string; tags: string[] }).source).toBe("test");
    expect((done.values!.result as { tags: string[] }).tags.length).toBeGreaterThanOrEqual(10);
  });

  it("is never claimed by the main lane", async () => {
    let asked: string[] = [];
    const { db } = fakeDb();
    (db as unknown as { rpc: (n: string, a: { p_steps: string[] }) => Promise<unknown> }).rpc = async (_n, a) => {
      asked = a.p_steps;
      return { data: [], error: null };
    };
    await make(db).tick();
    expect(asked).not.toContain("suggest");
  });

  it("fails with a clear reason for real footage without an analysis key", async () => {
    const { db, calls } = fakeDb({ claim: [[{ ...job, attempts: 2 }]], rows: { yt_videos: { id: "v1", format: "A", language: "nl", is_test: false, channel_id: null } } });
    await make(db).tickFast();
    const done = calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values && "status" in c.values)!;
    expect(done.values).toMatchObject({ status: "failed" });
    expect(String(done.values!.error)).toContain("GEMINI_API_KEY");
  });
});

describe("opschonen: one video, one place (13-11-2026)", () => {
  const job = { id: "u1", studio_id: "h", recording_id: null, video_id: "v1", step: "upload", attempts: 1, max_attempts: 5, payload: { publication_id: "p1" } };
  const pub = { id: "p1", video_id: "v1", render_id: "r1", title: "[TEST] Minecraft", description: "", tags: [], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false, visibility: "private", publish_at: null, status: "queued", youtube_video_id: null, is_test: true };
  const publisher = {
    rendersDir: "C:/renders",
    pollMs: 0,
    uploader: {
      upload: async () => ({ videoId: "vid12345678", bytes: 10, adopted: false }),
      setStatus: async () => undefined,
      processing: async () => ({ uploadStatus: "processed", processingStatus: null, privacyStatus: "private", reason: null }),
    } as unknown as Publisher["uploader"],
  } as Publisher;

  it("after a successful upload the video is live and its open steps are closed", async () => {
    const { db, calls } = fakeDb({ claim: [[job]], rows: { yt_publications: pub, yt_renders: { file_name: "m.mp4", video_id: "v1" } } });
    await createQueue("http://x", "k", "pc-test", store, () => {}, null, null, db, publisher).tick();
    const video = calls.find((c) => c.op === "update" && c.table === "yt_videos")!;
    expect(video.values).toMatchObject({ youtube_video_id: "vid12345678", status: "published" });
    const closed = calls.find((c) => c.op === "update" && c.table === "yt_jobs" && c.values?.status === "cancelled")!;
    expect(filter(closed, "video_id")).toBe("v1");
    expect(filter(closed, "status")).toBe("queued");
  });

  it("a step without a sign of life for 2 hours becomes failed with the reason", async () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const { db, calls } = fakeDb({ running: [{ id: "old", step: "render", video_id: "v1", heartbeat_at: "2026-11-13T09:00:00Z", locked_at: "2026-11-13T08:00:00Z" }, { id: "fresh", step: "render", video_id: "v2", heartbeat_at: "2026-11-13T11:59:00Z", locked_at: "2026-11-13T11:00:00Z" }] });
    await make(db).failStuck(now);
    const failed = calls.filter((c) => c.op === "update" && c.table === "yt_jobs" && c.values?.status === "failed");
    expect(failed.map((c) => filter(c, "id"))).toEqual(["old"]);
    expect(failed[0].values).toMatchObject({ error: "Vastgelopen: 2 uur geen voortgang" });
  });
});

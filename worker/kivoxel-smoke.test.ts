// KIVOXEL smoke test (Dreamnest fase 0). Runs in `npm test` after every Dreamnest phase and proves the KIVOXEL chain
// still works end to end without Supabase, YouTube or FFmpeg: upload (intake) -> bewerking (script/montage lanes) ->
// preview (flow: review) -> publish dry-run (private/scheduled upload with a fake uploader). It also pins which steps
// each KIVOXEL lane claims, so a Dreamnest step can never land in (or block) a KIVOXEL lane.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueue, type Montage, type Publisher } from "./queue.ts";
import type { Store } from "./store.ts";
import { placeOf, type FlowJob, type FlowPublication, type FlowVideo } from "../lib/youtube/flow.ts";
import type { BoardScript } from "../lib/youtube/board.ts";

type Call = { table: string; op: string; values?: Record<string, unknown> };

/** Minimal Supabase stand-in: answers rows per table, hands out scripted claims and records rpc arguments. */
function fakeDb(rows: Record<string, unknown>, claims: unknown[][] = []) {
  const calls: Call[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const queue = [...claims];
  const from = (table: string) => {
    const call: Call = { table, op: "select" };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (values: Record<string, unknown>) => ((call.op = "insert"), (call.values = values), chain),
      update: (values: Record<string, unknown>) => ((call.op = "update"), (call.values = values), chain),
      upsert: (values: Record<string, unknown>) => ((call.op = "upsert"), (call.values = values), chain),
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      lt: () => chain,
      order: () => chain,
      limit: () => chain,
      returns: () => chain,
      single: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (r: unknown) => void) => {
        calls.push(call);
        resolve(call.op === "select" ? { data: rows[table] ?? null, error: null } : { data: null, error: null });
      },
    };
    return chain;
  };
  const db = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: fn === "claim_yt_job" ? (queue.shift() ?? []) : null, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs };
}

const job = (step: string, over: Record<string, unknown> = {}) => ({ id: `j-${step}`, studio_id: "s", recording_id: null, video_id: "v1", step, attempts: 1, max_attempts: 5, payload: null, ...over });
const montage = { rendersDir: "C:/renders", tmpDir: "C:/tmp" } as unknown as Montage;

describe("KIVOXEL smoke test", () => {
  it("lanes: KIVOXEL claims exactly its own steps, never a Dreamnest step", async () => {
    const publisher = { rendersDir: "C:/renders", uploader: {} } as unknown as Publisher;
    const { db, rpcs } = fakeDb({});
    const q = createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, montage, db, publisher);
    await q.tick();
    await q.tickFast();
    const steps = rpcs.filter((r) => r.fn === "claim_yt_job").map((r) => r.args.p_steps as string[]);
    expect(steps).toEqual([
      ["intake", "analyse", "script", "render", "upload", "publish"],
      ["suggest", "viral", "reference"],
    ]);
    expect(steps.flat().some((s) => s.startsWith("dn_"))).toBe(false);
  });

  it("1 upload: a test recording passes intake and goes on to the analysis", async () => {
    const store = {
      get: async () => ({ fingerprint: "fp", sha256: "abc", probe: { durationMs: 60_000, width: 1920, height: 1080, fps: 60, videoCodec: "h264", audioCodec: "aac" }, intakeError: null }),
    } as unknown as Store;
    const { db, calls } = fakeDb({ yt_recordings: { id: "r1", fingerprint: "fp", status: "received", is_test: true, duration_ms: null } }, [[job("intake", { recording_id: "r1", video_id: null })]]);
    await createQueue("http://x", "k", "pc-smoke", store, () => {}, null, null, db).tick();
    expect(calls.find((c) => c.table === "yt_recordings" && c.op === "update")?.values).toMatchObject({ status: "ready", duration_ms: 60_000 });
    expect(calls.find((c) => c.table === "yt_jobs" && c.op === "insert")?.values).toMatchObject({ step: "analyse", recording_id: "r1" });
    expect(calls.filter((c) => c.table === "yt_jobs" && c.op === "update").at(-1)?.values).toMatchObject({ status: "done" });
  });

  it("2-3 bewerking and preview: one video moves production -> review -> ready", () => {
    const v = (over: Partial<FlowVideo>): FlowVideo => ({ id: "v1", recording_id: "r1", format: "A", status: "scripted", is_test: true, channel_id: "c1", created_at: "2026-11-13T10:00:00Z", ...over });
    const s: BoardScript[] = [{ id: "s1", video_id: "v1", version: 1, status: "approved" }];
    const render: FlowJob = { id: "j1", recording_id: null, video_id: "v1", step: "render", status: "running", error: null, created_at: "2026-11-13T11:00:00Z", phase: "Video renderen" };
    expect(placeOf(v({ status: "rendering" }), s, null, [render])).toMatchObject({ flow: "production", sub: "montage" });
    expect(placeOf(v({ status: "review" }), s, null, [])).toMatchObject({ flow: "review", reviewKind: "final" });
    expect(placeOf(v({ status: "approved" }), s, null, []).flow).toBe("ready");
  });

  it("4 publish dry-run: a test video goes up private, never scheduled or public", async () => {
    const pub: FlowPublication & Record<string, unknown> = { id: "p1", video_id: "v1", render_id: "r1", title: "[TEST] Minecraft", description: "", tags: [], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false, visibility: "private", publish_at: null, status: "queued", youtube_video_id: null, is_test: true, error: null };
    const sent: unknown[] = [];
    const publisher: Publisher = {
      rendersDir: "C:/renders",
      pollMs: 0,
      uploader: {
        upload: async (a: Parameters<Publisher["uploader"]["upload"]>[0]) => (sent.push(a.meta.visibility), { videoId: "vid12345678", resumed: false, adopted: false, bytes: 1 }),
        setStatus: async (_id: string, m: { visibility: string }) => void sent.push(m.visibility),
        processing: async () => ({ uploadStatus: "processed", processingStatus: null, privacyStatus: "private", reason: null }),
      } as unknown as Publisher["uploader"],
    };
    const { db, calls } = fakeDb({ yt_publications: pub, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, [[job("upload", { payload: { publication_id: "p1" } })]]);
    await createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, null, db, publisher).tick();
    expect(sent).toEqual(["private"]);
    expect(calls.filter((c) => c.table === "yt_publications" && c.op === "update").at(-1)?.values).toEqual({ status: "uploaded", error: null });

    // A test video is never scheduled or made public by the worker.
    sent.length = 0;
    const scheduled = fakeDb({ yt_publications: { ...pub, publish_at: "2026-11-20T17:30:00.000Z" }, yt_renders: { file_name: "m.mp4", video_id: "v1" } }, [[job("upload", { payload: { publication_id: "p1" } })]]);
    await createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, null, scheduled.db, publisher).tick();
    const second = fakeDb({ yt_publications: { ...pub, visibility: "public", youtube_video_id: "vid12345678" } }, [[job("publish", { payload: { publication_id: "p1" } })]]);
    await createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, null, second.db, publisher).tick();
    expect(sent).toEqual([]);
  });

  it("5 channel check (fase 0.5): an upload only goes to the YouTube channel of the video's channel", async () => {
    const pub = { id: "p1", video_id: "v1", render_id: "r1", title: "[TEST] Minecraft", description: "", tags: [], category_id: "20", language: "en", made_for_kids: false, contains_synthetic_media: false, visibility: "private", publish_at: null, status: "queued", youtube_video_id: null, is_test: true, error: null };
    const rows = { yt_publications: pub, yt_renders: { file_name: "m.mp4", video_id: "v1" }, yt_videos: { channel_id: "c1" }, yt_channels: { id: "c1", name: "KIVOXEL", youtube_channel_id: "UCkivoxel" } };
    const sent: string[] = [];
    const publisher = (tokens: string): Publisher => ({
      rendersDir: "C:/renders",
      pollMs: 0,
      tokensChannelId: async () => tokens,
      uploader: {
        upload: async () => (sent.push("upload"), { videoId: "vid12345678", resumed: false, adopted: false, bytes: 1 }),
        setStatus: async () => undefined,
        processing: async () => ({ uploadStatus: "processed", processingStatus: null, privacyStatus: "private", reason: null }),
      } as unknown as Publisher["uploader"],
    });
    const ok = fakeDb(rows, [[job("upload", { payload: { publication_id: "p1" } })]]);
    await createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, null, ok.db, publisher("UCkivoxel")).tick();
    expect(sent).toEqual(["upload"]);
    sent.length = 0;
    const wrong = fakeDb(rows, [[job("upload", { payload: { publication_id: "p1" } })]]);
    await createQueue("http://x", "k", "pc-smoke", {} as Store, () => {}, null, null, wrong.db, publisher("UCdreamnest")).tick();
    expect(sent).toEqual([]);
    expect(JSON.stringify(wrong.calls.filter((c) => c.op === "update"))).toMatch(/ander kanaal dan KIVOXEL/);
  });
});

// A long recording told in parts (Deel 1..N): planned again from the moments already found, without a new (paid) analysis.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQueue } from "./queue.ts";
import type { Store } from "./store.ts";

type Call = { table: string; op: string; values?: unknown; filters: [string, string, unknown][] };

const DURATION = 37 * 60_000 + 21_000;
/** One moment every ~2 minutes over the whole recording, all usable. */
const MOMENTS = Array.from({ length: 16 }, (_, i) => {
  const start = 60_000 + i * 135_000;
  return { id: `m${i + 1}`, kind: "near_death", start_ms: start, end_ms: start + 12_000, peak_ms: start + 8_000, reason: `moment ${i + 1}`, score: 70 + (i % 5), has_context: true, has_payoff: true, context_note: null, payoff_note: null, privacy_flags: [], suggested_format: "A" };
});

function fakeDb(existingParts: unknown[] = []) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const record = (op: string, values?: unknown) => {
      call.op = op;
      call.values = values;
      calls.push(call);
      return chain;
    };
    const chain: Record<string, unknown> = {
      select: () => (call.op === "select" ? record("select") : chain),
      insert: (v: unknown) => record("insert", v),
      upsert: (v: unknown) => record("upsert", v),
      update: (v: unknown) => record("update", v),
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), chain),
      neq: (c: string, v: unknown) => (call.filters.push(["neq", c, v]), chain),
      like: (c: string, v: unknown) => (call.filters.push(["like", c, v]), chain),
      in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => chain,
      single: () => chain,
      returns: () => chain,
      then(resolve: (r: unknown) => void) {
        const f = (col: string) => call.filters.find((x) => x[1] === col)?.[2];
        let data: unknown = null;
        if (call.op === "select" && table === "yt_recordings") data = { id: "rec", fingerprint: "fp", status: "ready", is_test: false, duration_ms: DURATION };
        else if (call.op === "select" && table === "yt_moments") data = MOMENTS;
        else if (call.op === "select" && table === "yt_videos") data = call.filters.some((x) => x[0] === "like") ? existingParts : { id: `video:${String(f("plan_key"))}` };
        else if (call.op === "select" && table === "yt_jobs") data = [];
        resolve({ data, error: null });
      },
    };
    return chain;
  };
  const job = { id: "j1", studio_id: "h", recording_id: "rec", video_id: null, step: "analyse", attempts: 1, max_attempts: 3, payload: { replan: true } };
  const claims = [[job]];
  const db = { from: (t: string) => builder(t), rpc: async () => ({ data: claims.shift() ?? [], error: null }) } as unknown as SupabaseClient;
  return { db, calls };
}

// No analysis service at all: replanning must not need one.
const run = async (db: SupabaseClient) => createQueue("http://x", "k", "pc-test", {} as Store, () => {}, null, null, db).tick();

describe("a long recording told in parts", () => {
  it("plans the parts from the stored moments, without a new analysis, and queues a script per part", async () => {
    const { db, calls } = fakeDb();
    await run(db);
    const done = calls.find((c) => c.op === "update" && c.table === "yt_jobs" && (c.values as { status?: string }).status)!;
    expect(done.values).toMatchObject({ status: "done", result: { source: "replan" } });
    const parts = calls.filter((c) => c.op === "upsert" && c.table === "yt_videos").map((c) => (c.values as { plan_key: string }).plan_key).filter((k) => k.includes(":C:part:"));
    expect(parts.length).toBe(5);
    expect(parts[0]).toMatch(/^rec:C:part:1\/5:0-\d+$/);
    expect(parts.at(-1)!.startsWith("rec:C:part:5/5:") && parts.at(-1)!.endsWith(`-${DURATION}`)).toBe(true);
    // Every moment is linked to exactly one part.
    const partLinks = calls.filter((c) => c.op === "upsert" && c.table === "yt_video_moments" && String((c.values as { video_id: string }[])[0]?.video_id).includes(":C:part:"));
    expect(partLinks.flatMap((c) => (c.values as { moment_id: string }[]).map((l) => l.moment_id)).sort()).toEqual(MOMENTS.map((m) => m.id).sort());
    const scripts = calls.filter((c) => c.op === "insert" && c.table === "yt_jobs" && (c.values as { step: string }).step === "script");
    expect(scripts.length).toBe(parts.length + 6);
    // The stored moments are not touched.
    expect(calls.some((c) => c.table === "yt_moments" && c.op !== "select")).toBe(false);
  });

  it("does not start a second series when the parts already exist", async () => {
    const { db, calls } = fakeDb([{ id: "old-part" }]);
    await run(db);
    expect(calls.some((c) => c.op === "upsert" && c.table === "yt_videos" && (c.values as { plan_key: string }).plan_key.includes(":C:part:"))).toBe(false);
  });
});

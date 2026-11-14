import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { DnJob } from "./lane.ts";
import { createLedger } from "./ledger.ts";
import { createDnHandlers, qcProblems, type RunScript } from "./steps.ts";

function fakeDb(episode: Record<string, unknown>) {
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    let values: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (v: Record<string, unknown>) => ((values = v), chain),
      eq: () => chain,
      single: () => chain,
      then: (resolve: (r: unknown) => void) => {
        if (values) updates.push({ table, values });
        resolve(values ? { data: null, error: null } : { data: episode, error: null });
      },
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}
const job = (step: DnJob["step"], payload: Record<string, unknown> = {}): DnJob => ({ id: "j1", studio_id: "s", episode_id: "e1", step, attempts: 1, max_attempts: 3, payload });

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("Dreamnest worker steps (fase 0.5)", () => {
  it("runs the phase script and shows the result: render with QC and preview, episode to packaging", async () => {
    dir = await mkdtemp(join(tmpdir(), "dn-steps-"));
    const out = join(dir, "dreamnest", "fase4", "60min");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "qc.json"), JSON.stringify({ ok: true, video: { problems: [] }, audio: [] }));
    const ran: string[][] = [];
    const run: RunScript = async (script, args, onLine) => {
      ran.push([script, ...args]);
      onLine("[09:12:27] Render 54% (50/73), nog ± 20 min");
    };
    const { db, updates } = fakeDb({ id: "e1", title: "Lumi", duration_min: 60, spent_cents: 0 });
    const h = createDnHandlers({ db, dataDir: dir, log: () => {}, run });
    const r = (await h.dn_render!(job("dn_render", { seed: 7 }))) as Record<string, unknown>;
    expect(ran).toEqual([["fase4.ts", "--minutes", "60", "--seed", "7"]]);
    expect(r).toMatchObject({ qc_ok: true, qc_problems: [], files: ["fase4/60min/preview.mp4"], video: "fase4/60min/dreamnest-60min.mp4", paid_cents: 0 });
    expect(updates.filter((u) => u.table === "dn_episodes").map((u) => u.values.status)).toEqual(["rendering", "packaging"]);
    expect(updates.find((u) => u.table === "dn_render_jobs")?.values).toMatchObject({ progress: 54 });
  });

  it("books what a paid step really cost on the episode, also when it stops halfway", async () => {
    dir = await mkdtemp(join(tmpdir(), "dn-steps-"));
    const base = join(dir, "dreamnest");
    const run: RunScript = async () => {
      await createLedger(base, 10_000).add({ provider: "google", model: "omni", purpose: "clip", cents: 83, cacheKey: null });
      throw new Error("Budget op");
    };
    const { db, updates } = fakeDb({ id: "e1", title: "Lumi", duration_min: 60, spent_cents: 100 });
    const h = createDnHandlers({ db, dataDir: dir, log: () => {}, run });
    await expect(h.dn_animate!(job("dn_animate"))).rejects.toThrow(/Budget op/);
    expect(updates.find((u) => u.values.spent_cents !== undefined)?.values).toEqual({ spent_cents: 183 });
  });

  it("summarises QC problems for the Studio", () => {
    expect(qcProblems(null)).toEqual(["Geen controlerapport gevonden"]);
    expect(qcProblems({ ok: false, video: { problems: ["licht verspringt bij 0:36"] }, audio: [{ part: "sleep", problems: ["te luid"] }] })).toEqual(["Beeld: licht verspringt bij 0:36", "Geluid sleep: te luid"]);
  });
});

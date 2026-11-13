import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Character, Shot } from "../../lib/dreamnest/bible.ts";
import type { ImageProvider, VisionProvider } from "../providers/image/types.ts";
import { createCache, createLedger } from "./ledger.ts";
import { runShots } from "./shots.ts";

const lumi: Character = { id: "lumi", name: "Lumi van Dreamnest", pronouns: "she/her", prompt_dna: "lilac bunny", palette: {}, proportions: "", expressions: [], never: [], reference_images: ["lumi/ref.jpg"] };
const pip: Character = { ...lumi, id: "pip", name: "Pip", reference_images: [] };
const shot = (over: Partial<Shot> = {}): Shot => ({ id: "s1", stage: "a", kind: "character_sheet", characters: ["lumi"], set: null, description: "d", aspect: "16:9", size: "1K", variants: 1, ...over });

async function setup(scores: number[], ceiling = 1000) {
  const dir = await mkdtemp(join(tmpdir(), "dn-"));
  const calls: string[] = [];
  const image: ImageProvider = { name: "fake", model: "fake-img", estimateCents: () => 7, generate: async (r) => (calls.push(r.prompt), { mime: "image/png", data: Buffer.from(`img${calls.length}`), model: "fake-img", costCents: 7, usage: null }) };
  const queue = [...scores];
  const vision: VisionProvider = { model: "fake-vis", consistency: async () => ({ score: queue.shift() ?? 100, issues: ["ears too long"], costCents: 1 }) };
  const ledger = createLedger(dir, ceiling);
  const deps = { image, vision, ledger, cache: createCache(join(dir, "cache")), characters: [lumi, pip], sets: [], readRef: async () => ({ mime: "image/jpeg", data: Buffer.from("ref") }), save: async (n: string) => n, log: () => {} };
  return { deps, calls, ledger };
}

describe("making images for fase 1", () => {
  it("accepts a consistent image at once and logs its cost", async () => {
    const { deps, ledger } = await setup([90]);
    const [r] = await runShots([shot()], deps);
    expect(r).toMatchObject({ status: "accepted", attempts: 1, score: 90 });
    expect(await ledger.spent()).toBe(8);
  });

  it("retries with the differences, and hands over to Milan after 3 attempts", async () => {
    const { deps, calls } = await setup([50, 60, 70]);
    const [r] = await runShots([shot()], deps);
    expect(r).toMatchObject({ status: "to_milan", attempts: 3, score: 70 });
    expect(calls[1]).toMatch(/ears too long/);
  });

  it("never pays twice for the same request", async () => {
    const { deps, calls, ledger } = await setup([90, 90]);
    await runShots([shot()], deps);
    await runShots([shot()], deps);
    expect(calls).toHaveLength(1);
    expect(await ledger.spent()).toBe(8);
  });

  it("stops before the ceiling and marks the rest as waiting for budget", async () => {
    const { deps, calls } = await setup([90, 90, 90], 10);
    const r = await runShots([shot({ variants: 3 })], deps);
    expect(calls).toHaveLength(1);
    expect(r.map((x) => x.status)).toEqual(["accepted", "budget", "budget"]);
  });

  it("a keyframe waits for an approved design of every character", async () => {
    const { deps, calls } = await setup([]);
    const [r] = await runShots([shot({ stage: "b", kind: "keyframe", characters: ["lumi", "pip"] })], deps);
    expect(calls).toEqual([]);
    expect(r.error).toMatch(/Pip/);
  });

  it("a new design without a reference yet is made without a check", async () => {
    const { deps } = await setup([]);
    const [r] = await runShots([shot({ characters: ["pip"] })], deps);
    expect(r.status).toBe("no_check");
  });
});

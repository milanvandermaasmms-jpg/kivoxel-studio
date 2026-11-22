import { describe, expect, it } from "vitest";
import { decideVoice, ledgerKey, markDelivered, narrationValue, releaseSlot, voiceSummary, type VoiceLedger } from "./voicePlan";

const now = new Date("2026-11-23T10:00:00Z");
const run = (format: "short" | "long", values: number[], start: VoiceLedger = {}) => {
  let l = start;
  const key = ledgerKey("kiv", format);
  const out: boolean[] = [];
  values.forEach((v, i) => {
    const r = decideVoice(l, key, format, `v${i}`, { value: v, why: "test" }, now);
    l = r.ledger;
    out.push(r.slot.voice);
  });
  return { l, out, key };
};

describe("stemverdeling 1 van 3 Shorts, 1 van 5 lange video's", () => {
  it("exactly one voiced Short in every group of three, the best one to tell when it comes early", () => {
    const { out } = run("short", [0.3, 0.8, 0.2, 0.2, 0.2, 0.2, 0.7, 0.9, 0.1]);
    expect(out).toEqual([false, true, false, false, false, true, true, false, false]);
    for (let g = 0; g < 9; g += 3) expect(out.slice(g, g + 3).filter(Boolean)).toHaveLength(1);
  });

  it("exactly one voiced long video in every group of five; the last place is kept when nothing suited", () => {
    const { out } = run("long", [0.2, 0.2, 0.2, 0.2, 0.2, 0.9, 0.9, 0.2, 0.2, 0.2]);
    expect(out).toEqual([false, false, false, false, true, true, false, false, false, false]);
  });

  it("a retry, preview or version 2 of the same production never counts twice", () => {
    const { l, key } = run("short", [0.3, 0.8]);
    const again = decideVoice(l, key, "short", "v1", { value: 0.1, why: "x" }, now);
    expect(again.existing).toBe(true);
    expect(again.slot.voice).toBe(true);
    expect(again.ledger[key]).toHaveLength(2);
  });

  it("a production dropped for good gives its place back", () => {
    const { l, key } = run("short", [0.3, 0.8]);
    const freed = releaseSlot(l, key, "v1");
    expect(voiceSummary(freed, key, "short").planned).toEqual({ voice: 0, total: 1 });
    const next = decideVoice(freed, key, "short", "v9", { value: 0.2, why: "x" }, now);
    expect(next.slot.voice).toBe(false);
    const last = decideVoice(next.ledger, key, "short", "v10", { value: 0.2, why: "x" }, now);
    expect(last.slot.voice).toBe(true);
  });

  it("shows planned and delivered split; delivered counts once per production", () => {
    let { l, key } = run("short", [0.2, 0.2, 0.2]);
    l = markDelivered(markDelivered(l, key, "v2"), key, "v2");
    expect(voiceSummary(l, key, "short")).toMatchObject({ planned: { voice: 1, total: 3 }, delivered: { voice: 1, total: 1 }, openInGroup: 0 });
  });

  it("telling adds most to a failed plan or a find, least to a jumpscare or a readable chase", () => {
    expect(narrationValue({ kind: "mistake" }).value).toBeGreaterThan(narrationValue({ kind: "near_death" }).value);
    expect(narrationValue({ type: "jumpscare" }).value).toBeLessThan(0.6);
    expect(narrationValue({ kind: "discovery", description: "opens a secret chest" }).value).toBeGreaterThanOrEqual(0.8);
  });
});

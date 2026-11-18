import { describe, expect, it } from "vitest";
import { buildEditPlan, checkMoment, parseSeriesKey, partLabel, planVideos, scriptPrompt, seriesKey, seriesParts, seriesTitles, targetFor, MAX_LONG_VIDEOS, MAX_SHORTS_PER_RECORDING, PART_TARGET, TARGET, type Moment } from "./analysis";

// The 21 moments of "the one who watches" (37:21), as the analysis found them: start-end and score.
const DURATION = 37 * 60_000 + 21_000;
const FOUND: Array<[string, string, string, number]> = [
  ["near_death", "2:29", "2:35", 85], ["discovery", "5:05", "5:16", 75], ["near_death", "6:17", "6:25", 80], ["near_death", "12:16", "12:26", 85],
  ["near_death", "12:43", "12:53", 88], ["escape", "13:10", "13:21", 92], ["near_death", "14:20", "14:29", 90], ["near_death", "15:53", "16:04", 75],
  ["near_death", "18:30", "18:42", 85], ["near_death", "19:35", "19:46", 80], ["near_death", "22:55", "23:04", 65], ["near_death", "24:04", "24:13", 75],
  ["discovery", "24:44", "24:57", 65], ["rare_find", "28:27", "28:35", 70], ["surprise", "28:56", "29:05", 80], ["near_death", "29:26", "29:36", 85],
  ["near_death", "29:47", "29:55", 90], ["surprise", "30:24", "30:31", 75], ["near_death", "32:48", "32:58", 85], ["near_death", "37:03", "37:13", 90],
  ["surprise", "37:13", "37:21", 95],
];
const moments: Moment[] = FOUND.map(([kind, start, end, score], i) => {
  const r = checkMoment({ kind, start, end, reason: `moment ${i + 1}`, score, has_context: true, has_payoff: true }, DURATION);
  if ("error" in r) throw new Error(r.error);
  return { ...r.moment, id: `m${i + 1}` };
});

describe("a long recording told in parts", () => {
  const parts = seriesParts(moments, DURATION);

  it("cuts 37 minutes into at most two parts that cover everything, without gaps or overlap", () => {
    expect(parts.length).toBe(MAX_LONG_VIDEOS);
    expect(parts[0].startMs).toBe(0);
    expect(parts.at(-1)!.endMs).toBe(DURATION);
    for (let i = 1; i < parts.length; i++) expect(parts[i].startMs).toBe(parts[i - 1].endMs);
    for (const p of parts) expect(p.endMs - p.startMs).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("never cuts through a moment, and every moment lands in exactly one part", () => {
    for (const p of parts.slice(1)) for (const m of moments) expect(m.startMs < p.startMs && m.endMs > p.startMs).toBe(false);
    const plans = planVideos(moments, DURATION, (m) => m.id!).filter((p) => p.part);
    expect(plans.map((p) => p.planKey)).toEqual(parts.map(seriesKey));
    expect(plans.flatMap((p) => p.moments.map((m) => m.id)).sort()).toEqual(moments.map((m) => m.id).sort());
    for (const p of plans) expect(p.moments.length).toBeGreaterThan(0);
  });

  it("makes at most MAX_SHORTS_PER_RECORDING Shorts, each its own moment, and no single long video next to the parts", () => {
    const plans = planVideos(moments, DURATION, (m) => m.id!);
    const shorts = plans.filter((p) => p.format !== "C");
    expect(shorts.length).toBeGreaterThan(0);
    expect(shorts.length).toBeLessThanOrEqual(MAX_SHORTS_PER_RECORDING);
    expect(new Set(shorts.map((p) => p.moments[0].id)).size).toBe(shorts.length);
    expect(plans.filter((p) => p.format === "C")).toHaveLength(MAX_LONG_VIDEOS);
    expect(plans.some((p) => p.planKey === "C")).toBe(false);
  });

  it("a very long recording still gives at most two long videos", () => {
    const twoHours = 2 * 60 * 60_000;
    const spread = Array.from({ length: 40 }, (_, i) => ({ ...moments[i % moments.length], id: `x${i}`, startMs: i * 180_000 + 10_000, peakMs: i * 180_000 + 18_000, endMs: i * 180_000 + 22_000 }));
    expect(seriesParts(spread, twoHours)).toHaveLength(MAX_LONG_VIDEOS);
    expect(planVideos(spread, twoHours, (m) => m.id!).filter((p) => p.format === "C")).toHaveLength(MAX_LONG_VIDEOS);
  });

  it("each part's edit plan shows its whole stretch of footage, in order", () => {
    for (const p of parts) {
      const plan = buildEditPlan("C", moments, DURATION, p);
      const chapters = plan.segments.filter((s) => s.part === "chapter");
      expect(chapters[0].src_start_ms).toBe(p.startMs);
      expect(chapters.at(-1)!.src_end_ms).toBe(p.endMs);
      for (let i = 1; i < chapters.length; i++) expect(chapters[i].src_start_ms).toBe(chapters[i - 1].src_end_ms);
      expect(plan.segments[0].part).toBe("cold_open");
      expect(plan.segments.some((s) => s.part === "goals")).toBe(false);
      expect(plan.targetMs).toBeGreaterThanOrEqual(PART_TARGET.minMs);
      expect(plan.targetMs).toBeLessThanOrEqual(PART_TARGET.maxMs);
    }
  });

  it("the plan key carries the part, so the script step can read it back", () => {
    const key = `rec-1:${seriesKey(parts[1])}`;
    expect(parseSeriesKey(key)).toEqual(parts[1]);
    expect(partLabel(key)).toBe("Deel 2 van 2");
    expect(parseSeriesKey("rec-1:C")).toBeNull();
    expect(partLabel("rec-1:A:m1")).toBeNull();
    expect(targetFor("C", key)).toBe(PART_TARGET);
    expect(targetFor("C", "rec-1:C")).toBe(TARGET.C);
  });

  it("the script of the first part teases the next, the second part recaps the first", () => {
    const [p1, p2] = parts;
    const first = scriptPrompt("C", null, moments.filter((m) => m.peakMs < p1.endMs), buildEditPlan("C", moments, DURATION, p1), "en", undefined, { part: p1, previous: [], next: [moments[20]] });
    expect(first).toContain("part 1 of 2");
    expect(first).toContain("teaser for part 2");
    expect(first).toContain("moment 21");
    const last = scriptPrompt("C", null, [moments[20]], buildEditPlan("C", moments, DURATION, p2), "en", undefined, { part: p2, previous: [moments[0]], next: [] });
    expect(last).toContain("recap part 1");
    expect(last).toContain("last part");
  });

  it("every title says which part it is", () => {
    expect(seriesTitles(["Minecraft Hardcore: the cave", "The One Who Watches (Part 2)"], parts[1])).toEqual(["Minecraft Hardcore: the cave (Part 2)", "The One Who Watches (Part 2)"]);
    expect(seriesTitles(["x".repeat(100)], parts[0])[0].length).toBeLessThanOrEqual(100);
  });

  it("a recording shorter than 15 minutes stays one long video", () => {
    const short = moments.filter((m) => m.endMs < 12 * 60_000 + 30_000);
    expect(seriesParts(short, 12 * 60_000 + 30_000)).toHaveLength(1);
    expect(planVideos(short, 12 * 60_000 + 30_000, (m) => m.id!).some((p) => p.planKey === "C")).toBe(true);
  });
});

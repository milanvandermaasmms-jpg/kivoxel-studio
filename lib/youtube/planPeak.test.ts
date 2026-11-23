import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { coldOpenPeak, peakInPlan } from "./planPeak";

const seg = (part: Segment["part"], a: number, b: number, effects: string[] = []): Segment => ({ part, src_start_ms: a, src_end_ms: b, out_start_ms: 0, speed: 1, effects, note: "" });
// The v2 plan of "Epic Sky Fall Clutch": the new moment around 41:04.
const plan = [seg("teaser", 2_464_300, 2_465_700), seg("build", 2_461_000, 2_463_800), seg("payoff", 2_463_800, 2_464_700, ["slowmo"]), seg("payoff", 2_464_700, 2_466_800)];

describe("cold open na een ander moment", () => {
  it("uses the plan's own peak when the linked (old) moment is not in the plan", () => {
    expect(coldOpenPeak(246_000, plan)).toBe(2_464_700);
  });
  it("keeps the linked moment when the plan uses it", () => {
    expect(coldOpenPeak(2_464_500, plan)).toBe(2_464_500);
  });
  it("finds the peak at the end of the slow motion, else at the first payoff", () => {
    expect(peakInPlan(plan)).toBe(2_464_700);
    expect(peakInPlan([seg("build", 0, 1000), seg("payoff", 1000, 3000)])).toBe(1000);
    expect(peakInPlan([])).toBeNull();
  });
});

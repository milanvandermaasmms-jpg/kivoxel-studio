// 23-11-2026 (praktijktest "Epic Sky Fall Clutch" v2): after "kies een ander moment" the script's plan uses a new moment,
// but the video is still linked to the old one. The cold open took the OLD peak, so the new version opened with 1.5 s of
// sky from the rejected moment. The peak for the cold open now comes from the plan itself when the linked moment is not
// in it. Pure, tested.
import type { Segment } from "./analysis";

/** The peak inside a plan: the end of the slow-motion piece, else the start of the first payoff piece. */
export function peakInPlan(plan: Segment[]): number | null {
  const slow = plan.find((g) => g.effects?.includes("slowmo"));
  if (slow) return slow.src_end_ms;
  const pay = plan.find((g) => g.part === "payoff");
  return pay ? pay.src_start_ms : null;
}

/** The linked moment's peak when the plan really uses it (within 2 s of a piece), else the plan's own peak. */
export function coldOpenPeak(linkedPeak: number | null, plan: Segment[]): number | null {
  if (linkedPeak !== null && plan.some((g) => linkedPeak >= g.src_start_ms - 2000 && linkedPeak <= g.src_end_ms + 2000)) return linkedPeak;
  return peakInPlan(plan) ?? linkedPeak;
}

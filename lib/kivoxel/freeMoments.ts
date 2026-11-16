// KIVOXEL fase 1, section 8: the analysis WITHOUT AI credits. The Event Timeline (hearts, death screen, hits, loud
// moments) already knows what happens and when; this turns its best events into the moments the studio plans videos
// from (yt_moments), exactly like the paid analysis would. Used when there is no Gemini key, the credits are gone,
// the service is down, or the free mode is chosen.
import type { Moment, MomentKind } from "../youtube/analysis.ts";
import type { EventTimeline, GameEvent } from "./events.ts";
import { englishDescription } from "./scriptPrompt.ts";

/** Event type -> the moment kinds of the analysis (lib/youtube/analysis.ts). */
export function momentKind(e: GameEvent): MomentKind {
  if (e.kind === "death") return "mistake";
  if (e.type === "bijna_dood") return "near_death";
  if (e.type === "geluk") return "rare_find";
  if (e.type === "bouw") return "build_result";
  if (e.type === "jumpscare" || e.type === "grap") return "surprise";
  return "mistake";
}

/** Build-up before the peak and payoff after it, like the paid analysis reports them. */
const BEFORE = 9000;
const AFTER = 3500;

/**
 * The moments of a recording from its timeline: only events with a hook type and enough payoff, the strongest first,
 * at least 15 s apart (one moment, one Short), at most `max`.
 */
export function momentsFromTimeline(t: EventTimeline, durationMs: number, max = 8, minPayoff = 40): Moment[] {
  const picked: GameEvent[] = [];
  for (const e of [...t.events].filter((x) => x.type && x.payoff >= minPayoff).sort((a, b) => b.payoff - a.payoff)) {
    if (picked.some((p) => Math.abs(p.t_peak - e.t_peak) < 15_000)) continue;
    picked.push(e);
    if (picked.length === max) break;
  }
  return picked
    .sort((a, b) => a.t_peak - b.t_peak)
    .map((e) => ({
      kind: momentKind(e),
      startMs: Math.max(0, Math.min(e.t_start, e.t_peak - BEFORE)),
      endMs: Math.min(durationMs, Math.max(e.t_end, e.t_peak + AFTER)),
      peakMs: e.t_peak,
      reason: englishDescription(e),
      score: Math.min(100, Math.max(1, Math.round(e.payoff))),
      hasContext: true,
      contextNote: null,
      hasPayoff: true,
      payoffNote: null,
      privacyFlags: [],
      suggestedFormat: "A",
    }));
}

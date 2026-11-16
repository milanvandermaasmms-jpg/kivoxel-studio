// KIVOXEL fase 1, sections 7.2, 7.7 and 7.9 for long videos: dead parts out of every piece, chapter markers around the
// biggest events (English, YouTube rules: first at 0:00, at least 3, each at least 10 s), and checks that the montage
// has no dead stretches and starts in motion.
import type { Segment } from "../youtube/analysis.ts";
import type { DeadSpan, EventTimeline } from "./events.ts";
import { liveSpans } from "./shortPlan.ts";
import { eventsInMontage } from "./voiceScript.ts";

/** Every piece without its dead parts (the moments themselves stay whole); the pieces are renumbered on the timeline. */
export function cutDeadInPlan(segments: Segment[], t: EventTimeline): { segments: Segment[]; cutMs: number } {
  const out: Segment[] = [];
  let at = 0;
  let cut = 0;
  for (const sg of [...segments].sort((a, b) => a.out_start_ms - b.out_start_ms)) {
    // The cold open and teasers are short on purpose: leave them as they are.
    const peak = t.events.filter((e) => e.t_peak >= sg.src_start_ms && e.t_peak <= sg.src_end_ms).sort((a, b) => b.payoff - a.payoff)[0]?.t_peak ?? -1e9;
    const spans = sg.part === "cold_open" || sg.part === "teaser" ? [{ startMs: sg.src_start_ms, endMs: sg.src_end_ms }] : liveSpans(sg.src_start_ms, sg.src_end_ms, peak, t.dead);
    const before = sg.src_end_ms - sg.src_start_ms;
    let kept = 0;
    for (const s of spans) {
      out.push({ ...sg, src_start_ms: s.startMs, src_end_ms: s.endMs, out_start_ms: at });
      at += Math.round((s.endMs - s.startMs) / sg.speed);
      kept += s.endMs - s.startMs;
    }
    cut += Math.round((before - kept) / sg.speed);
  }
  return { segments: out, cutMs: cut };
}

const TITLE: Record<string, string> = { fail: "It all goes wrong", bijna_dood: "One heart left", geluk: "Lucky find", bouw: "The build", grap: "Pure chaos", jumpscare: "Something is behind us" };
const tc = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};

/** Chapter lines for the description ("0:00 …"), around the biggest events; empty when YouTube's rules cannot be met. */
export function chapters(segments: Segment[], t: EventTimeline | null, durationMs: number): string[] {
  const events = eventsInMontage(segments, t).filter((e) => e.payoff >= 45 && e.type);
  const marks: { atMs: number; title: string }[] = [{ atMs: 0, title: "The start" }];
  for (const e of [...events].sort((a, b) => b.payoff - a.payoff)) {
    // A chapter begins a little before the moment, so the build-up is in it.
    const at = Math.max(0, e.peak_out - 12_000);
    if (marks.some((m) => Math.abs(m.atMs - at) < 30_000) || durationMs - at < 15_000) continue;
    marks.push({ atMs: at, title: e.kind === "death" ? "Game over" : TITLE[e.type!] });
  }
  const sorted = marks.sort((a, b) => a.atMs - b.atMs);
  if (sorted.length < 3) return [];
  // Same titles twice read badly: number them.
  const seen = new Map<string, number>();
  return sorted.map((m) => {
    const n = (seen.get(m.title) ?? 0) + 1;
    seen.set(m.title, n);
    return `${tc(m.atMs)} ${n > 1 ? `${m.title} (${n})` : m.title}`;
  });
}

/** Dead footage that is still in the montage, in ms of video (cold opens/teasers and the area right around peaks excluded). */
export function deadInMontage(segments: Segment[], dead: DeadSpan[], minMs = 700): { totalMs: number; longestMs: number } {
  let total = 0;
  let longest = 0;
  for (const sg of segments) {
    if (sg.part === "cold_open" || sg.part === "teaser") continue;
    for (const d of dead) {
      const a = Math.max(sg.src_start_ms, d.startMs);
      const b = Math.min(sg.src_end_ms, d.endMs);
      if (b - a >= minMs) {
        total += Math.round((b - a) / sg.speed);
        longest = Math.max(longest, Math.round((b - a) / sg.speed));
      }
    }
  }
  return { totalMs: total, longestMs: longest };
}

/** Does the very first frame of the montage move (not a menu, still picture or black)? */
export function firstFrameMoves(segments: Segment[], dead: DeadSpan[]): boolean {
  const first = [...segments].sort((a, b) => a.out_start_ms - b.out_start_ms)[0];
  if (!first) return false;
  const at = first.src_start_ms + 50;
  return !dead.some((d) => at >= d.startMs && at < d.endMs);
}

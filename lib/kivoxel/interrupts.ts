// KIVOXEL fase 1, section 7.3: pattern interrupts. Shorts: a visual jolt every 2-4 s (zoom punch, slow push, whip pan),
// and on every big peak a punch + camera shake. Long videos: a visual reset every 20-40 s. Done on the joined picture
// with per-frame expressions (scale with eval=frame, crop with moving x/y), so no extra cuts are needed. The style
// rotates between videos (section 7.8).
import type { Settings } from "./config.ts";

export const ZOOM_STYLES = ["punch", "slow_push", "whip"] as const;
export type ZoomStyle = (typeof ZOOM_STYLES)[number];
export type InterruptKind = "zoom_punch" | "slow_push" | "whip" | "shake";
export type Interrupt = { atMs: number; kind: InterruptKind; ms: number; strength: number };

const DUR: Record<InterruptKind, number> = { zoom_punch: 280, slow_push: 1800, whip: 220, shake: 420 };

/** When and which interrupts. Nothing in the first 0.4 s (the hook pops in there) and never two on top of each other, except punch + shake on a peak. */
export function planInterrupts(input: { durationMs: number; peaks: { atMs: number; payoff: number }[]; short: boolean; style: ZoomStyle; settings: Settings; rnd: () => number }): Interrupt[] {
  const { settings, rnd, durationMs } = input;
  if (!settings.features.pattern_interrupts) return [];
  const out: Interrupt[] = [];
  const big = input.peaks.filter((p) => p.payoff >= 50 && p.atMs > 300 && p.atMs < durationMs - 200);
  for (const p of big) {
    out.push({ atMs: p.atMs, kind: "zoom_punch", ms: DUR.zoom_punch, strength: 0.16 });
    out.push({ atMs: p.atMs + 40, kind: "shake", ms: DUR.shake, strength: 16 });
  }
  const [lo, hi] = input.short ? settings.features.interrupt_every_ms : settings.long.visual_reset_ms;
  const kindFor = (i: number): InterruptKind => (input.style === "punch" ? (i % 3 === 2 ? "whip" : "zoom_punch") : input.style === "slow_push" ? (i % 2 ? "zoom_punch" : "slow_push") : i % 2 ? "zoom_punch" : "whip");
  let t = input.short ? 1200 + rnd() * 800 : lo * 0.5;
  let i = 0;
  while (t < durationMs - 600) {
    const kind = kindFor(i);
    // Keep clear of the peaks (they have their own jolt) and of each other.
    const clash = out.some((x) => Math.abs(x.atMs - t) < Math.max(600, DUR[kind]));
    if (!clash) out.push({ atMs: Math.round(t), kind, ms: DUR[kind], strength: kind === "slow_push" ? 0.08 : kind === "whip" ? 0.1 : 0.12 });
    t += lo + rnd() * (hi - lo);
    i++;
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

const s = (ms: number) => (ms / 1000).toFixed(3);

/** Zoom amount over time: a sum of short envelopes (punch = jump in and ease out; push = slow ramp). */
function zoomExpr(list: Interrupt[]): string {
  const terms = list.flatMap((x) => {
    const T = s(x.atMs);
    const d = s(x.ms);
    if (x.kind === "zoom_punch") return [`${x.strength}*between(t,${T},${T}+${d})*pow(1-(t-${T})/${d},2)`];
    if (x.kind === "slow_push") return [`${x.strength}*between(t,${T},${T}+${d})*(t-${T})/${d}`];
    // Whip and shake need room to move: a little zoom while they run.
    return [`${x.kind === "whip" ? x.strength : 0.04}*between(t,${T},${T}+${d})`];
  });
  return terms.length ? terms.join("+") : "0";
}

function offsetExpr(list: Interrupt[], axis: "x" | "y", width: number): string {
  const terms = list.flatMap((x) => {
    const T = s(x.atMs);
    const d = s(x.ms);
    if (x.kind === "shake") return [`${axis === "x" ? x.strength : x.strength * 0.6}*sin((t-${T})*${axis === "x" ? 83 : 97})*between(t,${T},${T}+${d})`];
    if (x.kind === "whip" && axis === "x") return [`${Math.round(width * x.strength * 0.45)}*sin(PI*(t-${T})/${d})*between(t,${T},${T}+${d})`];
    return [];
  });
  return terms.length ? terms.join("+") : "0";
}

/** The video filter for the joined picture of size W x H (empty when there is nothing to do). */
export function interruptFilter(list: Interrupt[], size: { width: number; height: number }): string {
  if (!list.length) return "";
  const { width: W, height: H } = size;
  const even = (v: string) => `trunc(${v}/2)*2`;
  return [
    `scale=w='${even(`${W}*(1+${zoomExpr(list)})`)}':h=-2:eval=frame:flags=bicubic`,
    `crop=${W}:${H}:x='(iw-${W})/2+${offsetExpr(list, "x", W)}':y='(ih-${H})/2+${offsetExpr(list, "y", W)}'`,
    "setsar=1",
  ].join(",");
}

/** Section 7.3: a freeze-frame with a short text right after a fail. The time runs on (game sound, voice, captions stay in place). */
export type Freeze = { atMs: number; ms: number; text: string };
export const FREEZE_MS = 700;

/**
 * At most one freeze per Short (on the biggest fail/death) and one per ~60 s in a long video; never in the first second
 * (the hook) or the last 0.5 s. `take` picks the text (rotation lives with the caller).
 */
export function planFreezes(input: { peaks: { atMs: number; payoff: number; fail: boolean }[]; durationMs: number; short: boolean; settings: Settings; take: () => string }): Freeze[] {
  if (!input.settings.features.pattern_interrupts || !input.settings.features.interrupts.includes("freeze_text")) return [];
  const fits = input.peaks.filter((p) => p.fail && p.payoff >= 50 && p.atMs >= 1000 && p.atMs + 150 + FREEZE_MS <= input.durationMs - 500).sort((a, b) => b.payoff - a.payoff);
  const out: Freeze[] = [];
  for (const p of fits) {
    if (input.short && out.length) break;
    if (out.some((f) => Math.abs(f.atMs - p.atMs) < 60_000)) continue;
    out.push({ atMs: p.atMs + 150, ms: FREEZE_MS, text: input.take() });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * FFmpeg: hold the picture during each freeze. The frames inside the window get the time stamp of its end, so `fps`
 * repeats the last frame before it (one chain, no second input; checked on 16-11-2026 with testsrc).
 */
export function freezeFilter(list: Freeze[], fps: number): string {
  if (!list.length) return "";
  const expr = list.reduceRight((rest, f) => `if(between(T,${s(f.atMs)},${s(f.atMs + f.ms)}),${s(f.atMs + f.ms)}/TB,${rest})`, "PTS");
  return `setpts='${expr}',fps=${fps}`;
}

/** A small sound accent on every interrupt (not on shakes: the impact of the peak already covers those). */
export function interruptSfx(list: Interrupt[]): { atMs: number; kind: "pop" | "whoosh" }[] {
  return list.filter((x) => x.kind !== "shake" && x.kind !== "slow_push").map((x) => ({ atMs: Math.max(0, x.atMs - (x.kind === "whip" ? 120 : 20)), kind: x.kind === "whip" ? "whoosh" : "pop" }));
}

/** Section 9 / 7.3: are there interrupts often enough (Shorts: every 2-4 s)? Longest gap in ms. */
export function longestQuiet(list: Interrupt[], durationMs: number): number {
  const times = [0, ...list.map((x) => x.atMs), durationMs].sort((a, b) => a - b);
  let max = 0;
  for (let i = 1; i < times.length; i++) max = Math.max(max, times[i] - times[i - 1]);
  return max;
}

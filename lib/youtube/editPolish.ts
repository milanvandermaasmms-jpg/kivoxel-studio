// Studio 2.0, fase 5: the editor works from the evidence of the real recording. Before the narration is written:
// stretches where nothing happens (menus, idle walking) are cut out (jump cuts), and real events (explosion, damage,
// a find, a fall) get a short zoom; in Shorts also visible threats, never more than one zoom per ~4 s. Every effect
// has a reason; ordinary walking gets none. Pure, tested.
import { TARGET, targetFor, type Format, type Segment } from "./analysis.ts";
import { relayout, totalMs, ZOOM } from "./editor.ts";
import { cutPlan } from "./viral.ts";
import type { Evidence, FrameFact, FramePick } from "./grounding.ts";

const MENU = /\b(menu|inventory|inventaris|chest|crafting|pause|settings|loading)\b/i;
const IDLE = /\b(walk|walking|idle|stand|standing|looking|wandering)\b/i;
const EVENT = /\b(explo|damage|hit|death|died|dies|fall|fell|found|find|kill|attack|boom|ignite|burn)/i;

export const isIdle = (f: FrameFact) => MENU.test(f.action) || (!f.mobs.length && !f.events.length && (IDLE.test(f.action) || !f.action));
export const isEvent = (f: FrameFact) => f.events.some((e) => EVENT.test(e) && !MENU.test(e));

/** Where a moment of the recording lands in the final video (null when it was cut). */
export function srcToOut(segments: Segment[], srcMs: number): number | null {
  for (const s of segments) if (srcMs >= s.src_start_ms && srcMs < s.src_end_ms) return Math.round(s.out_start_ms + (srcMs - s.src_start_ms) / s.speed);
  return null;
}

function merge(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** Splits the segment containing [a, b) (source time) and marks the middle part with a zoom. */
function zoomAt(segments: Segment[], a: number, b: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const from = Math.max(a, s.src_start_ms);
    const to = Math.min(b, s.src_end_ms);
    if (to - from < 400 || s.effects.includes(ZOOM)) {
      out.push(s);
      continue;
    }
    if (from - s.src_start_ms >= 300) out.push({ ...s, src_end_ms: from });
    out.push({ ...s, src_start_ms: from, src_end_ms: to, effects: [...s.effects, ZOOM], note: `${s.note} (zoom: gebeurtenis)`.trim() });
    if (s.src_end_ms - to >= 300) out.push({ ...s, src_start_ms: to });
  }
  return out;
}

export type Polished = { segments: Segment[]; frames: FramePick[]; evidence: Evidence; removedMs: number; cuts: [number, number][]; zooms: number };

export function polishPlan(segments: Segment[], frames: FramePick[], e: Evidence, format: Format, planKey?: string | null): Polished {
  const short = format !== "C";
  const factOf = new Map(e.frames.map((f) => [f.i, f]));
  const picks = frames.filter((f) => factOf.has(f.index)).sort((a, b) => a.srcMs - b.srcMs);
  const half = 1200;

  // 1. Idle stretches out (merged, at least 2 s in a Short / 4 s in a long video), but never below the minimum length.
  let cuts = merge(picks.filter((f) => isIdle(factOf.get(f.index)!)).map((f) => [f.srcMs - half, f.srcMs + half] as [number, number])).filter(([a, b]) => b - a >= (short ? 2000 : 4000));
  const min = (planKey ? targetFor(format, planKey) : TARGET[format]).minMs;
  const total = totalMs(segments);
  cuts.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  let removed = cuts.reduce((s, [a, b]) => s + (b - a), 0);
  while (cuts.length && total - removed < min) {
    const c = cuts.pop()!;
    removed -= c[1] - c[0];
  }
  let segs = segments;
  let removedMs = 0;
  if (cuts.length) {
    const r = cutPlan(segments, [], cuts);
    segs = r.segments;
    removedMs = r.removedMs;
  }

  // 2. Zooms on real events; in Shorts also on visible threats, at most one per ~4 s and never back to back.
  const zoomSrc: number[] = [];
  const budget = short ? Math.max(1, Math.floor(totalMs(segs) / 4000)) : Math.max(1, picks.filter((f) => isEvent(factOf.get(f.index)!)).length);
  const candidates = [...picks.filter((f) => isEvent(factOf.get(f.index)!)), ...(short ? picks.filter((f) => !isEvent(factOf.get(f.index)!) && factOf.get(f.index)!.mobs.length) : [])];
  for (const f of candidates) {
    if (zoomSrc.length >= budget) break;
    if (srcToOut(segs, f.srcMs) === null || zoomSrc.some((z) => Math.abs(z - f.srcMs) < 3000)) continue;
    zoomSrc.push(f.srcMs);
    segs = relayout(zoomAt(segs, f.srcMs - 600, f.srcMs + 1400));
  }
  segs = relayout(segs);

  // 3. The evidence on the new timeline (frames that were cut are dropped).
  const kept: FramePick[] = [];
  for (const f of frames) {
    const out = srcToOut(segs, f.srcMs);
    if (out !== null) kept.push({ ...f, outMs: out });
  }
  const keptIdx = new Set(kept.map((f) => f.index));
  return { segments: segs, frames: kept, evidence: { ...e, frames: e.frames.filter((f) => keptIdx.has(f.i)) }, removedMs, cuts: cuts.map(([a, b]) => [Math.round(a), Math.round(b)]), zooms: zoomSrc.length };
}

// KIVOXEL fase 1, sections 6 and 7.2: how long a Short is and which footage it uses.
// - The length follows the content: the shortest length in which hook -> tension -> payoff is complete.
// - Then variation is forced: consecutive Shorts of a batch never share a length bucket, and exact lengths vary.
// - Dead parts (menus, standing still, black, quiet and still) inside the window are cut out.
// - Every Short starts straight in the action: the first frame moves.
import type { Segment } from "../youtube/analysis.ts";
import type { LengthBucket, Settings } from "./config.ts";
import type { DeadSpan, EventTimeline, GameEvent } from "./events.ts";

/** Seconds of build-up before the peak that a Short needs at the very least (hook + one anticipation line). */
export const MIN_BUILD_MS = 4500;
/** After the peak: the payoff and its reaction (a death shows the GAME OVER screen a bit longer). */
export const aftermathMs = (e: GameEvent) => (e.kind === "death" ? 2600 : 2000);
/** Never cut within this distance of the peak: the payoff stays whole. */
const KEEP_AROUND_PEAK = 1500;

export type ShortPlan = {
  eventId: string;
  bucket: string;
  targetMs: number;
  segments: Segment[];
  /** Milliseconds of dead footage left out. */
  cutMs: number;
  /** Why this bucket (for the log and the review). */
  reason: string;
  /** How many buckets this moment could fill (1 = only one length possible). */
  options: number;
};

export const bucketOf = (ms: number, buckets: LengthBucket[]): LengthBucket | null => buckets.find((b) => ms >= b.min_ms - 500 && ms <= b.max_ms + 500) ?? null;

/** The footage between `start` and `end`, without the dead parts (except close to the peak). */
export function liveSpans(start: number, end: number, peak: number, dead: DeadSpan[], minDeadMs = 700): { startMs: number; endMs: number }[] {
  const cuts = dead
    .filter((d) => d.endMs - d.startMs >= minDeadMs && d.endMs > start && d.startMs < end)
    .map((d) => ({ startMs: Math.max(start, d.startMs), endMs: Math.min(end, d.endMs) }))
    // The payoff stays whole, even if the player stands still at the peak (e.g. the death screen).
    .filter((d) => d.endMs < peak - KEEP_AROUND_PEAK || d.startMs > peak + KEEP_AROUND_PEAK)
    .sort((a, b) => a.startMs - b.startMs);
  const out: { startMs: number; endMs: number }[] = [];
  let cursor = start;
  for (const c of cuts) {
    if (c.startMs > cursor) out.push({ startMs: cursor, endMs: c.startMs });
    cursor = Math.max(cursor, c.endMs);
  }
  if (end > cursor) out.push({ startMs: cursor, endMs: end });
  // Tiny leftovers between two cuts are jumpy: drop pieces under 0.6 s (but never the one with the peak).
  return out.filter((p) => p.endMs - p.startMs >= 600 || (peak >= p.startMs && peak <= p.endMs));
}

const total = (spans: { startMs: number; endMs: number }[]) => spans.reduce((s, p) => s + p.endMs - p.startMs, 0);

/** How long the Short becomes when it starts at `start`: live footage only. */
function outLength(start: number, end: number, e: GameEvent, dead: DeadSpan[]) {
  return total(liveSpans(start, end, e.t_peak, dead));
}

/** The earliest start that still gives at most `wantMs` of live footage (walks back in steps of 250 ms). */
function startFor(wantMs: number, end: number, e: GameEvent, t: EventTimeline, floorMs: number): number {
  let start = Math.max(floorMs, e.t_peak - MIN_BUILD_MS);
  while (start > floorMs && outLength(start - 250, end, e, t.dead) <= wantMs) start -= 250;
  // Then to the exact millisecond, so the length is the chosen one (no whole seconds by accident).
  const exact = start - (wantMs - outLength(start, end, e, t.dead));
  if (exact >= floorMs && exact < start && outLength(exact, end, e, t.dead) === wantMs) start = exact;
  return Math.max(floorMs, start);
}

/** Moves the start forward to the first frame that is not dead, so the Short opens in motion. */
function liveStart(start: number, peak: number, dead: DeadSpan[]) {
  let s = start;
  for (const d of [...dead].sort((a, b) => a.startMs - b.startMs)) if (s >= d.startMs && s < d.endMs && d.endMs < peak - MIN_BUILD_MS / 2) s = d.endMs;
  return s;
}

/**
 * The plan for one Short around `event`. `previous` = the bucket of the Short before it in this batch.
 * `floorMs`: footage before this moment belongs to an earlier Short (never show the same thing twice in a row).
 */
export function planShort(event: GameEvent, t: EventTimeline, settings: Settings, rnd: () => number, previous: string | null = null, floorMs = 0): ShortPlan {
  const buckets = settings.shorts.length_buckets;
  let end = Math.min(t.durationMs, event.t_peak + aftermathMs(event));
  // When there is too little footage before the peak (an event right after the start of a recording), the Short may
  // run on after the peak while the event lasts (e.g. a stretch with few hearts), never further.
  const endMax = Math.min(t.durationMs, Math.max(end, event.t_end + 1500));
  const minStart = liveStart(Math.max(floorMs, event.t_peak - MIN_BUILD_MS), event.t_peak, t.dead);
  const minimal = outLength(minStart, end, event, t.dead);
  const maxPossible = outLength(Math.max(floorMs, 0), endMax, event, t.dead);
  // Story bucket only with a real build-up: another moment worth something in the minute before the peak.
  const buildUp = t.events.some((x) => x.id !== event.id && x.payoff >= 30 && x.t_peak < event.t_peak - 6000 && x.t_peak > event.t_peak - 60_000);
  const feasible = buckets.filter((b) => b.max_ms >= minimal && b.min_ms <= maxPossible && (!b.needs_buildup || buildUp));
  // The shortest complete length first; then never the same bucket as the Short before.
  let pick = feasible[0] ?? buckets[0];
  let reason = `kortste complete lengte (${(minimal / 1000).toFixed(1)} s)`;
  if (settings.shorts.no_same_bucket_in_a_row && previous && pick.key === previous) {
    const other = feasible.find((b) => b.key !== previous);
    if (other) {
      pick = other;
      reason = `andere lengte dan de vorige Short (${previous})`;
    } else reason += `; geen andere lengte mogelijk, dus gelijk aan de vorige`;
  }
  // An exact length inside the bucket, not a round number: anywhere between the bucket edges that the footage allows.
  const lo = Math.max(pick.min_ms, minimal);
  const hi = Math.min(pick.max_ms, maxPossible);
  let want = hi > lo ? lo + rnd() * (hi - lo) : lo;
  want = Math.round(want / 100) * 100 + (Math.round(want / 1000) * 1000 === Math.round(want / 100) * 100 ? 300 : 0);
  const start = liveStart(startFor(want, end, event, t, floorMs), event.t_peak, t.dead);
  const short = want - outLength(start, end, event, t.dead);
  if (short > 200 && endMax > end) {
    end = Math.min(endMax, end + short);
    reason += `; ${(short / 1000).toFixed(1)} s na de piek erbij (te weinig beeld ervoor)`;
  }
  const spans = liveSpans(start, end, event.t_peak, t.dead);
  const segments: Segment[] = [];
  let out = 0;
  for (const s of spans) {
    // The piece with the peak is the payoff; everything before it is build-up.
    const hasPeak = event.t_peak >= s.startMs && event.t_peak <= s.endMs;
    segments.push({ part: hasPeak ? "payoff" : "build", src_start_ms: s.startMs, src_end_ms: s.endMs, out_start_ms: out, speed: 1, effects: [], note: hasPeak ? event.description : "opbouw" });
    out += s.endMs - s.startMs;
  }
  return { eventId: event.id, bucket: (bucketOf(out, buckets) ?? pick).key, targetMs: out, segments, cutMs: end - start - out, reason, options: feasible.length };
}

/** A batch of Shorts from one recording: the best payoffs, no overlap, alternating lengths. */
export function planShortBatch(t: EventTimeline, settings: Settings, rnd: () => number, count = 5, previous: string | null = null, minPayoff = 40): ShortPlan[] {
  const picked: GameEvent[] = [];
  for (const e of [...t.events].filter((x) => x.type && x.payoff >= minPayoff).sort((a, b) => b.payoff - a.payoff)) {
    if (picked.some((p) => Math.abs(p.t_peak - e.t_peak) < 15_000)) continue;
    picked.push(e);
    if (picked.length === count) break;
  }
  const plans: ShortPlan[] = [];
  let prev = previous;
  const left = [...picked];
  while (left.length) {
    // Next Short: the best remaining moment that gets ANOTHER bucket than the Short before. A moment that can only be
    // short (little footage) then simply comes later in the batch instead of breaking the variation.
    const tries = left.map((e) => ({ e, plan: planShort(e, t, settings, rnd, prev) }));
    const fits = tries.filter((x) => bucketOf(x.plan.targetMs, settings.shorts.length_buckets));
    // A moment that cannot fill even the shortest bucket is no Short: leave it out of the batch.
    for (const x of tries) if (!fits.includes(x)) left.splice(left.indexOf(x.e), 1);
    if (!fits.length) break;
    // Among those, the most constrained moment first (fewest possible lengths), so the flexible ones can still vary later.
    const varied = fits.filter((x) => !settings.shorts.no_same_bucket_in_a_row || x.plan.bucket !== prev);
    const next = [...varied].sort((a, b) => a.plan.options - b.plan.options)[0] ?? fits[0];
    plans.push(next.plan);
    prev = next.plan.bucket;
    left.splice(left.indexOf(next.e), 1);
  }
  return plans;
}

/** Section 9: length inside its bucket and different from the Short before. */
export function lengthChecks(ms: number, previousBucket: string | null, settings: Settings) {
  const b = bucketOf(ms, settings.shorts.length_buckets);
  return [
    { key: "length_bucket", label: "Lengte binnen een bucket", ok: !!b, value: `${(ms / 1000).toFixed(1)} s${b ? ` (${b.label})` : ""}`, note: settings.shorts.length_buckets.map((x) => `${x.label} ${x.min_ms / 1000}-${x.max_ms / 1000} s`).join(", ") },
    { key: "length_varies", label: "Andere lengte dan de vorige Short", ok: !previousBucket || !b || b.key !== previousBucket, value: b?.label ?? "?", note: previousBucket ? `vorige: ${previousBucket}` : "eerste van de batch" },
  ];
}

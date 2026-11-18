// KIVOXEL (Milan, 16-11-2026): music that follows what happens. Action (fights, near death, deaths, jumpscares) gets
// busy fast music; searching, walking and farming get calm music. One action track and one calm track per video, so
// it stays one recognisable sound; each track continues where it stopped, a downbeat lands on the action peak, and
// two parts cross-fade softly. Pure functions, tested.
import type { EventType } from "./config.ts";
import { pickTrack, type Track } from "./media.ts";

export type MusicEvent = { atMs: number; payoff: number; type: EventType | null; kind: string };
export type MusicPart = { file: string; title: string; atMs: number; durMs: number; startMs: number; kind: "action" | "calm" };

/** Events that make the music busy: something dangerous or exciting really happens. */
export const isAction = (e: MusicEvent) => e.kind === "death" || e.type === "fail" || e.type === "bijna_dood" || e.type === "jumpscare" || (e.payoff >= 70 && e.type !== "bouw");

/** Action spans: from a few seconds before the peak (the build-up) to just after it; joined when they touch. */
export function actionSpans(events: MusicEvent[], durationMs: number, short: boolean): [number, number][] {
  const before = short ? 5000 : 9000, after = short ? 2500 : 4000;
  const spans = events
    .filter(isAction)
    .map((e) => [Math.max(0, e.atMs - before), Math.min(durationMs, e.atMs + after)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    // Calm stretches shorter than this between two action spans stay action (no nervous switching).
    if (last && s[0] - last[1] < (short ? 4000 : 15_000)) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}

/**
 * Where to start in the track (at or after `from`) so that `peakIn` ms into the part falls exactly on a downbeat
 * (the first beat of a bar of 4).
 */
export function downbeatStart(track: Pick<Track, "bpm" | "beat_offset_ms">, from: number, peakIn: number): number {
  const bar = (4 * 60_000) / track.bpm;
  const first = track.beat_offset_ms ?? 0;
  const k = Math.ceil((from + peakIn - first) / bar);
  return Math.max(0, Math.round(first + k * bar - peakIn));
}

/** Shorts open with only the game sound of the climax (the teaser); the music drops in after it (Milan, 18-11-2026). */
export const SHORT_GAME_ONLY_MS = 1300;

export type MusicPlanInput = { durationMs: number; events: MusicEvent[]; library: Track[]; recent: string[]; rnd: () => number; short: boolean; noRepeatWithin?: number; allowTest?: boolean };

/**
 * The music parts of one video. Shorts: one track that fits the main moment, or calm then action when there is a
 * real build-up of at least 8 s. Long videos: calm and action alternate with the content.
 */
export function planMusicParts(input: MusicPlanInput): MusicPart[] {
  const { durationMs, short } = input;
  const spans = actionSpans(input.events, durationMs, short);
  const lib = input.library.filter((t) => input.allowTest || !t.test);
  if (!lib.length || durationMs <= 0) return [];
  const action = pickTrack(lib.filter((t) => t.energy >= 4), "fail", 5, input.recent, input.rnd, input.noRepeatWithin, input.allowTest) ?? pickTrack(lib, "fail", 5, input.recent, input.rnd, input.noRepeatWithin, input.allowTest);
  const calm = pickTrack(lib.filter((t) => t.energy <= 3), "bouw", 1, input.recent, input.rnd, input.noRepeatWithin, input.allowTest) ?? pickTrack(lib, "bouw", 1, input.recent, input.rnd, input.noRepeatWithin, input.allowTest);
  if (!action || !calm) return [];
  // The timeline of the video as alternating calm/action stretches.
  type Stretch = { kind: "action" | "calm"; from: number; to: number; peak: number | null };
  const stretches: Stretch[] = [];
  let t = 0;
  for (const [a, b] of spans) {
    if (a > t) stretches.push({ kind: "calm", from: t, to: a, peak: null });
    const peak = input.events.filter((e) => isAction(e) && e.atMs >= a && e.atMs <= b).sort((x, y) => y.payoff - x.payoff)[0]?.atMs ?? null;
    stretches.push({ kind: "action", from: Math.max(a, t), to: b, peak });
    t = b;
  }
  if (t < durationMs) stretches.push({ kind: "calm", from: t, to: durationMs, peak: null });
  // Short calm bits at the very start or end of a Short melt into their neighbour (one sound for a short clip).
  const minCalm = short ? 8000 : 12_000;
  const merged: Stretch[] = [];
  for (const s of stretches) {
    const last = merged[merged.length - 1];
    if (last && (s.to - s.from < (s.kind === "calm" ? minCalm : 3000) || last.kind === s.kind)) last.to = s.to, (last.peak ??= s.peak);
    else merged.push({ ...s });
  }
  if (merged.length > 1 && merged[0].to - merged[0].from < (merged[0].kind === "calm" ? minCalm : 3000)) {
    merged[1].from = 0;
    merged.shift();
  }
  // A Short without any action: calm (or happy) the whole way; a Short that is all action: busy the whole way.
  const used = new Map<string, number>();
  const lead = short ? Math.min(SHORT_GAME_ONLY_MS, durationMs) : 0;
  return merged.filter((s) => s.to > lead).map((s0) => {
    const s = { ...s0, from: Math.max(s0.from, lead) };
    const track = s.kind === "action" ? action : calm;
    const len = s.to - s.from;
    // Continue the track where it stopped; for action, shift so a downbeat lands on the peak.
    const already = used.get(track.file) ?? 0;
    const start = s.kind === "action" && s.peak !== null ? downbeatStart(track, already, s.peak - s.from) : already + (already ? 0 : (track.beat_offset_ms ?? 0));
    used.set(track.file, Math.max(0, start) + len);
    return { file: track.file, title: `${track.title}${track.artist ? ` – ${track.artist}` : ""}`, atMs: s.from, durMs: len, startMs: Math.max(0, start), kind: s.kind };
  });
}

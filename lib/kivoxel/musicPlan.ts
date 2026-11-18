// KIVOXEL (Milan, 16-11-2026): music that follows what happens. Action (fights, near death, deaths, jumpscares) gets
// busy fast music; searching, walking and farming get calm music. One action track and one calm track per video, so
// it stays one recognisable sound; each track continues where it stopped, a downbeat lands on the action peak, and
// two parts cross-fade softly. Pure functions, tested.
import type { EventType } from "./config.ts";
import { pickTrack, type Track } from "./media.ts";

export type MusicEvent = { atMs: number; payoff: number; type: EventType | null; kind: string };
export type MusicPart = { file: string; title: string; atMs: number; durMs: number; startMs: number; kind: "action" | "calm"; /** Extra volume for this music (long videos: softer, in the background). */ gainDb?: number };

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
/** Long videos (Milan, 18-11-2026): soft background music, quieter than in a Short. */
export const LONG_MUSIC_GAIN_DB = -8;
/** Background tracks for long videos: calm or tense, never hype, funny or happy (no hip-hop next to metal). */
export const isBackgroundTrack = (t: Pick<Track, "energy" | "moods">) => t.energy <= 4 && !t.moods.some((m) => m === "hype" || m === "funny" || m === "happy");

/**
 * Long videos (Milan, 18-11-2026): one calm or tense track softly in the background, played from its start to its end;
 * then the next one of the same kind fades in. No switching with the action (that sounded like a mess).
 */
export function planBackgroundMusic(input: MusicPlanInput): MusicPart[] {
  const pool = input.library.filter((t) => (input.allowTest || !t.test) && isBackgroundTrack(t));
  if (!pool.length || input.durationMs <= 0) return [];
  const window = input.recent.slice(-(input.noRepeatWithin ?? 6));
  const fresh = pool.filter((t) => !window.includes(t.file));
  const order = [...(fresh.length ? fresh : pool)].sort((a, b) => a.file.localeCompare(b.file));
  const first = Math.floor(input.rnd() * order.length);
  const rest = pool.filter((t) => !order.includes(t)).concat(order.slice(first + 1), order.slice(0, first));
  const queue = [order[first], ...rest];
  const out: MusicPart[] = [];
  let at = 0;
  for (let k = 0; at < input.durationMs; k++) {
    const t = queue[k % queue.length];
    const len = Math.max(20_000, t.duration_ms ?? 120_000);
    const dur = Math.min(len, input.durationMs - at);
    out.push({ file: t.file, title: `${t.title}${t.artist ? ` – ${t.artist}` : ""}`, atMs: at, durMs: dur, startMs: 0, kind: "calm", gainDb: LONG_MUSIC_GAIN_DB });
    at += dur;
  }
  return out;
}

export function planMusicParts(input: MusicPlanInput): MusicPart[] {
  const { durationMs, short } = input;
  if (!short) return planBackgroundMusic(input);
  const spans = actionSpans(input.events, durationMs, short);
  const lib = input.library.filter((t) => input.allowTest || !t.test);
  if (!lib.length || durationMs <= 0) return [];
  const action = pickTrack(lib.filter((t) => t.energy >= 4), "fail", 5, input.recent, input.rnd, input.noRepeatWithin, input.allowTest) ?? pickTrack(lib, "fail", 5, input.recent, input.rnd, input.noRepeatWithin, input.allowTest);
  const calm = pickTrack(lib.filter((t) => t.energy <= 3), "bouw", 1, input.recent, input.rnd, input.noRepeatWithin, input.allowTest) ?? pickTrack(lib, "bouw", 1, input.recent, input.rnd, input.noRepeatWithin, input.allowTest);
  if (!action || !calm) return [];
  // Shorts (Milan, 18-11-2026): one track for the whole Short, never a switch halfway (that sounded like a mess). Busy when
  // something happens, calm otherwise; it starts after the game-sound opening, with a downbeat on the main peak.
  if (short) {
    const lead = Math.min(SHORT_GAME_ONLY_MS, durationMs);
    const main = input.events.filter(isAction).sort((a, b) => b.payoff - a.payoff)[0] ?? null;
    const track = main ? action : calm;
    const startMs = main && main.atMs > lead ? downbeatStart(track, 0, main.atMs - lead) : (track.beat_offset_ms ?? 0);
    return durationMs > lead ? [{ file: track.file, title: `${track.title}${track.artist ? ` – ${track.artist}` : ""}`, atMs: lead, durMs: durationMs - lead, startMs, kind: main ? "action" : "calm" }] : [];
  }
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

// KIVOXEL fase 1, sections 3 and 7.6: the local royalty-free music library and the SFX layer.
// Music: picked on the mood of the main event and energy, never the same track within N videos, and started so a
// bar line (downbeat) lands exactly on the payoff. SFX: whoosh on cuts, impact on peaks, record scratch on a death,
// rotating between variants.
import type { EventType } from "./config.ts";
import type { Segment } from "../youtube/analysis.ts";

export const MOODS = ["hype", "tense", "happy", "chill", "funny", "epic", "dark"] as const;
export type Mood = (typeof MOODS)[number];
export type Track = {
  file: string;
  title: string;
  artist?: string;
  /** Where it comes from and under which licence (YouTube Audio Library, Uppbeat, Epidemic Sound, own…). */
  source: string;
  license: string;
  url?: string;
  /** 1 (calm) - 5 (maximum). */
  energy: number;
  moods: Mood[];
  bpm: number;
  /** Where the first downbeat is in the file. */
  beat_offset_ms?: number;
  /** A generated test track: fine for testing the mix, never for a real upload. */
  test?: boolean;
};
export const SFX_KINDS = ["whoosh", "impact", "scratch", "pop", "riser"] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
export type Sfx = { file: string; kind: SfxKind; db?: number };

/** Which moods suit which event (first = best). */
export const MOOD_FOR: Record<EventType, Mood[]> = {
  fail: ["hype", "funny", "tense"],
  bijna_dood: ["tense", "epic", "hype"],
  geluk: ["happy", "epic", "hype"],
  bouw: ["chill", "happy", "epic"],
  grap: ["funny", "happy", "hype"],
  jumpscare: ["tense", "dark"],
};

/** Problems with one library entry, in Dutch (shown when the worker starts and in the tests). */
export function trackProblems(t: Partial<Track>): string[] {
  const out: string[] = [];
  const name = t.title ?? t.file ?? "?";
  if (!t.file || !/\.(mp3|wav|ogg|m4a|flac)$/i.test(t.file)) out.push(`Track "${name}": bestand moet .mp3, .wav, .ogg, .m4a of .flac zijn.`);
  if (!t.source || !t.license) out.push(`Track "${name}": bron en licentie zijn verplicht (geen muziek zonder rechten).`);
  if (!(t.energy && t.energy >= 1 && t.energy <= 5)) out.push(`Track "${name}": energie moet 1-5 zijn.`);
  if (!t.moods?.length || t.moods.some((m) => !MOODS.includes(m))) out.push(`Track "${name}": sfeer moet een of meer zijn van ${MOODS.join(", ")}.`);
  if (!(t.bpm && t.bpm >= 50 && t.bpm <= 220)) out.push(`Track "${name}": bpm moet tussen 50 en 220 liggen.`);
  return out;
}

/**
 * The track for one video: best mood match and energy, not used in the last `noRepeatWithin` videos.
 * Test tracks only when `allowTest` (test renders); a real video never gets a generated test track.
 */
export function pickTrack(library: Track[], type: EventType, energy: number, recent: string[], rnd: () => number, noRepeatWithin = 6, allowTest = false): Track | null {
  const usable = library.filter((t) => allowTest || !t.test);
  if (!usable.length) return null;
  const window = recent.slice(-noRepeatWithin);
  const moods = MOOD_FOR[type];
  const score = (t: Track) => {
    const m = Math.min(...t.moods.map((x) => (moods.includes(x) ? moods.indexOf(x) : 9)));
    return (m === 9 ? 20 : m * 3) + Math.abs(t.energy - energy) * 2 + (window.includes(t.file) ? 100 : 0);
  };
  const ranked = [...usable].sort((a, b) => score(a) - score(b));
  const best = score(ranked[0]);
  // A little variation between equally good tracks.
  const ties = ranked.filter((t) => score(t) <= best + 2);
  return ties[Math.floor(rnd() * ties.length)] ?? ranked[0];
}

/**
 * The KIVOXEL motif (own music, Milan 18-11-2026): never in a Short (Milan, 18-11-2026 23:00; the first second
 * belongs to the action, a known tune at the start makes viewers swipe), and at the start and the end of a long video. Not in "Alleen gamegeluid" (no music and no voice). Softer under a voice than in the music mode.
 */
export function motifCues(o: { short: boolean; durationMs: number; motifMs: number; music: boolean; voice: boolean }): { atMs: number; db: number }[] {
  if (!o.music && !o.voice) return [];
  const db = o.voice ? -14 : -8;
  if (o.short) return []; // Milan, 18-11-2026 23:00: no motif in Shorts at all
  if (o.durationMs < o.motifMs * 3) return [{ atMs: 0, db }];
  return [{ atMs: 0, db }, { atMs: Math.max(0, o.durationMs - o.motifMs), db }];
}

/** Where to start in the track so a downbeat (start of a bar of 4 beats) lands exactly on `peakMs` in the video. */
export function beatStart(track: Pick<Track, "bpm" | "beat_offset_ms">, peakMs: number | null, extraBars = 0): number {
  if (peakMs === null) return Math.max(0, track.beat_offset_ms ?? 0);
  const bar = (4 * 60_000) / track.bpm;
  const first = track.beat_offset_ms ?? 0;
  let k = Math.ceil((peakMs - first) / bar) + Math.max(0, extraBars);
  if (k < 0) k = 0;
  return Math.round(first + k * bar - peakMs);
}

/** Cut moments in the video: where one piece of footage ends and the next begins. */
export const cutTimes = (segments: Segment[]) =>
  [...segments]
    .sort((a, b) => a.out_start_ms - b.out_start_ms)
    .slice(1)
    .map((s) => s.out_start_ms);

/**
 * The SFX layer: whoosh on every cut, impact on big peaks, record scratch on a death. Variants rotate (never the same
 * file twice in a row, avoiding the last `noRepeatWithin`). `db` per kind; louder when there is no voice.
 */
export function planSfx(input: { segments: Segment[]; peaks: { atMs: number; payoff: number; death: boolean }[]; library: Sfx[]; recent: string[]; rnd: () => number; withVoice: boolean; noRepeatWithin?: number; durationMs: number }): { file: string; atMs: number; db: number; kind: SfxKind }[] {
  const used = [...input.recent];
  const n = input.noRepeatWithin ?? 3;
  const base = input.withVoice ? -8 : -3;
  const pickOf = (kind: SfxKind) => {
    const all = input.library.filter((s) => s.kind === kind);
    if (!all.length) return null;
    const fresh = all.filter((s) => !used.slice(-n).includes(s.file));
    const pool = fresh.length ? fresh : all;
    const s = pool[Math.floor(input.rnd() * pool.length)];
    used.push(s.file);
    return s;
  };
  const out: { file: string; atMs: number; db: number; kind: SfxKind }[] = [];
  const add = (kind: SfxKind, atMs: number, extraDb = 0) => {
    const s = pickOf(kind);
    if (s && atMs >= 0 && atMs < input.durationMs - 150) out.push({ file: s.file, atMs: Math.round(atMs), db: base + (s.db ?? 0) + extraDb, kind });
  };
  // The whoosh starts a little before the cut, so its loudest part lands on the cut.
  for (const c of cutTimes(input.segments)) add("whoosh", c - 180);
  for (const p of input.peaks.filter((x) => x.payoff >= 50)) {
    add("impact", p.atMs - 30, 2);
    if (p.death) add("scratch", p.atMs + 350);
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

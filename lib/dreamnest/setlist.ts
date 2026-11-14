// Dreamnest fase 6: the setlist of an episode, against "boring and repetitive" (Milan, 14-11-2026).
// Every song sounds at most once per episode; instrument, style, key and tempo change from song to song.
// Story: the public-domain themes plus new songs. Falling asleep: new songs, slower and thinner. Sleep: a long row of
// new, slow, sparse songs with quiet space between them (only the soft pad and the room), never the same twice.
import { arrange, composeSong, MELODIES, rng, type Lead, type Melody, type NoteEvent, type Style } from "./music.ts";

export type Part = "story" | "falling_asleep" | "sleep";
export type Cue = { melody: Melody; style: Style; lead: Lead; second: Lead; bpm: number; transpose: number; thin: number; gapS: number };

const LEADS: Record<Part, Lead[]> = { story: ["musicbox", "celesta", "harp", "felt"], falling_asleep: ["celesta", "felt", "harp"], sleep: ["felt", "harp", "celesta"] };
const STYLES: Record<Part, Style[]> = { story: ["plain", "answer", "arpeggio"], falling_asleep: ["answer", "arpeggio", "low"], sleep: ["low", "plain", "arpeggio"] };
/** Keys close to home, so a change is gentle: C, F, D, G-below, B-flat-below. */
const KEYS = [0, 5, 2, -5, -2];

/**
 * Songs for one part of lengthS seconds. songSeed gives the composed songs their seeds; every part gets its own
 * range, so no composed song comes back anywhere in the episode.
 */
export function planCues(part: Part, lengthS: number, seed: number): Cue[] {
  const r = rng(seed * 31 + part.length);
  const cues: Cue[] = [];
  const base = seed * 1000 + (part === "story" ? 0 : part === "falling_asleep" ? 300 : 600);
  const themes = part === "story" ? [...MELODIES] : [];
  let t = 0;
  for (let k = 0; t < lengthS; k++) {
    // Story: alternate a known theme and a new song; the rest: only new songs.
    const melody = part === "story" && k % 2 === 0 && themes.length ? themes.shift()! : composeSong(base + k);
    const progress = Math.min(1, t / Math.max(1, lengthS));
    const bpm = part === "story" ? 64 + Math.round(r() * 6) : part === "falling_asleep" ? Math.round(60 - progress * 6) : 50 + Math.round(r() * 4);
    const thin = part === "story" ? 0 : part === "falling_asleep" ? 0.1 + progress * 0.35 : 0.3 + r() * 0.15;
    const prev = cues[cues.length - 1];
    const lead = LEADS[part].filter((l) => l !== prev?.lead)[Math.floor(r() * (LEADS[part].length - 1))];
    const style = STYLES[part].filter((s) => s !== prev?.style)[Math.floor(r() * (STYLES[part].length - 1))];
    const second = (["celesta", "harp", "felt"] as Lead[]).filter((l) => l !== lead)[Math.floor(r() * 2)];
    const transpose = KEYS[k % KEYS.length];
    const gapS = part === "story" ? 3 : part === "falling_asleep" ? 6 : 14 + Math.round(r() * 14);
    cues.push({ melody, style, lead, second, bpm, transpose, thin, gapS });
    t += (melodyLength(melody) * 60) / bpm + gapS;
  }
  return cues;
}

const melodyLength = (m: Melody) => m.notes.reduce((s, n) => s + n[1], 0);

/**
 * The music of one part: the cues one after another. In the quiet space between two songs the last chord of the
 * song keeps sounding softly on the pad, so it is never empty. Notes past the end are left out.
 */
export function renderCues(cues: Cue[], lengthS: number, seed: number): { events: NoteEvent[]; lengthS: number } {
  const events: NoteEvent[] = [];
  let t = 0;
  cues.forEach((c, k) => {
    const song = arrange(c.melody, c.bpm, { transpose: c.transpose, thin: c.thin, lead: c.lead, second: c.second, style: c.style, seed: seed + k });
    for (const e of song.events) events.push({ ...e, t: e.t + t });
    const pads = song.events.filter((e) => e.instrument === "pad");
    const lastStart = Math.max(...pads.map((e) => e.t));
    for (const p of pads.filter((e) => e.t === lastStart)) events.push({ ...p, t: t + song.lengthS, dur: c.gapS + 1, vel: p.vel * 0.8 });
    t += song.lengthS + c.gapS;
  });
  return { events: events.filter((e) => e.t < lengthS - 4).sort((a, b) => a.t - b.t), lengthS };
}

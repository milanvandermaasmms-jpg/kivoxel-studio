// Dreamnest fase 3: melodies, harmony and arrangement for the own lullaby generator. Pure functions, tested.
// Only public-domain melodies (newly arranged, never existing recordings) and melodies the generator composes itself.

export type Note = [midi: number, beats: number];
export type Melody = { id: string; title: string; source: string; beatsPerBar: 3 | 4; notes: Note[] };
export type NoteEvent = { t: number; dur: number; midi: number; instrument: "musicbox" | "celesta" | "harp" | "pad"; vel: number };

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72;

export const MELODIES: Melody[] = [
  {
    id: "twinkle",
    title: "Twinkle, Twinkle (Ah! vous dirai-je, maman)",
    source: "Franse volksmelodie, 18e eeuw: publiek domein. Eigen arrangement.",
    beatsPerBar: 4,
    notes: [
      [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
      [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2], [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2],
      [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
    ],
  },
  {
    id: "brahms",
    title: "Wiegenlied (Brahms, op. 49 nr. 4)",
    source: "Johannes Brahms, 1868 (overleden 1897): publiek domein. Eigen arrangement.",
    beatsPerBar: 3,
    notes: [
      [E4, 0.5], [E4, 0.5], [G4, 1.5], [E4, 0.5], [E4, 1], [G4, 2], [E4, 0.5], [G4, 0.5], [C5, 1], [B4, 1.5], [A4, 0.5], [A4, 1], [G4, 2],
      [D4, 0.5], [E4, 0.5], [F4, 1], [D4, 1], [D4, 0.5], [E4, 0.5], [F4, 2], [D4, 0.5], [F4, 0.5], [B4, 0.5], [A4, 0.5], [G4, 1], [B4, 1], [C5, 2],
      [C4, 0.5], [C4, 0.5], [C5, 2], [A4, 0.5], [F4, 0.5], [G4, 2], [E4, 0.5], [C4, 0.5], [F4, 1], [G4, 1], [A4, 1], [G4, 2],
      [C4, 0.5], [C4, 0.5], [C5, 2], [A4, 0.5], [F4, 0.5], [G4, 2], [F4, 0.5], [D4, 0.5], [C4, 1], [D4, 0.5], [E4, 0.5], [C4, 2],
    ],
  },
];

/** Small deterministic random generator, so the same seed always gives the same song. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const PENTA = [C4, D4, E4, G4, A4, C5];

/**
 * A new lullaby composed by the generator: pentatonic (no clashing notes), mostly stepwise, AABA in 8 bars of 3/4,
 * every phrase ends long, the song ends on the home note. Different seed = different song.
 */
export function composeLullaby(seed: number): Melody {
  const r = rng(seed);
  const rhythms: number[][] = [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [3]];
  const phrase = (end: number): Note[] => {
    const notes: Note[] = [];
    let i = 2 + Math.floor(r() * 2);
    for (let bar = 0; bar < 2; bar++) {
      const rhythm = bar === 1 ? [2, 1] : rhythms[Math.floor(r() * 3)];
      for (const d of rhythm) {
        i = Math.max(0, Math.min(PENTA.length - 1, i + [-1, -1, 0, 1, 1, 2][Math.floor(r() * 6)] * (r() < 0.8 ? 1 : 0)));
        notes.push([PENTA[i], d]);
      }
    }
    notes.pop();
    notes.pop();
    // Land on the target note in the octave closest to where the melody is, so the end is a small step.
    const prev = notes[notes.length - 1][0];
    const target = [end - 12, end, end + 12].filter((p) => p >= C4 && p <= C5).sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev))[0];
    notes.push([target, 3]);
    return notes;
  };
  const a = phrase(PENTA[3]);
  const b = phrase(PENTA[4]);
  const end = phrase(PENTA[0]);
  return { id: `eigen-${seed}`, title: `Dreamnest-slaapliedje ${seed}`, source: "Gecomponeerd door de Dreamnest-generator: eigen werk.", beatsPerBar: 3, notes: [...a, ...a, ...b, ...end] };
}

const CHORDS: Record<string, number[]> = { C: [C4, E4, G4], F: [F4 - 12, A4 - 12, C4], G: [G4 - 12, B4 - 12, D4], Am: [A4 - 12, C4, E4] };

/** A simple chord per bar: the first that contains the strongest melody note of that bar (home chord at the end). */
export function harmonize(m: Melody): string[] {
  const bars: Note[][] = [];
  let acc = 0;
  for (const n of m.notes) {
    const bar = Math.floor(acc / m.beatsPerBar + 1e-9);
    (bars[bar] ??= []).push(n);
    acc += n[1];
  }
  return bars.map((notes, i) => {
    if (i === bars.length - 1) return "C";
    const main = [...notes].sort((x, y) => y[1] - x[1])[0][0] % 12;
    return (["C", "F", "G", "Am"] as const).find((c) => CHORDS[c].some((p) => p % 12 === main)) ?? "C";
  });
}

export const melodyBeats = (m: Melody) => m.notes.reduce((s, n) => s + n[1], 0);

/**
 * Arrangement of one melody: music box on the melody, harp arpeggio, soft pad chords. thin (0-1) removes notes for
 * the falling-asleep part: 0 = everything, 1 = only pad. Times in seconds from start.
 */
export function arrange(m: Melody, bpm: number, opts: { transpose?: number; thin?: number; seed?: number; lead?: "musicbox" | "celesta" } = {}): { events: NoteEvent[]; lengthS: number } {
  const beat = 60 / bpm;
  const tr = opts.transpose ?? 0;
  const thin = opts.thin ?? 0;
  const r = rng(opts.seed ?? 7);
  const events: NoteEvent[] = [];
  let t = 0;
  for (const [midi, beats] of m.notes) {
    if (r() >= thin) events.push({ t: t * beat, dur: beats * beat, midi: midi + 12 + tr, instrument: opts.lead ?? "musicbox", vel: 0.5 + r() * 0.1 });
    t += beats;
  }
  const chords = harmonize(m);
  chords.forEach((c, bar) => {
    const start = bar * m.beatsPerBar * beat;
    const len = m.beatsPerBar * beat;
    for (const p of CHORDS[c]) events.push({ t: start, dur: len * 1.02, midi: p - 12 + tr, instrument: "pad", vel: 0.22 });
    if (r() >= thin * 0.7) CHORDS[c].forEach((p, k) => events.push({ t: start + k * beat, dur: beat * 2, midi: p + tr, instrument: "harp", vel: 0.28 }));
  });
  return { events: events.sort((a, b) => a.t - b.t), lengthS: t * beat };
}

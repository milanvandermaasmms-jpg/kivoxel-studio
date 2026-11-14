// Dreamnest fase 3: melodies, harmony and arrangement for the own lullaby generator. Pure functions, tested.
// Only public-domain melodies (newly arranged, never existing recordings) and melodies the generator composes itself.

export type Note = [midi: number, beats: number];
export type Melody = { id: string; title: string; source: string; beatsPerBar: 3 | 4; notes: Note[]; home?: "C" | "Am" };
export type NoteEvent = { t: number; dur: number; midi: number; instrument: Instrument; vel: number };
export type Instrument = "musicbox" | "celesta" | "harp" | "pad" | "felt";
export type Lead = Exclude<Instrument, "pad">;

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71, C5 = 72;
const G3 = 55, A3 = 57, B3 = 59, D5 = 74;

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
  {
    id: "auclair",
    title: "Au clair de la lune",
    source: "Franse volksmelodie, 18e eeuw: publiek domein. Eigen arrangement.",
    beatsPerBar: 4,
    notes: [
      [C4, 1], [C4, 1], [C4, 1], [D4, 1], [E4, 2], [D4, 2], [C4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 4],
      [C4, 1], [C4, 1], [C4, 1], [D4, 1], [E4, 2], [D4, 2], [C4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 4],
      [D4, 1], [D4, 1], [D4, 1], [D4, 1], [A3, 2], [A3, 2], [D4, 1], [C4, 1], [B3, 1], [A3, 1], [G3, 4],
      [C4, 1], [C4, 1], [C4, 1], [D4, 1], [E4, 2], [D4, 2], [C4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 4],
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

const CHORDS: Record<string, number[]> = { C: [C4, E4, G4], F: [F4 - 12, A4 - 12, C4], G: [G4 - 12, B4 - 12, D4], Am: [A4 - 12, C4, E4], Dm: [D4, F4, A4], Em: [E4, G4, B4] };

/** A simple chord per bar: the first that contains the strongest melody note of that bar (home chord at the end). */
export function harmonize(m: Melody): string[] {
  const home = m.home ?? "C";
  const order = home === "Am" ? (["Am", "Dm", "Em", "C", "F", "G"] as const) : (["C", "F", "G", "Am", "Dm", "Em"] as const);
  const bars: Note[][] = [];
  let acc = 0;
  for (const n of m.notes) {
    const bar = Math.floor(acc / m.beatsPerBar + 1e-9);
    (bars[bar] ??= []).push(n);
    acc += n[1];
  }
  return bars.map((notes, i) => {
    if (i === bars.length - 1) return home;
    const main = [...notes].sort((x, y) => y[1] - x[1])[0][0] % 12;
    return order.find((c) => CHORDS[c].some((p) => p % 12 === main)) ?? home;
  });
}

export const melodyBeats = (m: Melody) => m.notes.reduce((s, n) => s + n[1], 0);

export type Style = "plain" | "arpeggio" | "answer" | "low";

/**
 * Arrangement of one melody. Styles (fase 6, against repetition): plain = melody + harp chord + pad; arpeggio =
 * flowing broken chords; answer = a second voice answers each bar just below; low = melody an octave lower on the
 * felt piano with only the pad. thin (0-1) removes notes for the falling-asleep and sleep parts. Times in seconds.
 */
export function arrange(m: Melody, bpm: number, opts: { transpose?: number; thin?: number; seed?: number; lead?: Lead; style?: Style; second?: Lead } = {}): { events: NoteEvent[]; lengthS: number } {
  const beat = 60 / bpm;
  const tr = opts.transpose ?? 0;
  const thin = opts.thin ?? 0;
  const style = opts.style ?? "plain";
  const r = rng(opts.seed ?? 7);
  const events: NoteEvent[] = [];
  const octave = style === "low" ? 0 : 12;
  const lead: Lead = style === "low" ? "felt" : (opts.lead ?? "musicbox");
  let t = 0;
  for (const [midi, beats] of m.notes) {
    if (r() >= thin) events.push({ t: t * beat, dur: beats * beat, midi: midi + octave + tr, instrument: lead, vel: 0.5 + r() * 0.1 });
    t += beats;
  }
  const chords = harmonize(m);
  const bars = barsOf(m);
  chords.forEach((c, bar) => {
    const start = bar * m.beatsPerBar * beat;
    const len = m.beatsPerBar * beat;
    for (const p of CHORDS[c]) events.push({ t: start, dur: len * 1.02, midi: p - 12 + tr, instrument: "pad", vel: style === "low" ? 0.26 : 0.22 });
    if (style === "low") return;
    if (style === "arpeggio") {
      // Up and down through the chord, two notes per beat, softly.
      const tones = [...CHORDS[c], CHORDS[c][0] + 12, CHORDS[c][2], CHORDS[c][1]];
      for (let k = 0; k < m.beatsPerBar * 2; k++) if (r() >= thin * 0.6) events.push({ t: start + (k * beat) / 2, dur: beat * 1.5, midi: tones[k % tones.length] + tr, instrument: "harp", vel: 0.22 });
    } else if (r() >= thin * 0.7) CHORDS[c].forEach((p, k) => events.push({ t: start + k * beat, dur: beat * 2, midi: p + tr, instrument: "harp", vel: 0.28 }));
    if (style === "answer" && bars[bar]?.length && r() >= thin) {
      // The longest note of the bar, answered half a bar later by a chord tone just below it.
      const main = [...bars[bar]].sort((x, y) => y[1] - x[1])[0][0] + octave;
      const below = CHORDS[c].flatMap((p) => [p + 12, p + 24]).filter((p) => p < main).sort((x, y) => y - x)[0] ?? main - 12;
      events.push({ t: start + len / 2, dur: len / 2, midi: below + tr, instrument: opts.second ?? "celesta", vel: 0.34 });
    }
  });
  return { events: events.sort((a, b) => a.t - b.t), lengthS: t * beat };
}

function barsOf(m: Melody): Note[][] {
  const bars: Note[][] = [];
  let acc = 0;
  for (const n of m.notes) {
    (bars[Math.floor(acc / m.beatsPerBar + 1e-9)] ??= []).push(n);
    acc += n[1];
  }
  return bars;
}

const SCALES = { major: [C4, D4, E4, G4, A4, C5, D5], minor: [A3, C4, D4, E4, G4, A4, C5] } as const;
const RHYTHMS: Record<3 | 4, number[][]> = {
  3: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [1, 2], [0.5, 0.5, 1, 1]],
  4: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 2], [2, 2]],
};

/**
 * Fase 6 composer: a 16-bar song (A A' B A'') in 3/4 or 4/4, major or minor pentatonic (no clashing notes).
 * The motif of A comes back in A' and A'' (varied); A ends open, the last phrase at home. Different seed = different song.
 */
export function composeSong(seed: number, o: { meter?: 3 | 4; scale?: "major" | "minor" } = {}): Melody {
  const r = rng(seed * 7919 + 13);
  const meter = o.meter ?? (r() < 0.6 ? 3 : 4);
  const scale = o.scale ?? (r() < 0.7 ? "major" : "minor");
  const P = SCALES[scale];
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const step = () => pick([-1, -1, 0, 1, 1, 2, -2]);
  const near = (pc: number, prev: number) => [pc + 48, pc + 60, pc + 72].filter((p) => p >= P[0] && p <= P[P.length - 1]).sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev))[0];
  /** Three bars from a start index with given rhythms, then one bar with a long note on the target. */
  const phrase = (startIdx: number, rhythms: number[][], targetPc: number, steps: number[] = [], prev?: number): { notes: Note[]; steps: number[] } => {
    const notes: Note[] = [];
    const used: number[] = [];
    let i = startIdx;
    for (const rh of rhythms)
      for (const d of rh) {
        const s = steps[used.length] ?? step();
        used.push(s);
        i = Math.max(0, Math.min(P.length - 1, i + s));
        // The first note of a phrase stays close to where the last phrase ended (no big leaps in a lullaby).
        if (!notes.length && prev !== undefined && Math.abs(P[i] - prev) > 7) i = P.reduce((best, x, j) => (Math.abs(x - prev) < Math.abs(P[best] - prev) ? j : best), 0);
        notes.push([P[i], d]);
      }
    notes.push([near(targetPc, notes[notes.length - 1][0]), meter]);
    return { notes, steps: used };
  };
  const home = P[0] % 12;
  const open = (scale === "major" ? G4 : E4) % 12;
  const rh = [pick(RHYTHMS[meter]), pick(RHYTHMS[meter]), pick(RHYTHMS[meter])];
  const a = phrase(2, rh, open);
  const motif = a.steps.slice(0, rh[0].length);
  const last = (x: { notes: Note[] }) => x.notes[x.notes.length - 1][0];
  const a2 = phrase(2, rh, home, motif, last(a));
  const b = phrase(4, [pick(RHYTHMS[meter]), pick(RHYTHMS[meter]), pick(RHYTHMS[meter])], (scale === "major" ? A4 : G4) % 12, [], last(a2));
  const a3 = phrase(2, rh, home, [...motif, ...a2.steps.slice(motif.length).map((s) => (r() < 0.3 ? -s : s))], last(b));
  return {
    id: `song-${seed}`,
    title: `Dreamnest-slaapliedje ${seed}`,
    source: "Gecomponeerd door de Dreamnest-generator: eigen werk.",
    beatsPerBar: meter,
    home: scale === "major" ? "C" : "Am",
    notes: [...a.notes, ...a2.notes, ...b.notes, ...a3.notes],
  };
}

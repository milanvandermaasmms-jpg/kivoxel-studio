// KIVOXEL eigen muziek, versie 2 (17-11-2026). Own work: composed note by note in this file and synthesised here
// (pulse, triangle, noise, wood block and a modern kick). No samples, no AI service, nobody else owns any rights.
//
// The style borrows WORKING METHODS from classic platform-game scores (Koji Kondo's Mario music), never their melodies:
// - one small motif (the KIVOXEL cell) from which everything grows by variation (transposed, answered, turned to minor);
// - a brisk tempo that follows the action, few voices with a clear job each (melody, bass, rhythm), rests that matter;
// - a "level" per situation: above ground (swing, short notes), cave (sparse, low, silence), find (syncopated wood
//   block), fight (driving) and end boss (minor, chromatic ostinato bass, tension);
// - short jingles for game moments: start (the motif), victory and "oops".
// Output (for listening first; nothing goes into the library yet): <data>/kivoxel-media/music-eigen/
//   node scripts/kivoxel-make-music.ts
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findTool } from "../worker/ffmpeg.ts";

const SR = 48_000;
const BPM = 150;
const S16 = 60 / BPM / 4; // one sixteenth: 0.1 s
const BAR = 16; // sixteenths per bar (1.6 s)

const ffmpeg = findTool("ffmpeg", process.env.FFMPEG_PATH);
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const outDir = join(dataDir, "kivoxel-media", "music-eigen");
await mkdir(outDir, { recursive: true });
for (const f of await readdir(outDir)) if (f.startsWith("kivoxel-")) await rm(join(outDir, f)); // earlier versions of our own files

// ---------- notes ----------
const NOTE: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const midi = (n: string) => {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`Onbekende noot ${n}`);
  return NOTE[m[1]] + 12 * (Number(m[2]) + 1);
};
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** "D5:2 F#5:2 -:4" -> notes with lengths in sixteenths ("-" is a rest). */
type Seq = { m: number | null; len: number }[];
const seq = (...parts: string[]): Seq =>
  parts
    .join(" ")
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const [n, l] = tok.split(":");
      return { m: n === "-" ? null : midi(n), len: Number(l ?? 1) };
    });
const lenOf = (q: Seq) => q.reduce((s, n) => s + n.len, 0);
/** Every phrase must fill whole bars, or the loop drifts. */
const whole = (name: string, q: Seq) => {
  if (lenOf(q) % BAR) throw new Error(`${name} is ${lenOf(q)} zestienden, geen hele maten`);
  return q;
};

// ---------- the mix ----------
class Mix {
  L: Float32Array;
  R: Float32Array;
  seconds: number;
  constructor(seconds: number) {
    this.seconds = seconds;
    this.L = new Float32Array(Math.ceil(seconds * SR));
    this.R = new Float32Array(Math.ceil(seconds * SR));
  }
  add(i: number, v: number, pan = 0) {
    if (i < 0 || i >= this.L.length) return;
    this.L[i] += v * Math.min(1, 1 - pan);
    this.R[i] += v * Math.min(1, 1 + pan);
  }
}

/** Swing: the second sixteenth of every pair comes a little late (a shuffle feel above ground). */
const at16 = (pos: number, swing = 0) => (pos + (pos % 2 === 1 ? swing : 0)) * S16;

const blep = (t: number, dt: number) => (t < dt ? ((t /= dt), t + t - t * t - 1) : t > 1 - dt ? ((t = (t - 1) / dt), t * t + t + t + 1) : 0);
// "lead" is the KIVOXEL voice (version 2b, Milan: "te hoog en te saai"): an octave lower than before, two slightly
// detuned pulses whose width keeps moving, a sub octave underneath and a filter that snaps open on every note.
type Voice = "pulse12" | "pulse25" | "pulse50" | "tri" | "lead";
/** The KIVOXEL voice sounds an octave below the written melody. */
const LEAD_SHIFT = -12;
type NoteOpts = { vol: number; pan?: number; gate?: number; vibrato?: boolean; slide?: number; decay?: number; release?: number; echo?: number };

function tone(mix: Mix, voice: Voice, startS: number, durS: number, m: number, o: NoteOpts) {
  const f0 = hz(m);
  const gate = durS * (o.gate ?? 0.9);
  const rel = o.release ?? 0.03;
  const duty = voice === "pulse12" ? 0.125 : voice === "pulse25" ? 0.25 : 0.5;
  let phase = 0;
  let phase2 = 0.37;
  let phaseSub = 0;
  let lp = 0;
  const i0 = Math.round(startS * SR);
  const n = Math.round((gate + rel) * SR);
  const echoes = o.echo ? [[0, 1], [0.3, o.echo], [0.6, o.echo * o.echo]] : [[0, 1]];
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    let f = f0;
    if (o.slide) f *= 2 ** ((o.slide * Math.max(0, 1 - t / 0.07)) / 12);
    if (o.vibrato && t > 0.18) f *= 2 ** ((0.2 * Math.sin(2 * Math.PI * 5.5 * (t - 0.18)) * Math.min(1, (t - 0.18) / 0.2)) / 12);
    const dt = f / SR;
    let s: number;
    if (voice === "tri") s = Math.round((1 - 4 * Math.abs(phase - 0.5)) * 7.5) / 7.5; // 4-bit steps, like an old console
    else if (voice === "lead") {
      const w = 0.32 + 0.16 * Math.sin(2 * Math.PI * 0.9 * (startS + t)); // moving pulse width: the sound "breathes"
      const dt2 = dt * 1.006;
      const a = (phase < w ? 1 : -1) + blep(phase, dt) - blep((phase - w + 1) % 1, dt);
      const b = (phase2 < 1 - w ? 1 : -1) + blep(phase2, dt2) - blep((phase2 - (1 - w) + 1) % 1, dt2);
      const sub = phaseSub < 0.5 ? 0.55 : -0.55; // square one octave down: weight in the low mids
      phase2 = (phase2 + dt2) % 1;
      phaseSub = (phaseSub + dt / 2) % 1;
      // The filter opens bright on the attack and settles warmer: punch without the thin "beep".
      const fc = 1900 + 5200 * Math.exp(-t / 0.09);
      lp += (1 - Math.exp((-2 * Math.PI * fc) / SR)) * ((a + b) * 0.5 + sub - lp);
      s = lp * 1.1;
    } else s = (phase < duty ? 1 : -1) + blep(phase, dt) - blep((phase - duty + 1) % 1, dt);
    phase = (phase + dt) % 1;
    let env = Math.min(1, t / 0.003);
    if (o.decay) env *= Math.max(0.3, Math.exp(-t / o.decay));
    if (t > gate) env *= Math.max(0, 1 - (t - gate) / rel);
    for (const [d, g] of echoes) mix.add(i0 + k + Math.round(d * SR), s * env * o.vol * g, d === 0 ? (o.pan ?? 0) : d === 0.3 ? 0.5 : -0.5);
  }
}

function play(mix: Mix, voice: Voice, atBar: number, q: Seq, o: NoteOpts & { octave?: number; swing?: number; accent?: number[] }) {
  let pos = atBar * BAR;
  for (const n of q) {
    if (n.m !== null) tone(mix, voice, at16(pos, o.swing), n.len * S16, n.m + 12 * (o.octave ?? 0) + (voice === "lead" ? LEAD_SHIFT : 0), { ...o, vol: o.vol * (o.accent?.includes(pos % BAR) ? 1.25 : 1) });
    pos += n.len;
  }
}

// ---------- percussion ----------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
function kick(mix: Mix, at: number, vol = 1) {
  const i0 = Math.round(at * SR);
  let ph = 0;
  for (let k = 0; k < 0.3 * SR; k++) {
    const t = k / SR;
    ph += (44 + 150 * Math.exp(-t * 32)) / SR;
    const s = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) + (t < 0.004 ? rnd() * 0.5 : 0);
    mix.add(i0 + k, Math.tanh(1.8 * s) * 0.9 * vol);
  }
}
function snare(mix: Mix, at: number, vol = 1) {
  const i0 = Math.round(at * SR);
  let held = 0;
  let lp = 0;
  for (let k = 0; k < 0.2 * SR; k++) {
    const t = k / SR;
    if (k % 3 === 0) held = rnd(); // chip-style noise
    lp += 0.55 * (held - lp);
    mix.add(i0 + k, ((held - lp) * Math.exp(-t * 17) * 0.75 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) * 0.4) * vol);
  }
}
function hat(mix: Mix, at: number, open = false, vol = 1, pan = 0.25) {
  const i0 = Math.round(at * SR);
  let prev = 0;
  for (let k = 0; k < (open ? 0.15 : 0.03) * SR; k++) {
    const t = k / SR;
    const w = rnd();
    mix.add(i0 + k, (w - prev) * Math.exp(-t * (open ? 22 : 95)) * 0.26 * vol, pan);
    prev = w;
  }
}
/** A wood block: a short pitched knock (the syncopated "find" and "boss" ostinatos). */
function block(mix: Mix, at: number, high = false, vol = 1) {
  const i0 = Math.round(at * SR);
  const f = high ? 1250 : 880;
  for (let k = 0; k < 0.06 * SR; k++) {
    const t = k / SR;
    mix.add(i0 + k, (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2.7 * t) * 0.15) * Math.exp(-t * 70) * vol, high ? 0.35 : -0.35);
  }
}
function crash(mix: Mix, at: number, vol = 1) {
  const i0 = Math.round(at * SR);
  let prev = 0;
  let held = 0;
  for (let k = 0; k < 1.5 * SR; k++) {
    const t = k / SR;
    if (k % 2 === 0) held = rnd();
    mix.add(i0 + k, (held - prev) * Math.exp(-t * 2.7) * 0.3 * vol, k % 2 ? 0.3 : -0.3);
    prev = held;
  }
}
function riser(mix: Mix, from: number, len: number, vol = 0.5) {
  const i0 = Math.round(from * SR);
  let prev = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR;
    const w = rnd();
    mix.add(i0 + k, (w - prev * (0.2 + 0.75 * (t / len))) * (t / len) ** 2 * 0.28 * vol);
    prev = w;
  }
}
/** One bar from a 16-step pattern: K kick, S snare, s ghost, h hat, o open hat, b/B wood block, X kick+crash. */
function drums(mix: Mix, bar: number, pattern: string, vol = 1, swing = 0) {
  [...pattern.replace(/\s/g, "")].forEach((c, step) => {
    const at = at16(bar * BAR + step, swing);
    if (c === "K") kick(mix, at, vol);
    if (c === "S") snare(mix, at, vol);
    if (c === "s") snare(mix, at, 0.35 * vol);
    if (c === "h") hat(mix, at, false, vol, step % 2 ? 0.3 : -0.3);
    if (c === "o") hat(mix, at, true, vol);
    if (c === "b") block(mix, at, false, vol);
    if (c === "B") block(mix, at, true, vol);
    if (c === "X") (kick(mix, at, vol), crash(mix, at, vol));
  });
}

// ---------- harmony ----------
type Chord = { root: string; minor?: boolean };
const C = (root: string, minor = false): Chord => ({ root, minor });
const rootOf = (c: Chord) => {
  const r = midi(`${c.root}2`);
  return r > midi("A2") ? r - 12 : r;
};
const triad = (c: Chord) => {
  const r = midi(`${c.root}4`);
  return [r, r + (c.minor ? 3 : 4), r + 7];
};
type BassStyle = "bounce" | "tresillo" | "eighths" | "drive" | "whole";
function bass(mix: Mix, bar: number, c: Chord, style: BassStyle, vol = 0.5, swing = 0) {
  const r = rootOf(c);
  const f = r + 7;
  const pats: Record<BassStyle, [number | null, number][]> = {
    // Above ground: short root / fifth hops with rests, like footsteps.
    bounce: [[r, 2], [null, 2], [f, 2], [null, 1], [r + 12, 1], [r, 2], [null, 2], [f, 2], [r + 12, 2]],
    // 3+3+2: the syncopated latin pulse under the find.
    tresillo: [[r, 3], [r + 12, 3], [f, 2], [r, 3], [r + 12, 3], [f - 12 + 12, 2]],
    eighths: Array.from({ length: 8 }, (_, i) => [i % 2 ? r + 12 : r, 2] as [number, number]),
    drive: Array.from({ length: 16 }, (_, i) => [i % 4 === 3 ? r + 12 : r, 1] as [number, number]),
    whole: [[r, 16]],
  };
  let pos = bar * BAR;
  for (const [m, len] of pats[style]) {
    if (m !== null) tone(mix, "tri", at16(pos, swing), len * S16, m, { vol, gate: style === "drive" ? 0.7 : style === "bounce" ? 0.55 : 0.85 });
    pos += len;
  }
}
function arp(mix: Mix, bar: number, c: Chord, rate: 1 | 2, vol = 0.07, pan = 0.4, octave = 0) {
  const t = triad(c).map((m) => m + 12 * octave);
  const cycle = [t[0], t[1], t[2], t[0] + 12];
  for (let i = 0; i < BAR / rate; i++) tone(mix, "pulse12", (bar * BAR + i * rate) * S16, rate * S16, cycle[i % 4], { vol, pan, gate: 0.55, decay: 0.1 });
}
/** Short chord stabs on the off-beats (the "chk" of the harmony voice). */
function stabs(mix: Mix, bar: number, c: Chord, steps: number[], vol = 0.05, swing = 0) {
  for (const s of steps) for (const m of triad(c)) tone(mix, "pulse50", at16(bar * BAR + s, swing), S16, m, { vol, pan: -0.35, gate: 0.6 });
}

// ---------- the KIVOXEL cell ----------
// One bar: a pickup (5-1), a syncopated 3, a little turn (2-3), a held 5 and the jump to the octave (8).
// Everything below is this cell: transposed, answered, turned upside down or into minor.
const CELL = "A4:1 D5:1 -:1 F#5:2 E5:1 F#5:1 A5:3 -:2 D6:2 -:2";
const ANSWER = "B5:1 A5:1 -:1 F#5:2 E5:1 D5:1 E5:3 -:2 A4:2 -:2";
const CELL_UP = "D5:1 G5:1 -:1 B5:2 A5:1 B5:1 D6:3 -:2 G6:2 -:2";
const CADENCE = "F#6:1 E6:1 -:1 D6:2 C#6:1 E6:1 D6:5 -:4";
const THEME = seq(CELL, ANSWER, CELL_UP, CADENCE);
const PROG_A = [C("D"), C("A"), C("G"), C("D")];
// The bridge: the cell in B minor and in the subdominant, climbing to the dominant.
const BRIDGE = seq(
  "F#5:1 B4:1 -:1 D5:2 C#5:1 D5:1 F#5:3 -:2 B5:2 -:2",
  "D5:1 G5:1 -:1 B5:2 A5:1 G5:1 D5:3 -:2 B4:2 -:2",
  "B4:1 E5:1 -:1 G5:2 F#5:1 G5:1 B5:3 -:2 E6:2 -:2",
  "A5:1 -:1 A5:1 B5:1 -:1 C#6:1 -:1 D6:1 E6:4 -:4",
);
const PROG_B = [C("B", true), C("G"), C("E", true), C("A")];
// The end boss: the same cell in D minor, a chromatic answer and a tritone (Eb against A) for tension.
const BOSS_THEME = seq(
  "A4:1 D5:1 -:1 F5:2 E5:1 F5:1 A5:3 -:2 D6:2 -:2",
  "Bb5:1 A5:1 -:1 F5:2 E5:1 D5:1 C#5:3 -:2 A4:2 -:2",
  "D5:1 F5:1 -:1 G#5:2 A5:1 G#5:1 A5:3 -:2 Eb6:2 -:2",
  "D6:1 C#6:1 -:1 C6:2 B5:1 Bb5:1 A5:5 -:4",
);
const PROG_BOSS = [C("D", true), C("Bb"), C("D", true), C("A")];
/** The boss ostinato: the bass circles D with its chromatic neighbours, every bar the same. */
const BOSS_OSTINATO = seq("D2:1 D2:1 D3:1 D2:1 Eb2:1 D2:1 C#2:1 D2:1 D2:1 D2:1 D3:1 D2:1 F2:1 E2:1 Eb2:1 C#2:1");

for (const [name, q] of Object.entries({ THEME, BRIDGE, BOSS_THEME, BOSS_OSTINATO, CELL: seq(CELL), ANSWER: seq(ANSWER), CELL_UP: seq(CELL_UP), CADENCE: seq(CADENCE) })) whole(name, q);

// ---------- master ----------
function master(mix: Mix, loopTailS = 0): Float32Array[] {
  const { L, R } = mix;
  const loopN = Math.round((mix.seconds - loopTailS) * SR);
  // Seamless loop: what still rings after the last bar is added to the start, then the file ends at the loop point.
  if (loopTailS > 0) for (let i = loopN; i < L.length; i++) (L[i - loopN] += L[i]), (R[i - loopN] += R[i]);
  const n = loopTailS > 0 ? loopN : L.length;
  const out = [new Float32Array(n), new Float32Array(n)];
  let peak = 0;
  for (let i = 0; i < n; i++) {
    out[0][i] = Math.tanh(1.15 * L[i]);
    out[1][i] = Math.tanh(1.15 * R[i]);
    peak = Math.max(peak, Math.abs(out[0][i]), Math.abs(out[1][i]));
  }
  for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= 0.89 / (peak || 1);
  return out;
}
function wav([L, R]: Float32Array[]): Buffer {
  const n = L.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  return b;
}
async function save(name: string, ch: Float32Array[], lufs = -16) {
  const raw = join(outDir, `${name}.raw.wav`);
  await writeFile(raw, wav(ch));
  const norm = ["-af", `loudnorm=I=${lufs}:TP=-1.5:LRA=11`, "-ar", "48000"];
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, ...norm, "-c:a", "libmp3lame", "-b:a", "192k", join(outDir, `${name}.mp3`)]);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, ...norm, join(outDir, `${name}.wav`)]);
  await rm(raw);
}
const fadeTail = (mix: Mix, fromS: number, lenS: number) => {
  for (const ch of [mix.L, mix.R]) for (let i = Math.round(fromS * SR); i < ch.length; i++) ch[i] *= Math.max(0, 1 - (i / SR - fromS) / lenS);
};

// ---------- jingles ----------
/**
 * The KIVOXEL motif (start of every Short, intro/outro of long videos): the cell, a quick run, and a landing on the
 * low-mid D that bends up into place, over a fat D power chord. Lower and heavier than the first version.
 */
function motif(): Float32Array[] {
  const mix = new Mix(3.3);
  const q = seq(CELL.replace(/D6:2 -:2$/, "D6:1"), "C#6:1 D6:1 F#6:1");
  play(mix, "lead", 0, q, { vol: 0.32, gate: 0.7, accent: [3, 7, 12] });
  const hitS = 15 * S16;
  // The landing: D5 written (sounding D4), bending up from a minor third below, with vibrato as it holds.
  tone(mix, "lead", hitS, 1.0, midi("D5") + LEAD_SHIFT, { vol: 0.36, slide: -3, vibrato: true, release: 0.45 });
  tone(mix, "lead", hitS, 1.0, midi("A4") + LEAD_SHIFT, { vol: 0.16, slide: -3, release: 0.45 }); // power fifth under it
  for (const [m, pan] of [["D5", 0.35], ["F#5", -0.35]] as const) tone(mix, "pulse50", hitS, 1.0, midi(m), { vol: 0.06, pan, release: 0.45 });
  tone(mix, "tri", 0, 0.7, midi("D3"), { vol: 0.35, gate: 0.5 });
  tone(mix, "tri", 7 * S16, 0.3, midi("A2"), { vol: 0.35, gate: 0.6 });
  tone(mix, "tri", hitS, 1.0, midi("D2"), { vol: 0.6, release: 0.3, slide: -3 });
  drums(mix, 0, "K..b..B.K..sS.SX", 0.9);
  block(mix, hitS + 0.5, true, 0.6);
  fadeTail(mix, 2.6, 0.6);
  return master(mix);
}
/** Victory (a find or a win): the cell compressed into a fanfare, landing on a big D major chord. */
function victory(): Float32Array[] {
  const mix = new Mix(2.0);
  play(mix, "lead", 0, seq("A5:1 D6:1 -:1 F#6:2 E6:1 F#6:1 A6:9"), { vol: 0.3, vibrato: true });
  for (const m of ["D5", "F#5", "A5"]) tone(mix, "pulse50", 7 * S16, 0.9, midi(m), { vol: 0.08, pan: -0.3, release: 0.3 });
  tone(mix, "tri", 7 * S16, 0.9, midi("D2"), { vol: 0.55, release: 0.25 });
  drums(mix, 0, "K..S.SsX", 0.9);
  fadeTail(mix, 1.5, 0.5);
  return master(mix);
}
/** Oops (a fail or a death): the cell's turn falling away, ending on a low thud. */
function oops(): Float32Array[] {
  const mix = new Mix(1.9);
  play(mix, "lead", 0, seq("A5:1 G#5:1 -:1 G5:2 F#5:1 F5:1 E5:2 -:1 D4:6"), { vol: 0.28, gate: 0.6, slide: 2 });
  tone(mix, "tri", 9 * S16, 0.7, midi("D2"), { vol: 0.6, slide: 5 });
  kick(mix, 9 * S16, 1);
  block(mix, 3 * S16, false, 0.6);
  fadeTail(mix, 1.4, 0.5);
  return master(mix);
}

// ---------- the five "levels" (150 BPM, loop seamlessly) ----------
type Track = { file: string; title: string; energy: number; moods: string[]; bars: number; build: (mix: Mix) => void };
const each = (from: number, to: number, f: (bar: number, i: number) => void) => {
  for (let b = from; b < to; b++) f(b, b - from);
};

const TRACKS: Track[] = [
  {
    // Cave: sparse and low, lots of silence, the cell only as an echoing fragment. For searching, mining, waiting.
    file: "kivoxel-01-grot",
    title: "KIVOXEL 01 Grot (rustig, onder de grond)",
    energy: 1,
    moods: ["chill", "dark"],
    bars: 32,
    build(mix) {
      const riff = seq("D2:2 -:2 A2:1 -:1 C3:2 -:4 D3:1 -:1 A2:2");
      each(0, 32, (b, i) => {
        play(mix, "tri", b, riff, { vol: 0.5, gate: 0.6 });
        drums(mix, b, i < 4 ? "K..............." : i % 4 === 3 ? "K.....b...B...b." : "K.....b.....B...", 0.5);
      });
      for (const at of [4, 8, 16, 20, 24]) play(mix, "lead", at, seq("A4:1 D5:1 -:1 F5:2 -:11", "-:16"), { vol: 0.16, echo: 0.45, octave: 1 });
      for (const at of [12, 28]) play(mix, "lead", at, seq("A4:1 D5:1 -:1 F5:2 E5:1 F5:1 A5:5 -:4", "G5:2 F5:2 E5:4 D5:8"), { vol: 0.14, echo: 0.4, vibrato: true });
    },
  },
  {
    // Above ground: swing, short notes, a hopping bass and off-beat chords. The full KIVOXEL theme, then the bridge.
    file: "kivoxel-02-blokjesland",
    title: "KIVOXEL 02 Blokjesland (bovengronds, vrolijk)",
    energy: 2,
    moods: ["happy", "chill"],
    bars: 36,
    build(mix) {
      const SW = 0.3;
      each(0, 36, (b, i) => {
        const sec = i < 2 ? -1 : Math.floor((i - 2) / 4);
        const c = sec === 2 || sec === 6 ? PROG_B[(i - 2) % 4] : PROG_A[Math.max(0, i - 2) % 4];
        bass(mix, b, c, "bounce", 0.48, SW);
        stabs(mix, b, c, [2, 6, 10, 14], 0.045, SW);
        drums(mix, b, i === 2 || i === 18 ? "X..h.sh.K.hh.sh." : "K..h.sh.K.hh.sh.", 0.6, SW);
      });
      for (const [at, q, oct] of [[2, THEME, 0], [6, THEME, 0], [10, BRIDGE, 0], [14, THEME, 0], [18, THEME, 1], [22, THEME, 0], [26, BRIDGE, 0], [30, THEME, 1]] as const)
        play(mix, "lead", at, q, { vol: 0.21, gate: 0.5, swing: SW, octave: oct, accent: [3, 12] });
      // Turnaround: the cell's pickup, leading back to the start of the loop.
      play(mix, "pulse12", 34, seq("A4:1 D5:1 -:2 A4:1 D5:1 -:2 A4:1 D5:1 E5:1 F#5:1 A5:4", "-:16"), { vol: 0.14, gate: 0.5, swing: SW });
    },
  },
  {
    // The find: a 3+3+2 wood-block ostinato and bass, the theme up high with little slides. Happy and a bit cheeky.
    file: "kivoxel-03-diamantjacht",
    title: "KIVOXEL 03 Diamantjacht (vondst, grappig)",
    energy: 3,
    moods: ["happy", "funny"],
    bars: 32,
    build(mix) {
      each(0, 32, (b, i) => {
        const c = i >= 16 && i < 20 ? PROG_B[i % 4] : PROG_A[i % 4];
        bass(mix, b, c, "tresillo", 0.5);
        arp(mix, b, c, 2, 0.06, 0.4, 1);
        drums(mix, b, i % 8 === 0 ? "X..B..b.S.B..Bb." : i % 4 === 3 ? "K..B..b.S.B.SSSS" : "K..B..b.S.B..Bb.", 0.75);
      });
      for (const [at, q, oct] of [[0, THEME, 0], [4, THEME, 1], [8, THEME, 0], [12, THEME, 1], [16, BRIDGE, 0], [20, THEME, 1], [24, THEME, 0], [28, THEME, 1]] as const)
        play(mix, "lead", at, q, { vol: 0.2, gate: 0.6, octave: oct, slide: oct ? -2 : 0, accent: [3, 12] });
    },
  },
  {
    // The fight: straight and driving, kick on every beat, the theme loud with a harmony voice. Mobs, PvP, escapes.
    file: "kivoxel-04-gevecht",
    title: "KIVOXEL 04 Gevecht (actie, hype)",
    energy: 4,
    moods: ["hype", "epic"],
    bars: 40,
    build(mix) {
      each(0, 40, (b, i) => {
        const c = i >= 16 && i < 24 ? PROG_B[i % 4] : PROG_A[i % 4];
        bass(mix, b, c, "eighths", 0.5);
        arp(mix, b, c, 1, 0.065, 0.4);
        drums(mix, b, i % 8 === 0 ? "X.o.KSo.K.o.KSo." : i % 8 === 7 ? "K.o.KSoSK.SSSSSS" : "K.o.KSo.K.o.KSo.", 0.95);
        if (i % 8 === 6) riser(mix, b * BAR * S16, 2 * BAR * S16, 0.6);
      });
      for (const [at, q, oct] of [[0, THEME, 0], [4, THEME, 0], [8, THEME, 1], [12, THEME, 1], [16, BRIDGE, 0], [20, BRIDGE, 1], [24, THEME, 0], [28, THEME, 1], [32, THEME, 1], [36, THEME, 0]] as const) {
        play(mix, "lead", at, q, { vol: 0.23, gate: 0.75, octave: oct, vibrato: true, accent: [3, 12] });
        if (oct) play(mix, "pulse12", at, q, { vol: 0.07, gate: 0.75, pan: 0.4, octave: 1 }); // the same line an octave higher, as a sparkle
      }
    },
  },
  {
    // The end boss: D minor, the chromatic ostinato in the bass, wood blocks, a tritone in the theme. Maximum tension.
    file: "kivoxel-05-eindbaas",
    title: "KIVOXEL 05 Eindbaas (maximaal, spannend)",
    energy: 5,
    moods: ["tense", "epic", "hype", "dark"],
    bars: 40,
    build(mix) {
      each(0, 40, (b, i) => {
        play(mix, "tri", b, BOSS_OSTINATO, { vol: 0.55, gate: 0.7 });
        const c = PROG_BOSS[i % 4];
        if (i >= 4) stabs(mix, b, c, [0, 3, 6, 10, 12], 0.05);
        drums(mix, b, i < 4 ? "K..b..b.K..b.bBb" : i % 8 === 7 ? "KSSKSSKSSSSSSSSS" : i % 8 === 4 ? "X.bKS.bKK.bKS.bS" : "K.bKS.bKK.bKS.bS", i < 4 ? 0.7 : 1);
        if (i % 8 === 6) riser(mix, b * BAR * S16, 2 * BAR * S16, 1);
      });
      for (const [at, oct] of [[4, 0], [8, 0], [12, 1], [16, 1], [24, 0], [28, 1], [32, 1], [36, 1]] as const) {
        play(mix, "lead", at, BOSS_THEME, { vol: 0.23, gate: 0.75, octave: oct, vibrato: true, accent: [3, 12] });
        if (at >= 28) play(mix, "pulse12", at, BOSS_THEME, { vol: 0.07, gate: 0.75, pan: 0.4, octave: oct });
      }
      // Bars 20-23: the boss is hit — the major KIVOXEL cell breaks through for a moment, then the minor returns.
      play(mix, "lead", 20, seq(CELL, CELL_UP, "D6:1 E6:1 F#6:1 A6:5 -:8", "-:16"), { vol: 0.24, gate: 0.7, octave: 0, vibrato: true });
    },
  },
];

/**
 * The SpawnNado motif (18-11-2026): its own tune, not a variation of the KIVOXEL cell. A "tornado" run that spins up in
 * E minor (fast rising sixteenths, twice), a riser of noise, and a hard landing on a big E power chord.
 *   node scripts/kivoxel-make-music.ts --spawnnado   (renders only this one and puts it in the jingles folder)
 */
function spawnnadoMotif(): Float32Array[] {
  const mix = new Mix(3.0);
  play(mix, "lead", 0, seq("E5:1 G5:1 B5:1 E6:1 D6:1 B5:1 G5:1 B5:1 E6:1 G6:1 B6:1 A6:1 G6:1 F#6:1 -:2"), { vol: 0.3, gate: 0.6, accent: [0, 4, 8, 12] });
  const hitS = 16 * S16;
  for (const m of ["E5", "B5"]) tone(mix, "lead", hitS, 0.9, midi(m) + LEAD_SHIFT, { vol: m === "E5" ? 0.36 : 0.16, slide: 2, vibrato: true, release: 0.45 });
  for (const [m, pan] of [["E5", 0.35], ["G5", -0.35]] as const) tone(mix, "pulse50", hitS, 0.9, midi(m), { vol: 0.06, pan, release: 0.45 });
  tone(mix, "tri", 0, 0.8, midi("E3"), { vol: 0.35, gate: 0.5 });
  tone(mix, "tri", 8 * S16, 0.8, midi("G2"), { vol: 0.35, gate: 0.5 });
  tone(mix, "tri", hitS, 0.9, midi("E2"), { vol: 0.6, release: 0.3, slide: 2 });
  drums(mix, 0, "K.s.K.s.K.sSsSsX", 0.9);
  fadeTail(mix, 2.4, 0.6);
  return master(mix);
}
if (process.argv.includes("--spawnnado")) {
  const ch = spawnnadoMotif();
  await mkdir(outDir, { recursive: true });
  await save("spawnnado-motief", ch, -14);
  const jingles = join(dataDir, "kivoxel-media", "jingles");
  await mkdir(jingles, { recursive: true });
  await writeFile(join(jingles, "spawnnado-motief.wav"), await readFile(join(outDir, "spawnnado-motief.wav")));
  console.log(`SpawnNado motief: ${join(jingles, "spawnnado-motief.wav")} (${(ch[0].length / SR).toFixed(1)} s)`);
  process.exit(0);
}

// ---------- render ----------
type Made = { file: string; title: string; seconds: number; kind: "jingle" | "track"; energy?: number; moods?: string[] };
const made: Made[] = [];
const silence = (s: number) => [new Float32Array(Math.round(SR * s)), new Float32Array(Math.round(SR * s))];
const demo: Float32Array[][] = [];
for (const [name, title, ch] of [["kivoxel-motief", "KIVOXEL motief (start)", motif()], ["kivoxel-jingle-overwinning", "KIVOXEL jingle overwinning", victory()], ["kivoxel-jingle-oei", "KIVOXEL jingle oei", oops()]] as const) {
  await save(name, ch, -14);
  made.push({ file: `${name}.mp3`, title, seconds: ch[0].length / SR, kind: "jingle" });
  demo.push(ch, silence(0.6));
}
for (const t of TRACKS) {
  const mix = new Mix(t.bars * BAR * S16 + 2);
  t.build(mix);
  const ch = master(mix, 2);
  await save(t.file, ch);
  made.push({ file: `${t.file}.mp3`, title: t.title, seconds: ch[0].length / SR, kind: "track", energy: t.energy, moods: t.moods });
  // Demo: 8 bars from bar 4 (12.8 s), short fades.
  const from = Math.round(4 * BAR * S16 * SR);
  const len = Math.round(8 * BAR * S16 * SR);
  const part = ch.map((c) => c.slice(from, from + len));
  const fade = SR * 0.05;
  for (const c of part) for (let i = 0; i < fade; i++) (c[i] *= i / fade), (c[len - 1 - i] *= i / fade);
  demo.push(part, silence(0.5));
}
const total = demo.reduce((s, p) => s + p[0].length, 0);
const all = [new Float32Array(total), new Float32Array(total)];
let pos = 0;
for (const p of demo) (all[0].set(p[0], pos), all[1].set(p[1], pos), (pos += p[0].length));
await save("kivoxel-demo-alles", all);
await writeFile(
  join(outDir, "overzicht.json"),
  JSON.stringify({ $comment: "Eigen werk (KIVOXEL), gecomponeerd en gesynthetiseerd met scripts/kivoxel-make-music.ts (versie 2). Geen samples, geen AI-dienst: alle rechten bij KIVOXEL.", bpm: BPM, made }, null, 2) + "\n",
);
for (const x of made) console.log(`${x.file.padEnd(38)} ${x.seconds.toFixed(1).padStart(5)} s  ${x.kind === "track" ? `energie ${x.energy}  ${x.moods!.join("/")}` : "jingle"}`);
console.log(`Klaar: ${outDir}`);

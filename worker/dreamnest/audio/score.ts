// Dreamnest fase 4: the full soundtrack of a long episode, built from the fase 3 generator. Free, on this pc.
// Story and falling asleep as songs; the sleep part in 6-minute pieces with changing chords; the outro fades the music
// out and leaves only soft noise (never silence). Every piece is mastered to its own loudness target.
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TARGETS, TRUE_PEAK_MAX } from "../../../lib/dreamnest/audioqc.ts";
import { rng, type NoteEvent } from "../../../lib/dreamnest/music.ts";
import { planCues, renderCues } from "../../../lib/dreamnest/setlist.ts";
import { brownNoise, fade, fireplace, mix, rain, renderEvents, SR, stereo, wav, type Stereo } from "./synth.ts";

type Song = { events: NoteEvent[]; lengthS: number };

export function sequence(parts: Song[], gapS = 3): Song {
  const events: NoteEvent[] = [];
  let t = 0;
  for (const p of parts) {
    for (const e of p.events) events.push({ ...e, t: e.t + t });
    t += p.lengthS + gapS;
  }
  return { events, lengthS: t };
}

/** Repeat songs until the part is full; notes that would sound past the end are left out. */
function fill(make: (k: number) => Song, lengthS: number): Song {
  const parts: Song[] = [];
  let t = 0;
  for (let k = 0; t < lengthS; k++) {
    const s = make(k);
    parts.push(s);
    t += s.lengthS + 3;
  }
  const all = sequence(parts);
  return { events: all.events.filter((e) => e.t < lengthS - 4), lengthS };
}

export function sleepMusic(seconds: number, s: number): Song {
  const r = rng(s);
  const progressions = [[[48, 52, 55], [45, 48, 52], [41, 45, 48], [48, 52, 55]], [[41, 45, 48], [48, 52, 55], [43, 47, 50], [48, 52, 55]], [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]]];
  const prog = progressions[Math.floor(r() * progressions.length)];
  const events: NoteEvent[] = [];
  for (let t = 0, k = 0; t < seconds; t += 14, k++) for (const p of prog[k % prog.length]) events.push({ t, dur: 15, midi: p, instrument: "pad", vel: 0.22 });
  const notes = [72, 74, 76, 79, 81];
  for (let t = 4; t < seconds - 4; t += 7 + r() * 7) events.push({ t, dur: 2, midi: notes[Math.floor(r() * notes.length)], instrument: r() < 0.7 ? "musicbox" : "celesta", vel: 0.42 });
  return { events, lengthS: seconds };
}

function room(seconds: number, amb: number, s: number): Stereo {
  const r = stereo(seconds);
  mix(r, brownNoise(seconds, 0.25, s), amb);
  mix(r, fireplace(seconds, 0.35, s + 1), amb);
  mix(r, rain(seconds, 0.3, s + 2), amb);
  return r;
}

export type ScorePiece = { id: string; part: keyof typeof TARGETS | "outro"; lengthS: number; seed: number };

/** The pieces of a soundtrack of totalS seconds; consecutive pieces overlap by xfadeS (cross-fade). */
export function planScore(totalS: number, seed: number, xfadeS = 10): ScorePiece[] {
  const pieces: ScorePiece[] = [{ id: "a-story", part: "story", lengthS: 360 + xfadeS, seed }, { id: "b-asleep", part: "falling_asleep", lengthS: 360 + xfadeS, seed: seed + 100 }];
  let t = 720;
  const outro = 120;
  for (let k = 0; t < totalS - outro; k++) {
    const len = Math.min(360, totalS - outro - t);
    pieces.push({ id: `c-sleep-${String(k).padStart(2, "0")}`, part: "sleep", lengthS: len + xfadeS, seed: seed + 200 + k });
    t += len;
  }
  pieces.push({ id: "d-outro", part: "outro", lengthS: outro, seed: seed + 900 });
  return pieces;
}

export async function renderScorePiece(ffmpeg: string, dir: string, irFile: string, p: ScorePiece): Promise<string> {
  const len = p.lengthS;
  let music: Song;
  let musicGain = 1, amb = 0.25;
  // Fase 6: a setlist per part (lib/dreamnest/setlist.ts): every song once per episode, changing instrument, style
  // and key; the sleep part is a row of new, slow songs with quiet space between them instead of loose notes.
  if (p.part === "story") {
    music = renderCues(planCues("story", len, p.seed), len, p.seed);
  } else if (p.part === "falling_asleep") {
    music = renderCues(planCues("falling_asleep", len, p.seed), len, p.seed);
    musicGain = 0.8;
    amb = 0.5;
  } else if (p.part === "sleep") {
    music = renderCues(planCues("sleep", len, p.seed), len, p.seed);
    musicGain = 0.75;
    amb = 0.55;
  } else {
    music = sleepMusic(len, p.seed);
    musicGain = 0.8;
    amb = 0.6;
  }
  const out = mix(room(len, amb, p.seed + 30), renderEvents(music.events, len, p.seed), musicGain);
  if (p.part === "outro") {
    // Music and room sounds fade out over the outro; a very soft brown noise stays, so it never goes silent.
    for (let i = 0; i < out.l.length; i++) {
      const g = Math.max(0, 1 - i / out.l.length);
      out.l[i] *= g;
      out.r[i] *= g;
    }
    mix(out, brownNoise(len, 0.25, p.seed + 7), 0.35);
  }
  fade(out, 0.5, p.part === "outro" ? 8 : 0.5);
  const raw = join(dir, `${p.id}.raw.wav`);
  await writeFile(raw, wav(out));
  const target = p.part === "outro" ? TARGETS.sleep : TARGETS[p.part];
  const chain = `[0:a][1:a]afir=dry=7:wet=3[rv];[rv]lowpass=f=7000,highpass=f=40`;
  // The outro is measured on its first 30 s (before the fade), so the fixed gain keeps the fade instead of undoing it.
  const measure = p.part === "outro" ? ",atrim=0:30" : "";
  const m1 = await run(ffmpeg, ["-hide_banner", "-i", raw, "-i", irFile, "-filter_complex", `${chain}${measure},loudnorm=I=${target}:TP=${TRUE_PEAK_MAX - 0.5}:LRA=5:print_format=json`, "-f", "null", "-"]);
  const j = JSON.parse(m1.slice(m1.lastIndexOf("{"), m1.lastIndexOf("}") + 1)) as Record<string, string>;
  const done = join(dir, `${p.id}.wav`);
  const norm = `loudnorm=I=${target}:TP=${TRUE_PEAK_MAX - 0.5}:LRA=5:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  await run(ffmpeg, ["-y", "-v", "error", "-i", raw, "-i", irFile, "-filter_complex", `${chain},${norm},alimiter=limit=0.6:level=false,aresample=48000`, "-ar", "48000", done]);
  return done;
}

export async function makeIr(file: string) {
  const ir = stereo(2.5);
  const r = rng(99);
  let a = 0, b = 0;
  for (let i = 0; i < ir.l.length; i++) {
    a += 0.2 * (r() * 2 - 1 - a);
    b += 0.2 * (r() * 2 - 1 - b);
    const env = Math.exp(-i / (0.6 * SR));
    ir.l[i] = a * env;
    ir.r[i] = b * env;
  }
  await writeFile(file, wav(ir));
}

export const run = (ffmpeg: string, args: string[]) =>
  new Promise<string>((ok, no) => execFile(ffmpeg, args, { maxBuffer: 512 * 1024 * 1024, windowsHide: true }, (e, so, se) => (e ? no(new Error(String(se).slice(-600))) : ok(`${so}\n${se}`))));

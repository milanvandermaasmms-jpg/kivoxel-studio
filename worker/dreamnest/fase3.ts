// Dreamnest fase 3: own lullaby music + room ambience, mastered per part, with the audio QC. Costs nothing.
// Run: node worker/dreamnest/fase3.ts [--seed n]
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase3/ (per part a mastered WAV, the test audio m4a and qc.json).
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { judgeAudio, parseEbur128, parseSilences, TARGETS, TRUE_PEAK_MAX } from "../../lib/dreamnest/audioqc.ts";
import { arrange, composeLullaby, MELODIES, rng, type NoteEvent } from "../../lib/dreamnest/music.ts";
import { findTool } from "../ffmpeg.ts";
import { brownNoise, fade, fireplace, mix, rain, renderEvents, SR, stereo, wav, type Stereo } from "./audio/synth.ts";

const root = resolve(import.meta.dirname, "../..");
const env: Record<string, string | undefined> = { ...process.env };
const envFile = env.DREAMNEST_ENV_FILE || join(root, "worker", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const seedArg = process.argv.indexOf("--seed");
const seed = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 11;
const out = join(env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube"), "dreamnest", "fase3");
const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);
const run = (args: string[]) => new Promise<string>((ok, no) => execFile(ffmpeg, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (e, so, se) => (e ? no(new Error(String(se).slice(-600))) : ok(`${so}\n${se}`))));

/** Put songs one after another, with a few seconds of breathing room between them. */
function sequence(parts: { events: NoteEvent[]; lengthS: number }[], gapS = 3) {
  const events: NoteEvent[] = [];
  let t = 0;
  for (const p of parts) {
    for (const e of p.events) events.push({ ...e, t: e.t + t });
    t += p.lengthS + gapS;
  }
  return { events, lengthS: t };
}

function room(seconds: number, amb: number, s: number): Stereo {
  const r = stereo(seconds);
  mix(r, brownNoise(seconds, 0.25, s), amb);
  mix(r, fireplace(seconds, 0.35, s + 1), amb);
  mix(r, rain(seconds, 0.3, s + 2), amb);
  return r;
}

/** Sleep part: no beat; slow pad chords and now and then one soft music-box note. */
function sleepMusic(seconds: number, s: number) {
  const r = rng(s);
  const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const events: NoteEvent[] = [];
  for (let t = 0, k = 0; t < seconds; t += 14, k++) for (const p of chords[[0, 1, 2, 0, 3, 0][k % 6]]) events.push({ t, dur: 15, midi: p, instrument: "pad", vel: 0.22 });
  for (let t = 4; t < seconds - 4; t += 6 + r() * 6) events.push({ t, dur: 2, midi: [72, 74, 76, 79, 81][Math.floor(r() * 5)], instrument: "musicbox", vel: 0.45 });
  return { events, lengthS: seconds };
}

const sections = [
  {
    id: "story" as const,
    title: "Welkom en verhaaltje",
    music: sequence([
      arrange(MELODIES[0], 66, { seed }),
      arrange(MELODIES[1], 69, { lead: "celesta", seed: seed + 1 }),
      arrange(composeLullaby(seed), 66, { seed: seed + 2 }),
      arrange(MELODIES[0], 64, { lead: "celesta", thin: 0.15, seed: seed + 3 }),
    ]),
    musicGain: 1,
    amb: 0.25,
  },
  {
    id: "falling_asleep" as const,
    title: "Inslapen",
    music: sequence([0.2, 0.4, 0.55, 0.7, 0.85].map((thin, k) => arrange(composeLullaby(seed + 100), 60 - k, { thin, lead: "celesta", seed: seed + 10 + k })), 2),
    musicGain: 0.8,
    amb: 0.5,
  },
  { id: "sleep" as const, title: "Slaaplus (begin)", music: sleepMusic(90, seed + 20), musicGain: 0.8, amb: 0.6 },
];

await mkdir(out, { recursive: true });
// Reverb: a soft, dark room made of decaying filtered noise (our own impulse response).
const ir = stereo(2.5);
{
  const r = rng(99);
  let a = 0, b = 0;
  for (let i = 0; i < ir.l.length; i++) {
    a += 0.2 * (r() * 2 - 1 - a);
    b += 0.2 * (r() * 2 - 1 - b);
    const env = Math.exp(-i / (0.6 * SR));
    ir.l[i] = a * env;
    ir.r[i] = b * env;
  }
}
await writeFile(join(out, "ir.wav"), wav(ir));

const report: Record<string, unknown>[] = [];
for (const s of sections) {
  const len = s.music.lengthS + 6;
  log(`${s.title}: ${Math.round(len)} s maken...`);
  const mixd = mix(room(len, s.amb, seed + 30), renderEvents(s.music.events, len, seed), s.musicGain);
  fade(mixd, 3, 6);
  const raw = join(out, `${s.id}.raw.wav`);
  await writeFile(raw, wav(mixd));
  const target = TARGETS[s.id];
  const chain = `[0:a][1:a]afir=dry=7:wet=3[rv];[rv]lowpass=f=7000,highpass=f=40`;
  // Two-pass loudness normalisation: measure first, then set exactly (linear, so no pumping).
  const m1 = await run(["-hide_banner", "-i", raw, "-i", join(out, "ir.wav"), "-filter_complex", `${chain},loudnorm=I=${target}:TP=${TRUE_PEAK_MAX - 0.5}:LRA=5:print_format=json`, "-f", "null", "-"]);
  const j = JSON.parse(m1.slice(m1.lastIndexOf("{"), m1.lastIndexOf("}") + 1)) as Record<string, string>;
  const mastered = join(out, `${s.id}.wav`);
  await run(["-y", "-v", "error", "-i", raw, "-i", join(out, "ir.wav"), "-filter_complex", `${chain},loudnorm=I=${target}:TP=${TRUE_PEAK_MAX - 0.5}:LRA=5:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.6:level=false,aresample=48000`, "-ar", "48000", mastered]);
  const qcText = await run(["-hide_banner", "-i", mastered, "-af", "ebur128=peak=true:framelog=verbose,silencedetect=noise=-60dB:d=2", "-f", "null", "-"]);
  const e = parseEbur128(qcText);
  const verdict = judgeAudio({ integrated: e.integrated ?? -99, truePeak: e.truePeak ?? 0, silences: parseSilences(qcText), shortTerm: e.shortTerm }, target);
  log(`${s.title}: ${e.integrated} LUFS, piek ${e.truePeak} dBTP → ${verdict.ok ? "✅" : `❌ ${verdict.problems.join("; ")}`}`);
  report.push({ part: s.id, title: s.title, seconds: Math.round(len), target_lufs: target, integrated: e.integrated, true_peak: e.truePeak, ...verdict });
}

// Test audio: the three parts after each other with 10 s cross-fades.
const parts = sections.map((s) => join(out, `${s.id}.wav`));
await run(["-y", "-v", "error", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", "[0:a][1:a]acrossfade=d=10:c1=qsin:c2=qsin[a];[a][2:a]acrossfade=d=10:c1=qsin:c2=qsin[b]", "-map", "[b]", "-c:a", "aac", "-b:a", "192k", join(out, "dreamnest-fase3-test.m4a")]);
await writeFile(join(out, "qc.json"), JSON.stringify({ seed, made_at: new Date().toISOString(), melodies: [...MELODIES.map((m) => ({ title: m.title, source: m.source })), { title: composeLullaby(seed).title, source: composeLullaby(seed).source }, { title: composeLullaby(seed + 100).title, source: composeLullaby(seed + 100).source }], parts: report }, null, 1));
log(`Klaar: ${join(out, "dreamnest-fase3-test.m4a")}`);

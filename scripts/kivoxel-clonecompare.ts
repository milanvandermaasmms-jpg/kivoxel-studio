// KIVOXEL: compare ways to give the narrator the kid's voice WITHOUT his accent (Milan, 16-11-2026: "laat hem
// Amerikaans klinken"). Same English lines per variant; measures how well Whisper understands them (clear American
// pronunciation) and the pitch (still the kid's voice colour). One variant per run, so only one model is in memory:
//   node scripts/kivoxel-clonecompare.ts <variant>     variants: tts-cfg0 | vc-google-puck | vc-google-fenrir | vc-kokoro
// Output: testrenders/kloon-vergelijk/<variant>.wav (all lines after each other) + <variant>.json.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { heardMatch } from "../lib/kivoxel/captions.ts";
import { audioDurationMs, findTool, runFfmpeg, tightenArgs } from "../worker/ffmpeg.ts";
import { createAligner } from "../worker/kidsSpeech.ts";
import { chatterboxTts, findClone, kokoroTts } from "../worker/localTts.ts";
import { createTts } from "../worker/tts.ts";

const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const variant = process.argv[2] ?? "vc-google-puck";
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
const clone = findClone(dataDir, join(import.meta.dirname, "..", "worker", "chatterbox_server.py"))!;
const google = process.env.GOOGLE_TTS_API_KEY ? createTts(process.env.GOOGLE_TTS_API_KEY) : null;
const googleVoice = (name: string) => ({ speak: (t: string, o: { voiceName: string; speakingRate: number; style?: string }) => google!.speak(t, { ...o, voiceName: name }), ext: "mp3", name: `Google ${name.split("-").pop()}` });
const kokoro = variant === "vc-kokoro" ? await kokoroTts("am_puck", join(dataDir, "kivoxel-tts", "kokoro-cache")) : null;
const tts =
  variant === "tts-cfg0" ? chatterboxTts(clone, 0.1, { mode: "tts", cfgWeight: 0 })
  : variant === "vc-google-fenrir" ? chatterboxTts(clone, 0, { source: googleVoice("en-US-Chirp3-HD-Fenrir") })
  : variant === "vc-kokoro" ? chatterboxTts(clone, 0, { source: { speak: (t, o) => kokoro!.speak(t, o), ext: "wav", name: "Kokoro puck" } })
  : chatterboxTts(clone, 0, { source: googleVoice("en-US-Chirp3-HD-Puck") });

const lines: [string, string][] = [["Bro. BRO. Don't do it!", "schreeuw"], ["Watch his hearts. SERIOUSLY.", "spannend"], ["Okay okay okay… one wrong step and this goes VERY wrong.", "spannend"], ["He's walking STRAIGHT into it…", "spannend"], ["NO WAY! He actually survived that!", "schreeuw"]];
const out = resolve("testrenders", "kloon-vergelijk");
await mkdir(out, { recursive: true });
const align = createAligner(ffmpeg, dataDir);
const files: string[] = [];
const report: { line: string; match: number; heard: string; ms: number }[] = [];
const t0 = Date.now();
for (const [i, [text, style]] of lines.entries()) {
  const raw = `${variant}-${i}.wav`;
  await writeFile(join(out, raw), await tts.speak(text, { voiceName: "en-US-Chirp3-HD-Puck", speakingRate: 1.1, style }));
  const tight = `${variant}-${i}-strak.wav`;
  await runFfmpeg(ffmpeg, tightenArgs(raw, tight), out, 60_000);
  const heard = (await align(join(out, tight), out)) ?? [];
  report.push({ line: text, match: Math.round(heardMatch(text, heard) * 100) / 100, heard: heard.map((w) => w.text).join(" "), ms: await audioDurationMs(ffprobe, join(out, tight)) });
  files.push(tight);
}
const graph = files.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur=0.4[a${i}]`).join(";") + ";" + files.map((_, i) => `[a${i}]`).join("") + `concat=n=${files.length}:v=0:a=1[o]`;
await runFfmpeg(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", graph, "-map", "[o]", `${variant}.wav`], out, 120_000);
const avg = report.reduce((s, r) => s + r.match, 0) / report.length;
await writeFile(join(out, `${variant}.json`), JSON.stringify({ variant, name: tts.name, seconds: Math.round((Date.now() - t0) / 1000), avgMatch: Math.round(avg * 100) / 100, report }, null, 1));
console.log(`${variant} (${tts.name}): verstaanbaar ${Math.round(avg * 100)}%, ${Math.round((Date.now() - t0) / 1000)} s`);
for (const r of report) console.log(`   ${Math.round(r.match * 100)}%  "${r.line}"  →  "${r.heard}"`);
void readFile;
process.exit(0);

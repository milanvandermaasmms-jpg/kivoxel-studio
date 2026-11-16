// KIVOXEL fase 1, sections 2 and 8: voice comparison. The SAME Short with the SAME lines, once per voice:
// Google (Chirp 3 HD, cloud, free tier), Piper (local), Kokoro (local), Windows (local, last resort).
//   node scripts/kivoxel-voicecompare.ts <recording> [event rank]
// Output: testrenders/stemmen/<voice>.mp4 + stemmen.wav (all voices after each other) + rapport.txt. ENGLISH only.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveSettings } from "../lib/kivoxel/config.ts";
import { planShort } from "../lib/kivoxel/shortPlan.ts";
import { freeScript, gateSummary, seeded, topPayoffsFor } from "./voicecompare-helpers.ts";
import { captionEvents, captionStyleLine, timedFromSpoken } from "../lib/kivoxel/captions.ts";
import { buildAss, renderArgs } from "../lib/youtube/render.ts";
import { createEventStore } from "../worker/eventTimeline.ts";
import { audioDurationMs, findTool, runFfmpeg } from "../worker/ffmpeg.ts";
import { chatterboxTts, findClone, findPiper, kokoroTts, piperTts, windowsTts, type LocalTts } from "../worker/localTts.ts";
import { createTts, createUsageCounter } from "../worker/tts.ts";
import { speakWithGate } from "../worker/voiceGate.ts";

const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [query, rankArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
type Rec = { fingerprint: string; label: string; file: string; probe: { durationMs: number; audioCodec: string | null; fps: number | null } };
const rec = (JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[]).find((r) => r.fingerprint.startsWith(query ?? "7bf772f3"))!;
const settings = resolveSettings(null);
const timeline = await createEventStore(ffmpeg, dataDir).timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
const event = topPayoffsFor(timeline)[Math.max(0, Number(rankArg ?? 1) - 1)];
const plan = planShort(event, timeline, settings, seeded("voices"), "loop");
const script = freeScript({ segments: plan.segments, targetMs: plan.targetMs, timeline, settings, seed: "voices", short: true });
const out = resolve("testrenders", "stemmen");
await mkdir(out, { recursive: true });
const size = { width: 1080, height: 1920 };

type Voice = { key: string; label: string; tts: Parameters<typeof speakWithGate>[0]["tts"]; reserve: (n: number) => Promise<unknown> };
const voices: Voice[] = [];
if (process.env.GOOGLE_TTS_API_KEY) {
  const usage = createUsageCounter(join(dataDir, "tts-usage.json"));
  voices.push({ key: "1-google", label: "Google Chirp 3 HD Fenrir (cloud, gratis deel)", tts: createTts(process.env.GOOGLE_TTS_API_KEY), reserve: (n) => usage.reserve(n) });
}
const piper = findPiper(dataDir);
if (piper) voices.push({ key: "2-piper", label: `${piperTts(piper.exe, piper.model).name} (lokaal)`, tts: piperTts(piper.exe, piper.model), reserve: async () => undefined });
for (const v of ["am_michael", "am_puck"]) {
  const k = await kokoroTts(v, join(dataDir, "kivoxel-tts", "kokoro-cache"));
  if (k) voices.push({ key: `3-kokoro-${v}`, label: `${k.name} (lokaal)`, tts: k, reserve: async () => undefined });
}
const clone = findClone(dataDir, join(import.meta.dirname, "..", "worker", "chatterbox_server.py"));
if (clone) voices.unshift({ key: "0-stemkloon", label: "Chatterbox stemkloon (lokaal, klank van de referentie)", tts: chatterboxTts(clone), reserve: async () => undefined });
if (process.argv.includes("--alleen-kloon")) voices.splice(1);
const win: LocalTts = windowsTts();
if (!process.argv.includes("--alleen-kloon")) voices.push({ key: "4-windows", label: `${win.name} (lokaal, laatste vangnet)`, tts: win, reserve: async () => undefined });

const report: string[] = [`Zelfde Short (${rec.label}: ${event.description}, ${(plan.targetMs / 1000).toFixed(1)} s), zelfde zinnen, per stem:`, ...script.lines.map((l) => `   [${l.kind}] ${l.text}`), ""];
const samples: string[] = [];
for (const v of voices) {
  const t0 = Date.now();
  try {
    const g = await speakWithGate({ lines: script.lines, segments: plan.segments, timeline, targetMs: plan.targetMs, settings, tts: v.tts, voiceName: "en-US-Chirp3-HD-Fenrir", baseRate: 1.1, tmp: out, reserve: v.reserve, duration: (f) => audioDurationMs(ffprobe, f), run: (a, cwd, t) => runFfmpeg(ffmpeg, a, cwd, t) });
    const speakS = ((Date.now() - t0) / 1000).toFixed(1);
    // Keep this voice's files: the next voice reuses the names vo0, vo1, …
    const clips = [];
    for (const [i, c] of g.clips.entries()) {
      const own = `${v.key}-${i}${c.file.slice(c.file.lastIndexOf("."))}`;
      await runFfmpeg(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", c.file, "-ar", "48000", own], out, 60_000);
      clips.push({ file: own, atMs: c.atMs });
    }
    samples.push(...clips.map((c) => c.file));
    const ass = `${v.key}.ass`;
    await writeFile(join(out, ass), buildAss({ size, topLine: null, lines: g.spoken, durationMs: plan.targetMs, words: { style: captionStyleLine(size, settings), events: captionEvents(timedFromSpoken(g.spoken, plan.targetMs), "highlight", size, settings, plan.targetMs) } }), "utf8");
    const r = renderArgs({ recording: join(dataDir, "recordings", rec.file), recordingMs: rec.probe.durationMs, hasAudio: true, segments: plan.segments, size, assFile: ass, voice: clips, gameVolume: 0.3, output: join(out, `${v.key}.mp4`) });
    await runFfmpeg(ffmpeg, r.args, out, 10 * 60_000);
    report.push(`${v.key}.mp4 — ${v.label}`, `   ${gateSummary(g.result.gate, g.result.attempts, g.result.dropped)}; maken van de stem: ${speakS} s`);
  } catch (e) {
    report.push(`${v.key} — ${v.label}: MISLUKT (${e instanceof Error ? e.message.slice(0, 200) : String(e)})`);
  }
}
// All voices after each other in one sound file, with a short pause between them.
if (samples.length) {
  const inputs = samples.flatMap((s) => ["-i", s]);
  const graph = samples.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur=0.35[a${i}]`).join(";") + ";" + samples.map((_, i) => `[a${i}]`).join("") + `concat=n=${samples.length}:v=0:a=1[o]`;
  await runFfmpeg(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[o]", "stemmen.wav"], out, 120_000);
}
await writeFile(join(out, "rapport.txt"), report.join("\n"), "utf8");
console.log(report.join("\n"));
process.exit(0); // the voice-clone process would keep Node alive

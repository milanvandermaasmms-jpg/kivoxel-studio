// KIVOXEL fase 1: a test Short from a real recording, through the new chain, without Supabase.
//   node scripts/kivoxel-testshort.ts <recording> [event rank 1-5] [--zonder-stem]
// Video content is ENGLISH, always (voice, lines, captions).
// Event Timeline -> free anticipation script -> Google TTS per line (free tier, counted in tts-usage.json)
// -> sync gate -> FFmpeg montage. Also renders the same lines WITHOUT the gate (each line at its first estimate),
// so the difference is visible and audible. Output: testrenders/testshort-<name>/ with a report (rapport.txt).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveSettings } from "../lib/kivoxel/config.ts";
import { topPayoffs } from "../lib/kivoxel/events.ts";
import { estimateMs, freeScript, gateSummary, type VoLine } from "../lib/kivoxel/voiceScript.ts";
import type { Segment } from "../lib/youtube/analysis.ts";
import { buildAss, renderArgs, type VoiceClip } from "../lib/youtube/render.ts";
import { audioDurationMs, findTool, runFfmpeg } from "../worker/ffmpeg.ts";
import { createEventStore } from "../worker/eventTimeline.ts";
import { createTts, createUsageCounter } from "../worker/tts.ts";
import { speakWithGate } from "../worker/voiceGate.ts";
import { createPhraseLog } from "../worker/phraseLog.ts";

// worker/.env.local, read the same way the worker does; nothing is printed.
const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const args = process.argv.slice(2);
const [query, rankArg] = args.filter((a) => !a.startsWith("--"));
if (!query) throw new Error("Gebruik: node scripts/kivoxel-testshort.ts <opname> [event 1-5] [--zonder-stem]");
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg", process.env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", process.env.FFPROBE_PATH);
type Rec = { fingerprint: string; label: string; file: string; probe: { durationMs: number; audioCodec: string | null } | null };
const recs = JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[];
const rec = recs.find((r) => r.fingerprint.startsWith(query)) ?? recs.find((r) => r.label.toLowerCase().includes(query.toLowerCase()));
if (!rec?.probe) throw new Error(`Geen opname gevonden voor "${query}"`);

const settings = resolveSettings(null);
const timeline = await createEventStore(ffmpeg, dataDir).timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
const event = topPayoffs(timeline, 5, 0)[Math.max(0, Number(rankArg ?? 1) - 1)];
if (!event) throw new Error("Geen events in deze opname");

// The Short: from 12 s before the peak to 2.5 s after it (enough build-up for an anticipation line, ends on the payoff).
const start = Math.max(0, event.t_peak - 12_000);
const end = Math.min(rec.probe.durationMs, event.t_peak + 2500);
const segments: Segment[] = [{ part: "build", src_start_ms: start, src_end_ms: end, out_start_ms: 0, speed: 1, effects: [], note: event.description }];
const targetMs = end - start;
// Test runs keep their own phrase memory (not the worker's), so successive test Shorts rotate their words too.
const phrases = createPhraseLog(resolve("testrenders", "phrases.json"));
const script = freeScript({ segments, targetMs, timeline, recent: await phrases.recent(), settings, seed: `${rec.fingerprint}:${event.id}`, short: true });

await phrases.add(script.used);
const slug = `${rec.label}-e${rankArg ?? 1}`.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
const out = resolve("testrenders", `testshort-${slug}`);
await mkdir(out, { recursive: true });
const recording = join(dataDir, "recordings", rec.file);
const size = { width: settings.shorts.width, height: settings.shorts.height };
const report: string[] = [`Opname: ${rec.label}`, `Event: ${event.description} (payoff ${event.payoff}), piek op ${((event.t_peak - start) / 1000).toFixed(1)} s in de Short`, `Lengte: ${(targetMs / 1000).toFixed(1)} s`, ""];

async function render(name: string, clips: VoiceClip[], lines: { at_ms: number; text: string }[]) {
  const ass = `${name}.ass`;
  await writeFile(join(out, ass), buildAss({ size, topLine: null, lines, durationMs: targetMs }), "utf8");
  const plan = renderArgs({ recording, recordingMs: rec!.probe!.durationMs, hasAudio: !!rec!.probe!.audioCodec, segments, size, assFile: ass, voice: clips, gameVolume: 0.35, output: join(out, `${name}.mp4`) });
  await runFfmpeg(ffmpeg, plan.args, out, 10 * 60_000);
}

if (args.includes("--zonder-stem") || !process.env.GOOGLE_TTS_API_KEY) {
  report.push("Zonder stem (geen TTS): alleen het script en de geschatte timing.");
  for (const l of script.lines) report.push(`  ${(l.at_ms / 1000).toFixed(1).padStart(5)} s  [${l.kind}] ${l.text}  (~${(estimateMs(l.text) / 1000).toFixed(1)} s)`);
  await render("zonder-stem", [], script.lines);
} else {
  const tts = createTts(process.env.GOOGLE_TTS_API_KEY);
  const usage = createUsageCounter(join(dataDir, "tts-usage.json"));
  const voiceName = "en-US-Chirp3-HD-Fenrir";
  const g = await speakWithGate({ lines: script.lines, segments, timeline, targetMs, settings, tts, voiceName, baseRate: 1.1, tmp: out, reserve: (n) => usage.reserve(n), duration: (f) => audioDurationMs(ffprobe, f), run: (a, cwd, t) => runFfmpeg(ffmpeg, a, cwd, t) });
  report.push(`Stem: ${voiceName}, ${g.characters} tekens (gratis deel)`, `Sync-gate: ${gateSummary(g.result.gate, g.result.attempts, g.result.dropped)}`, "", "MET sync-gate (zo komt hij in de video):");
  for (const it of g.result.gate.items) report.push(`  ${(it.atMs / 1000).toFixed(2).padStart(6)}-${((it.atMs + it.ms) / 1000).toFixed(2).padStart(6)} s ${it.ok ? "OK " : "FOUT"} ${it.speed > 1 ? `x${it.speed} ` : ""}${it.text}${it.reason ? `  <- ${it.reason}` : ""}`);
  await render("met-gate", g.clips, g.spoken);

  // The ORIGINAL lines WITHOUT the gate: each at its first estimate, as a script without real timing would do.
  const naive: VoiceClip[] = [];
  const peak = event.t_peak - start;
  report.push("", "ZONDER sync-gate (oorspronkelijke zinnen op hun geschatte plek):");
  for (const [i, l] of script.lines.entries()) {
    const file = g.firstFiles[i];
    if (!file) continue;
    const ms = await audioDurationMs(ffprobe, join(out, file));
    naive.push({ file, atMs: l.at_ms });
    const over = l.at_ms < peak + 250 && l.at_ms + ms > peak - 250;
    report.push(`  ${(l.at_ms / 1000).toFixed(2).padStart(6)}-${((l.at_ms + ms) / 1000).toFixed(2).padStart(6)} s ${over ? "PRAAT OVER DE PIEK " : ""}${l.text}`);
  }
  await render("zonder-gate", naive, script.lines);
}
await writeFile(join(out, "rapport.txt"), report.join("\n"), "utf8");
console.log(report.join("\n"));
console.log(`\nKlaar: ${out}`);

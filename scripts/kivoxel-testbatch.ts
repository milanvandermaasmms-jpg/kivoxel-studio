// KIVOXEL fase 1: a test BATCH of Shorts from real recordings, through the whole new chain, without Supabase.
//   node scripts/kivoxel-testbatch.ts <recording> [<recording> ...] [--max=5] [--zonder-stem]
// Per Short: length planner (bucket, never the same as the Short before), dead parts cut, hook from the library
// (fits the event, not used in the last 10), animated hook, free anticipation script, Google TTS per line with the
// sync gate, FFmpeg montage and a cover thumbnail with the yellow-header check. ENGLISH only.
// Output: testrenders/batch/<n>-<name>.mp4 (+ .jpg) and rapport.txt with the section-9 checks per Short.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hookFile, resolveSettings } from "../lib/kivoxel/config.ts";
import { chooseHook, hookChecks, hookEvents, hookStyle } from "../lib/kivoxel/hookText.ts";
import { lengthChecks, planShortBatch } from "../lib/kivoxel/shortPlan.ts";
import { thumbFromSourceArgs } from "../lib/kivoxel/thumbFrame.ts";
import { eventsInMontage, freeScript, gateSummary, seeded } from "../lib/kivoxel/voiceScript.ts";
import { thumbAss, THUMB_SIZE } from "../lib/youtube/thumbnails.ts";
import { buildAss, renderArgs, type VoiceClip } from "../lib/youtube/render.ts";
import { checkThumbnailHeader } from "../worker/brandCheck.ts";
import { audioDurationMs, findTool, runFfmpeg } from "../worker/ffmpeg.ts";
import { createEventStore } from "../worker/eventTimeline.ts";
import { createPhraseLog } from "../worker/phraseLog.ts";
import { createTts, createUsageCounter } from "../worker/tts.ts";
import { speakWithGate } from "../worker/voiceGate.ts";

const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const args = process.argv.slice(2);
const queries = args.filter((a) => !a.startsWith("--"));
const max = Number(/--max=(\d+)/.exec(args.join(" "))?.[1] ?? 5);
const withVoice = !args.includes("--zonder-stem") && !!process.env.GOOGLE_TTS_API_KEY;
if (!queries.length) throw new Error("Gebruik: node scripts/kivoxel-testbatch.ts <opname> [<opname> ...] [--max=5] [--zonder-stem]");

const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg", process.env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", process.env.FFPROBE_PATH);
type Rec = { fingerprint: string; label: string; file: string; probe: { durationMs: number; audioCodec: string | null } | null };
const recs = JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[];
const settings = resolveSettings(null);
const size = { width: settings.shorts.width, height: settings.shorts.height };
const out = resolve("testrenders", "batch");
await mkdir(out, { recursive: true });
const phrases = createPhraseLog(resolve("testrenders", "phrases.json"));
const hookLog = createPhraseLog(resolve("testrenders", "hooks.json"));
const events = createEventStore(ffmpeg, dataDir);
const tts = withVoice ? createTts(process.env.GOOGLE_TTS_API_KEY!) : null;
const usage = createUsageCounter(join(dataDir, "tts-usage.json"));
const voiceName = "en-US-Chirp3-HD-Fenrir";

const report: string[] = [];
let previous: string | null = null;
let n = 0;
for (const q of queries) {
  const rec = recs.find((r) => r.fingerprint.startsWith(q)) ?? recs.find((r) => r.label.toLowerCase().includes(q.toLowerCase()));
  if (!rec?.probe) throw new Error(`Geen opname gevonden voor "${q}"`);
  const timeline = await events.timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
  const plans = planShortBatch(timeline, settings, seeded(rec.fingerprint), max, previous);
  for (const plan of plans) {
    n++;
    const name = `${n}-${rec.label}`.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
    const event = timeline.events.find((e) => e.id === plan.eventId)!;
    const recentHooks = await hookLog.recent();
    const { hook, repeated } = chooseHook(event.type ?? "fail", recentHooks, seeded(`${rec.fingerprint}:${n}:hook`), settings.hooks.no_repeat_within, hookFile, event.kind === "death");
    const script = freeScript({ segments: plan.segments, targetMs: plan.targetMs, timeline, recent: await phrases.recent(), settings, seed: `${rec.fingerprint}:${plan.eventId}`, short: true });
    await phrases.add(script.used);
    const main = eventsInMontage(plan.segments, timeline).sort((a, b) => b.payoff - a.payoff)[0];

    let clips: VoiceClip[] = [];
    let spoken = script.lines.map((l) => ({ at_ms: l.at_ms, text: l.text }));
    let syncLine = "zonder stem";
    if (tts) {
      const g = await speakWithGate({ lines: script.lines, segments: plan.segments, timeline, targetMs: plan.targetMs, settings, tts, voiceName, baseRate: 1.1, tmp: out, reserve: (c) => usage.reserve(c), duration: (f) => audioDurationMs(ffprobe, f), run: (a, cwd, t) => runFfmpeg(ffmpeg, a, cwd, t) });
      // Each Short gets its own voice files (the gate names them vo0, vo1, ... in the shared folder).
      clips = g.clips;
      spoken = g.spoken;
      syncLine = gateSummary(g.result.gate, g.result.attempts, g.result.dropped);
    }
    const ass = `${name}.ass`;
    await writeFile(join(out, ass), buildAss({ size, topLine: hook, lines: spoken, durationMs: plan.targetMs, hook: { style: hookStyle(size, settings), events: hookEvents(hook, plan.targetMs, main?.peak_out ?? null, size, settings) } }), "utf8");
    const r = renderArgs({ recording: join(dataDir, "recordings", rec.file), recordingMs: rec.probe.durationMs, hasAudio: !!rec.probe.audioCodec, segments: plan.segments, size, assFile: ass, voice: clips, gameVolume: 0.35, output: join(out, `${name}.mp4`) });
    await runFfmpeg(ffmpeg, r.args, out, 10 * 60_000);

    // Cover thumbnail: best frame of the event, the same hook as yellow header, checked.
    const tass = `${name}-thumb.ass`;
    await writeFile(join(out, tass), thumbAss(THUMB_SIZE.short, hook), "utf8");
    await runFfmpeg(ffmpeg, thumbFromSourceArgs(join(dataDir, "recordings", rec.file), [event.t_thumb], THUMB_SIZE.short, tass, `${name}.jpg`), out, 120_000);
    const header = await checkThumbnailHeader(ffmpeg, `${name}.jpg`, tass, THUMB_SIZE.short, out);

    const checks = [...hookChecks(hook, event.type, recentHooks, settings, event.kind === "death"), ...lengthChecks(plan.targetMs, previous, settings)];
    report.push(
      `#${n} ${rec.label}: ${event.description} (payoff ${event.payoff})`,
      `   lengte ${(plan.targetMs / 1000).toFixed(1)} s = ${plan.bucket} (${plan.reason})${plan.cutMs ? `, ${(plan.cutMs / 1000).toFixed(1)} s dood beeld weggeknipt` : ""}`,
      `   hook "${hook}"${repeated ? " (HERHAALD: bibliotheek op)" : ""}, shake op ${main ? (main.peak_out / 1000).toFixed(1) : "-"} s`,
      `   stem: ${syncLine}`,
      `   zinnen: ${spoken.map((l) => `${(l.at_ms / 1000).toFixed(1)}s "${l.text}"`).join(" | ")}`,
      `   checks: ${checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.label}`).join(", ")}, ${header.ok ? "✅" : "❌"} Thumbnail-header geel`,
      "",
    );
    await hookLog.add([hook]);
    previous = plan.bucket;
  }
}
await writeFile(join(out, "rapport.txt"), report.join("\n"), "utf8");
console.log(report.join("\n"));
console.log(`Klaar: ${out}`);

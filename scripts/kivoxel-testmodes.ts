// KIVOXEL fase 1: the SAME Short in every audio mode, plus the old mix (before fase 1) to compare.
//   node scripts/kivoxel-testmodes.ts <recording> [event rank 1-5]
// Output: testrenders/modes/<mode>.mp4 + rapport.txt (loudness and true peak measured per file). ENGLISH only.
// Uses generated TEST music (allowed only in test renders) when there are no real tracks yet.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AUDIO_MODES, hookFile, resolveSettings, type AudioMode } from "../lib/kivoxel/config.ts";
import { topPayoffs } from "../lib/kivoxel/events.ts";
import { chooseHook, hookEvents, hookStyle } from "../lib/kivoxel/hookText.ts";
import { beatStart, pickTrack, planSfx } from "../lib/kivoxel/media.ts";
import type { MixPlan } from "../lib/kivoxel/mix.ts";
import { planShort } from "../lib/kivoxel/shortPlan.ts";
import { storyAss, textOverlays } from "../lib/kivoxel/textStory.ts";
import { eventsInMontage, freeScript, gateSummary, seeded } from "../lib/kivoxel/voiceScript.ts";
import { buildAss, renderArgs, type VoiceClip } from "../lib/youtube/render.ts";
import { audioDurationMs, findTool, normalizeLoudness, runFfmpeg } from "../worker/ffmpeg.ts";
import { targetFrom } from "../lib/kivoxel/loudness.ts";
import { createEventStore } from "../worker/eventTimeline.ts";
import { createMediaLibrary } from "../worker/mediaLibrary.ts";
import { createTts, createUsageCounter } from "../worker/tts.ts";
import { speakWithGate } from "../worker/voiceGate.ts";

const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [query, rankArg] = process.argv.slice(2);
if (!query || !process.env.GOOGLE_TTS_API_KEY) throw new Error("Gebruik: node scripts/kivoxel-testmodes.ts <opname> [event 1-5] (met GOOGLE_TTS_API_KEY)");
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
type Rec = { fingerprint: string; label: string; file: string; probe: { durationMs: number; audioCodec: string | null } | null };
const rec = (JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[]).find((r) => r.fingerprint.startsWith(query) || r.label.toLowerCase().includes(query.toLowerCase()));
if (!rec?.probe) throw new Error(`Geen opname "${query}"`);
const out = resolve("testrenders", "modes");
await mkdir(out, { recursive: true });

const base = resolveSettings(null);
const timeline = await createEventStore(ffmpeg, dataDir).timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
const event = topPayoffs(timeline, 5, 0)[Math.max(0, Number(rankArg ?? 1) - 1)];
// A "kort" Short (15-25 s), so there is room for music, voice and text.
const plan = planShort(event, timeline, base, seeded("modes"), "loop");
const script = freeScript({ segments: plan.segments, targetMs: plan.targetMs, timeline, settings: base, seed: `${rec.fingerprint}:modes`, short: true });
const hook = chooseHook(event.type ?? "fail", [], seeded("modes-hook"), 10, hookFile, event.kind === "death").hook;
const main = eventsInMontage(plan.segments, timeline).sort((a, b) => b.payoff - a.payoff)[0];
const media = createMediaLibrary(dataDir, resolve("assets", "kivoxel", "sfx"), console.log);
const lib = await media.music();
const sfxLib = await media.sfx();
const size = { width: 1080, height: 1920 };
const recording = join(dataDir, "recordings", rec.file);
const tts = createTts(process.env.GOOGLE_TTS_API_KEY);
const usage = createUsageCounter(join(dataDir, "tts-usage.json"));

// The voice once (same audio for both voice renders).
const g = await speakWithGate({ lines: script.lines, segments: plan.segments, timeline, targetMs: plan.targetMs, settings: base, tts, voiceName: "en-US-Chirp3-HD-Fenrir", baseRate: 1.1, tmp: out, reserve: (c) => usage.reserve(c), duration: (f) => audioDurationMs(ffprobe, f), run: (a, cwd, t) => runFfmpeg(ffmpeg, a, cwd, t) });
const report: string[] = [`Opname: ${rec.label} · ${event.description} · ${(plan.targetMs / 1000).toFixed(1)} s (${plan.bucket}) · hook "${hook}"`, `Stem: ${gateSummary(g.result.gate, g.result.attempts, g.result.dropped)} (${g.characters} tekens)`, ""];
const hookAss = { style: hookStyle(size, base), events: hookEvents(hook, plan.targetMs, main?.peak_out ?? null, size, base) };

/** Integrated loudness and true peak of a finished file (the summary at the end of FFmpeg's ebur128 log). */
function lufs(file: string): string {
  const log = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const last = (re: RegExp) => [...log.matchAll(re)].at(-1)?.[1] ?? "?";
  return `${last(/I:\s+(-?[\d.]+) LUFS/g)} LUFS, true peak ${last(/Peak:\s+(-?[\d.]+) dBFS/g)} dBFS`;
}

async function render(name: string, mode: AudioMode | "oud") {
  const settings = mode === "oud" ? base : resolveSettings(null, mode);
  const spec = mode === "oud" ? null : settings.audio_modes[mode];
  const withVoice = mode === "oud" || !!spec?.voice;
  const story = withVoice ? { overlays: [], dropped: [] } : textOverlays(script.lines, plan.segments, timeline, plan.targetMs, settings);
  let mix: MixPlan | undefined;
  let musicNote = "geen muziek";
  if (spec) {
    const track = spec.music ? pickTrack(lib.tracks, event.type ?? "fail", 5, [], seeded(name), 6, true) : null;
    const music = track ? { file: join(lib.dir, track.file), startMs: beatStart(track, main?.peak_out ?? null), title: track.title } : null;
    if (track) musicNote = `muziek: ${track.title}${track.test ? " (TESTTRACK)" : ""}, maatslag op ${((main?.peak_out ?? 0) / 1000).toFixed(1)} s`;
    const sfx = planSfx({ segments: plan.segments, peaks: eventsInMontage(plan.segments, timeline).map((e) => ({ atMs: e.peak_out, payoff: e.payoff, death: e.kind === "death" })), library: sfxLib.items, recent: [], rnd: seeded(name), withVoice: spec.voice, durationMs: plan.targetMs });
    mix = { mode: mode as AudioMode, spec, music, sfx, voiceChain: true };
  }
  const ass = `${name}.ass`;
  await writeFile(join(out, ass), buildAss({ size, topLine: hook, lines: withVoice ? g.spoken : [], durationMs: plan.targetMs, story: story.overlays.length ? storyAss(story.overlays, size, plan.targetMs) : undefined, hook: mode === "oud" ? undefined : hookAss }), "utf8");
  const clips: VoiceClip[] = withVoice ? g.clips : [];
  const r = renderArgs({ recording, recordingMs: rec!.probe!.durationMs, hasAudio: !!rec!.probe!.audioCodec, segments: plan.segments, size, assFile: ass, voice: clips, gameVolume: 0.25, output: join(out, `${name}.mp4`), ...(mix ? { mix: { plan: mix, settings } } : {}) });
  await runFfmpeg(ffmpeg, r.args, out, 10 * 60_000);
  // The same exact-loudness pass as the worker (only for the new mix; the old mix stays as it was).
  if (mix) {
    const tmpFile = join(out, `${name}.loud.mp4`);
    if (await normalizeLoudness(ffmpeg, join(out, `${name}.mp4`), tmpFile, out, targetFrom(settings.mix))) await rename(tmpFile, join(out, `${name}.mp4`));
  }
  report.push(`${name}.mp4 — ${mode === "oud" ? "OUDE mix (vóór fase 1): stem droog, geen muziek/SFX, vaste witte bovenregel" : spec!.label}`, `   ${withVoice ? `stem: ${clips.length} zinnen` : `tekst in beeld: ${story.overlays.map((o) => `${(o.startMs / 1000).toFixed(1)}s "${o.text}"`).join(" | ")}`}`, `   ${musicNote}; SFX: ${mix?.sfx.map((s) => `${s.kind}@${(s.atMs / 1000).toFixed(1)}s`).join(", ") || "geen"}`, `   gemeten: ${lufs(join(out, `${name}.mp4`))}`, "");
}

await render("0-oud", "oud");
for (const [i, m] of AUDIO_MODES.entries()) await render(`${i + 1}-${m}`, m);
await writeFile(join(out, "rapport.txt"), report.join("\n"), "utf8");
console.log(report.join("\n"));

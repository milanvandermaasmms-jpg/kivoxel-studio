// KIVOXEL fase 1: test renders through the WHOLE new chain, as the worker does it (without Supabase).
//   node scripts/kivoxel-testfull.ts shorts <recording> [<recording> ...] [--max=3] [--preset=standaard] [--mode=vo_muziek]
//   node scripts/kivoxel-testfull.ts long <recording> <from s> <to s>
// Shorts: length planner + slow motion, hook (library, animated), free script, Google TTS + sync gate, word captions,
// pattern interrupts + SFX accents, music (TEST tracks allowed here only) + SFX, 60 fps high quality, exact loudness,
// cover thumbnail with header check. Long: cold open + "how did we get here", dead parts cut, visual resets, chapters.
// ENGLISH only. Output: testrenders/full/ with rapport.txt (all section-9 checks per video).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { captionEvents, captionStyleLine, timedFromSpoken } from "../lib/kivoxel/captions.ts";
import { AUDIO_MODES, hookFile, resolveSettings, type AudioMode } from "../lib/kivoxel/config.ts";
import type { EventTimeline } from "../lib/kivoxel/events.ts";
import { chooseHook, hookChecks, hookEvents, hookStyle, longTopEvents } from "../lib/kivoxel/hookText.ts";
import { planMusicParts } from "../lib/kivoxel/musicPlan.ts";
import { freezeFilter, interruptFilter, interruptSfx, longestQuiet, planFreezes, planInterrupts, ZOOM_STYLES } from "../lib/kivoxel/interrupts.ts";
import { chapters, cutDeadInPlan, deadInMontage, firstFrameMoves } from "../lib/kivoxel/longPlan.ts";
import { loudnessCheck, targetFrom } from "../lib/kivoxel/loudness.ts";
import { beatStart, pickTrack, planSfx } from "../lib/kivoxel/media.ts";
import { modeCheck, type MixPlan } from "../lib/kivoxel/mix.ts";
import { lengthChecks, planShortBatch } from "../lib/kivoxel/shortPlan.ts";
import { storyAss, textOverlays, type StoryText } from "../lib/kivoxel/textStory.ts";
import { thumbFromSourceArgs } from "../lib/kivoxel/thumbFrame.ts";
import { eventsInMontage, freeScript, gateSummary, pick, seeded, templates, type VoLine } from "../lib/kivoxel/voiceScript.ts";
import type { Segment } from "../lib/youtube/analysis.ts";
import { buildAss, renderArgs, type VoiceClip } from "../lib/youtube/render.ts";
import { thumbAss, THUMB_SIZE } from "../lib/youtube/thumbnails.ts";
import { checkThumbnailHeader } from "../worker/brandCheck.ts";
import { createEventStore } from "../worker/eventTimeline.ts";
import { createSpeechStore } from "../worker/kidsSpeech.ts";
import { audioDurationMs, findTool, normalizeLoudness, runFfmpeg } from "../worker/ffmpeg.ts";
import { createMediaLibrary } from "../worker/mediaLibrary.ts";
import { createPhraseLog } from "../worker/phraseLog.ts";
import { createTts, createUsageCounter } from "../worker/tts.ts";
import { speakWithGate } from "../worker/voiceGate.ts";
import { bestLocalTts, chatterboxTts, findClone } from "../worker/localTts.ts";
import { createAligner } from "../worker/kidsSpeech.ts";

const envFile = join(import.meta.dirname, "..", "worker", ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const flag = (k: string) => /--(\w+)=(\S+)/.exec(args.find((a) => a.startsWith(`--${k}=`)) ?? "")?.[2];
const [what, ...rest] = args.filter((a) => !a.startsWith("--"));
// --zonder-sleutels: everything as if there were no API keys at all (section 8): local voice, free script, free analysis.
const noKeys = args.includes("--zonder-sleutels");
const report: string[] = [];
if (noKeys) {
  delete process.env.GOOGLE_TTS_API_KEY;
  delete process.env.GEMINI_API_KEY;
}
if (!what || (!noKeys && !process.env.GOOGLE_TTS_API_KEY)) throw new Error("Gebruik: node scripts/kivoxel-testfull.ts shorts <opname...> | long <opname> <van s> <tot s>");
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const ffmpeg = findTool("ffmpeg");
const ffprobe = findTool("ffprobe");
type Rec = { fingerprint: string; label: string; file: string; probe: { durationMs: number; audioCodec: string | null; fps: number | null } | null };
const recs = JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[];
const find = (q: string) => {
  const r = recs.find((x) => x.fingerprint.startsWith(q) || x.label.toLowerCase().includes(q.toLowerCase()));
  if (!r?.probe) throw new Error(`Geen opname "${q}"`);
  return r as Rec & { probe: NonNullable<Rec["probe"]> };
};
const mode = (AUDIO_MODES as readonly string[]).includes(flag("mode") ?? "") ? (flag("mode") as AudioMode) : "vo_muziek";
const settings = resolveSettings(flag("preset") ?? null, mode);
const spec = settings.audio_modes[mode];
const events = createEventStore(ffmpeg, dataDir, createSpeechStore(ffmpeg, dataDir));
const media = createMediaLibrary(dataDir, resolve("assets", "kivoxel", "sfx"), console.log);
const musicLib = await media.music();
const sfxLib = await media.sfx();
// --kloon: the cloned voice (Chatterbox), as the worker uses it for Shorts; captions aligned with Whisper.
const cloneCfg = args.includes("--kloon") ? findClone(dataDir, join(import.meta.dirname, "..", "worker", "chatterbox_server.py")) : null;
const local = cloneCfg ? chatterboxTts(cloneCfg, settings.voice.clone.boost) : noKeys ? await bestLocalTts(dataDir, settings.voice.local_order, settings.voice.kokoro_voice) : null;
const align = createAligner(ffmpeg, dataDir);
const tts = local ?? createTts(process.env.GOOGLE_TTS_API_KEY!);
const out = resolve("testrenders", cloneCfg ? "kloon" : noKeys ? "zonder-sleutels" : "full");
await mkdir(out, { recursive: true });
if (local) report.push(`ZONDER API-SLEUTELS: stem ${local.name}, script uit de gratis engine, analyse uit de gratis Event Timeline`, "");
const usage = createUsageCounter(join(dataDir, "tts-usage.json"));
const phrases = createPhraseLog(resolve("testrenders", "phrases.json"));
const hookLog = createPhraseLog(resolve("testrenders", "hooks.json"));
const styleLog = createPhraseLog(resolve("testrenders", "styles.json"));

function lufs(file: string): string {
  const log = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const last = (re: RegExp) => [...log.matchAll(re)].at(-1)?.[1] ?? "?";
  return `${last(/I:\s+(-?[\d.]+) LUFS/g)} LUFS, true peak ${last(/Peak:\s+(-?[\d.]+) dBFS/g)} dBFS`;
}

/** One video through the chain; returns the checks for the report. */
async function make(name: string, rec: Rec & { probe: NonNullable<Rec["probe"]> }, timeline: EventTimeline, segments: Segment[], short: boolean, hook: string | null, previousBucket: string | null, label = "") {
  const size = short ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const targetMs = segments.reduce((s, sg) => s + Math.round((sg.src_end_ms - sg.src_start_ms) / sg.speed), 0);
  const inMontage = eventsInMontage(segments, timeline);
  const main = [...inMontage].sort((a, b) => b.payoff - a.payoff)[0] ?? null;
  const script = freeScript({ segments, targetMs, timeline, recent: await phrases.recent(), settings, seed: `${rec.fingerprint}:${name}`, short });
  await phrases.add(script.used);
  let clips: VoiceClip[] = [];
  let spoken: (VoLine & { ms?: number })[] = [];
  let story: StoryText[] = [];
  let sync = "geen stem in deze modus";
  if (spec.voice) {
    const g = await speakWithGate({ align, verify: !!cloneCfg, lines: script.lines, segments, timeline, targetMs, settings, tts, voiceName: "en-US-Chirp3-HD-Fenrir", baseRate: 1.1, tmp: out, reserve: async (c) => (local ? undefined : usage.reserve(c)), duration: (f) => audioDurationMs(ffprobe, f), run: (a, cwd, t) => runFfmpeg(ffmpeg, a, cwd, t) });
    // Each video gets its own copies of the voice files (the gate reuses vo0, vo1, … in this shared folder).
    clips = [];
    for (const [i, c] of g.clips.entries()) {
      const own = `${name}-vo${i}${c.file.slice(c.file.lastIndexOf("."))}`;
      await rename(join(out, c.file), join(out, own)).catch(() => undefined);
      clips.push({ file: own, atMs: c.atMs });
    }
    spoken = g.spoken;
    sync = gateSummary(g.result.gate, g.result.attempts, g.result.dropped);
  } else if (spec.text_story !== false) story = textOverlays(script.lines, segments, timeline, targetMs, settings).overlays;
  // Teaser: "N SECONDS EARLIER…".
  const teaser = segments.find((s) => s.part === "teaser" && s.out_start_ms === 0);
  if (teaser && spec.text_story !== false) {
    const next = [...segments].sort((a, b) => a.out_start_ms - b.out_start_ms)[1];
    const tEnd = Math.round(teaser.src_end_ms - teaser.src_start_ms);
    if (next) story.push({ startMs: tEnd, endMs: tEnd + 1100, text: `${Math.max(2, Math.round((teaser.src_start_ms - next.src_start_ms) / 1000))} SECONDS EARLIER…`, reaction: false });
  }
  const styles = await styleLog.recent();
  const lastZoom = [...styles].reverse().find((s) => s.startsWith("zoom:"))?.slice(5);
  const zoomStyle = ZOOM_STYLES.filter((z) => z !== lastZoom)[Math.floor(seeded(name)() * 2)];
  const captionStyle = (["pop", "bounce", "highlight"] as const)[Math.floor(seeded(`${name}c`)() * 3)];
  await styleLog.add([`zoom:${zoomStyle}`]);
  const interrupts = planInterrupts({ durationMs: targetMs, peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff })), short, style: zoomStyle, settings, rnd: seeded(`${name}fx`) });
  const fps = (rec.probe.fps ?? 30) >= 50 ? 60 : 30;
  const freezes = spec.text_story === false ? [] : planFreezes({ peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, fail: e.kind === "death" || e.type === "fail" })), durationMs: targetMs, short, settings, take: () => pick(templates.freeze_text, [], seeded(`${name}fz`)) });
  story.push(...freezes.map((f) => ({ startMs: f.atMs, endMs: f.atMs + f.ms, text: f.text, reaction: true })));
  const rnd = seeded(`${name}mix`);
  // Same as the worker: busy music for action, calm for searching and farming (real tracks only when there are any).
  const parts = spec.music ? planMusicParts({ durationMs: targetMs, events: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, type: e.type, kind: e.kind })), library: musicLib.tracks, recent: [], rnd, short, allowTest: !musicLib.tracks.some((t) => !t.test) }) : [];
  const sfx = spec.sfx === false ? [] : planSfx({ segments, peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, death: e.kind === "death" })), library: sfxLib.items, recent: [], rnd, withVoice: spec.voice, durationMs: targetMs });
  for (const a of spec.sfx === false ? [] : interruptSfx(interrupts)) {
    const f = sfxLib.items.find((x) => x.kind === a.kind);
    if (f) sfx.push({ file: f.file, atMs: a.atMs, db: (spec.voice ? -14 : -9) + (f.db ?? 0), kind: a.kind });
  }
  const plan: MixPlan = { mode, spec, music: parts.length ? { file: join(musicLib.dir, parts[0].file), startMs: parts[0].startMs, title: parts.map((p) => `${p.kind === "action" ? "actie" : "rustig"} ${(p.atMs / 1000).toFixed(0)}-${((p.atMs + p.durMs) / 1000).toFixed(0)}s: ${p.title}`).join(" | "), parts: parts.map((p) => ({ ...p, file: join(musicLib.dir, p.file) })) } : null, sfx, voiceChain: true };
  const ass = `${name}.ass`;
  const words = spoken.length ? { style: captionStyleLine(size, settings), events: captionEvents(timedFromSpoken(spoken, targetMs), captionStyle, size, settings, targetMs) } : undefined;
  await writeFile(join(out, ass), buildAss({ size, topLine: hook, lines: spoken, durationMs: targetMs, hook: hook ? { style: hookStyle(size, settings), events: short ? hookEvents(hook, targetMs, main?.peak_out ?? null, size, settings) : longTopEvents(hook, targetMs, size, settings) } : undefined, words, story: story.length ? storyAss(story, size, targetMs) : undefined }), "utf8");
  const file = join(out, `${name}.mp4`);
  const r = renderArgs({ recording: join(dataDir, "recordings", rec.file), recordingMs: rec.probe.durationMs, hasAudio: !!rec.probe.audioCodec, segments, size, assFile: ass, voice: clips, gameVolume: 0.25, output: file, mix: { plan, settings }, fx: [freezeFilter(freezes, fps), interruptFilter(interrupts, size)].filter(Boolean).join(",") || undefined, highQuality: true, fps, ...(short && settings.features.loop_ending ? { loopFadeMs: 400 } : {}) });
  const t0 = Date.now();
  await runFfmpeg(ffmpeg, r.args, out, 30 * 60_000);
  const loud = join(out, `${name}.loud.mp4`);
  if (await normalizeLoudness(ffmpeg, file, loud, out, targetFrom(settings.mix))) await rename(loud, file);
  const renderS = Math.round((Date.now() - t0) / 1000);
  const loudLine = lufs(file);
  const lv = /(-?[\d.]+) LUFS, true peak (-?[\d.]+)/.exec(loudLine);
  const lc = loudnessCheck(lv ? Number(lv[1]) : null, lv ? Number(lv[2]) : null, settings.mix);
  const dead = deadInMontage(segments, timeline.dead, settings.features.max_pause_ms, inMontage.map((e) => e.t_peak));
  const checks: [boolean, string][] = [
    [firstFrameMoves(segments, timeline.dead), "Eerste frame beweegt"],
    [dead.longestMs === 0, `Geen dode stukken > 0,7 s${dead.longestMs ? ` (nog ${(dead.longestMs / 1000).toFixed(1)} s)` : ""}`],
    [modeCheck(plan, clips.length).ok || !plan.music, `Audio-modus ${spec.label}`],
    [lc.ok, `Luidheid ${lc.value}`],
  ];
  if (short) {
    checks.push([longestQuiet(interrupts, targetMs) <= 4500, `Interrupt elke 2-4 s (langste gat ${(longestQuiet(interrupts, targetMs) / 1000).toFixed(1)} s)`]);
    for (const c of [...(hook ? hookChecks(hook, main?.type ?? null, [], settings, main?.kind === "death") : []), ...lengthChecks(targetMs, previousBucket, settings)]) checks.push([c.ok, c.label]);
    const tass = `${name}-thumb.ass`;
    await writeFile(join(out, tass), thumbAss(THUMB_SIZE.short, hook ?? ""), "utf8");
    await runFfmpeg(ffmpeg, thumbFromSourceArgs(join(dataDir, "recordings", rec.file), [main?.t_thumb ?? segments[0].src_start_ms], THUMB_SIZE.short, tass, `${name}.jpg`), out, 120_000);
    checks.push([(await checkThumbnailHeader(ffmpeg, `${name}.jpg`, tass, THUMB_SIZE.short, out)).ok, "Thumbnail-header geel"]);
  }
  const ch = short ? [] : chapters(segments, timeline, targetMs);
  report.push(
    `${name}.mp4 — ${label ? `${label} · ` : ""}${(targetMs / 1000).toFixed(1)} s, ${size.width}×${size.height}, ${r.args.join(" ").includes("fps=60") ? "60" : "30"} fps, render ${renderS} s${freezes.length ? `, freeze: ${freezes.map((f) => `${f.text} @${(f.atMs / 1000).toFixed(1)}s`).join(" ")}` : ""}, loop-einde: ${short && settings.features.loop_ending ? "ja" : "nee"}`,
    ...(hook ? [`   hook "${hook}"`] : []),
    `   stem: ${sync}`,
    `   captions: ${captionStyle}${words ? `, ${words.events.length} woord-momenten` : " (tekst in beeld)"}; interrupts: ${zoomStyle}, ${interrupts.length}× (${[...new Set(interrupts.map((i) => i.kind))].join(", ")})`,
    `   muziek: ${plan.music?.title ?? "geen"}; SFX: ${sfx.length}× (${[...new Set(sfx.map((s) => s.kind))].join(", ")})`,
    `   luidheid: ${loudLine}`,
    ...(ch.length ? [`   hoofdstukken: ${ch.join(" | ")}`] : []),
    `   checks: ${checks.map(([ok, l]) => `${ok ? "✅" : "❌"} ${l}`).join(", ")}`,
    "",
  );
}

if (what === "shorts") {
  let previous: string | null = null;
  let n = 0;
  for (const q of rest) {
    const rec = find(q);
    const timeline = await events.timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
    for (const p of planShortBatch(timeline, settings, seeded(`${rec.fingerprint}:full`), Number(flag("max") ?? 3), previous)) {
      n++;
      const e = timeline.events.find((x) => x.id === p.eventId)!;
      const hook = chooseHook(e.type ?? "fail", await hookLog.recent(), seeded(`${rec.fingerprint}:${n}`), 10, hookFile, e.kind === "death").hook;
      await hookLog.add([hook]);
      await make(`short${n}`, rec, timeline, p.segments, true, hook, previous, `${p.bucket}: ${e.description}`);
      previous = p.bucket;
    }
  }
} else {
  const rec = find(rest[0]);
  const from = Number(rest[1] ?? 0) * 1000;
  const to = Math.min(rec.probe.durationMs, Number(rest[2] ?? 240) * 1000);
  const timeline = await events.timeline(rec.fingerprint, rec.file, rec.probe.durationMs);
  const best = timeline.events.filter((e) => e.t_peak > from && e.t_peak < to).sort((a, b) => b.payoff - a.payoff)[0];
  // Cold open: the best moment first (5 s), then the story from the start of the stretch.
  const segs: Segment[] = [
    ...(best ? [{ part: "cold_open" as const, src_start_ms: best.t_peak - 3000, src_end_ms: best.t_peak + 2000, out_start_ms: 0, speed: 1, effects: ["zoom"], note: "cold open" }] : []),
    { part: "chapter", src_start_ms: from, src_end_ms: to, out_start_ms: best ? 5000 : 0, speed: 1, effects: [], note: "verhaal" },
  ];
  const cut = cutDeadInPlan(segs, timeline);
  report.push(`Lange video uit ${rec.label} ${from / 1000}-${to / 1000} s: ${(cut.cutMs / 1000).toFixed(1)} s dood beeld weggeknipt`);
  await make("long", rec, timeline, cut.segments, false, null, null);
}
await writeFile(join(out, `rapport-${what}.txt`), report.join("\n"), "utf8");
console.log(report.join("\n"));
process.exit(0); // the voice-clone process would keep Node alive

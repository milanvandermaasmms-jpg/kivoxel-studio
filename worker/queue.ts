// The queue in Supabase (table yt_jobs, migration 007). The dashboard puts steps in; this worker picks them up.
// Uses the service key from worker/.env.local; that key never goes into the app or Git.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  analysisPrompt,
  analysisChunks,
  buildEditPlan,
  estimateAnalysisCents,
  formatTimecode,
  MAX_ANALYSIS_MS,
  parseAnalysis,
  parseScript,
  parseSeriesKey,
  planVideos,
  seriesTitles,
  type SeriesContext,
  scriptPrompt,
  testMoments,
  targetFor,
  testScript,
  type Format,
  type Moment,
  mergeMoments,
  type ScriptDraft,
  type ScriptFeedback,
  type ScriptLine,
  type Segment,
} from "../lib/youtube/analysis.ts";
import type { LocalRecording } from "../lib/youtube/protocol.ts";
import { applyHook, parseHooks, rankShortHooks } from "../lib/youtube/hooks.ts";
import { STEP_MILESTONE, STEP_PHASE, stepNotes } from "../lib/youtube/live.ts";
import { parseSuggestions, readSuggestions, suggestPrompt, testSuggestions, type SuggestInput } from "../lib/youtube/suggest.ts";
import { defaultTags, learnTags, likedTitles, type Preference, type StudioEvent } from "../lib/youtube/learning.ts";
import { buildViral, defaultQueries, listenAudioArgs, listenPrompt, parseListen, summarizeReference, testListen, type ListenResult, type ReferenceVideo } from "../lib/youtube/viral.ts";
import type { Research } from "./research.ts";
import { contentStrength, evidenceFacts, evidenceBatches, evidencePrompt, framePlan, LONG_FRAME_EVERY_MS, mergeEvidence, naturalize, storyBlock, parseEvidence, type Evidence, type FramePick } from "../lib/youtube/grounding.ts";
import { tmpdir } from "node:os";
import { polishPlan } from "../lib/youtube/editPolish.ts";
import { totalMs } from "../lib/youtube/editor.ts";
import { nicheQueries } from "../lib/ivar/insights.ts";
import { channelAudioMode, gameInText, GAMES, labelWithGame, PROFILES, profileFor, recordingGame, wrongChannelProblem, fixGameName, type ChannelProfile, type GameId } from "../lib/youtube/gameProfile.ts";
import { isDreamnestChannel } from "../lib/studioRoutes.ts";
import { ANALYSIS_STAGES, expectedThinkingMs, renderProgress, stageProgress, thinkingShare } from "../lib/youtube/progress.ts";
import { buildAss, buildSrt, cleanRegions, narration, renderArgs, renderChunks, renderFileName, renderSize, segmentOverlays, srtFileName, type RenderInput, type VoiceClip } from "../lib/youtube/render.ts";
import { CancelledError, type RunOptions } from "./ffmpeg.ts";
import { buildTimeline, deadReason, signalHints, timelineSummary, type Signals, type Timeline } from "../lib/youtube/footage.ts";
import type { Uploader } from "./youtubeUpload.ts";
import { isQuotaError } from "./manualLink.ts";
import { reviveMontage, type ReviveJob, type ReviveScript, type ReviveVideo } from "./revive.ts";
import { nextInLine, oldRefusal, parseWait, retryAfter, waitNote, type WaitingPub } from "../lib/youtube/uploadWait.ts";
import { applyFixes, type Fixes } from "../lib/youtube/reviewFeedback.ts";
import { narrationValue } from "../lib/youtube/voicePlan.ts";
import { coldOpenPeak } from "../lib/youtube/planPeak.ts";
import { lessonPrompt, lessonsFrom, type Lesson } from "../lib/kivoxel/lessons.ts";
import { producerGate, rankCandidates, type GateResult } from "../lib/kivoxel/producerGate.ts";
import { reviewExport, type EditorReport } from "../lib/kivoxel/editorReview.ts";
import { measureExport } from "./editorMeasure.ts";
import { createVoiceLedger } from "./voiceLedger.ts";
import { boostOf, boostsSummary, kindBoosts, type KindBoost, type KindSample } from "../lib/youtube/learnedKinds.ts";
import { uploadChannelProblem } from "../lib/youtube/connection.ts";
import { firstActionMs, planChanges, needsLoudnessFix, parseQcLog, pickLoudnessFix, qcChecklist, type Loudness, type QcItem, type QcProbe } from "../lib/youtube/qc.ts";
import { BOOST_LIMITS } from "./ffmpeg.ts";
import { thumbAss, thumbFileName, thumbnailPlans, THUMB_SIZE, type StoredThumb } from "../lib/youtube/thumbnails.ts";
import { costCents, type Gemini, type Usage } from "./gemini.ts";
import type { Store } from "./store.ts";
import type { Tts } from "./tts.ts";
import type { HeaderCheck } from "../lib/kivoxel/brand.ts";
import type { EventStore } from "./eventTimeline.ts";
import { sourceThumbMs, outToSource, thumbFromSourceArgs } from "../lib/kivoxel/thumbFrame.ts";
import { topPayoffs, type EventTimeline } from "../lib/kivoxel/events.ts";
import { eventsInMontage, gateSummary, type GateItem, type VoLine } from "../lib/kivoxel/voiceScript.ts";
import { hookFile, presetFile, resolveSettings, VIDEO_LANGUAGE } from "../lib/kivoxel/config.ts";
import { FREE_ENGINE_MODEL, fillSilences, forGame, freeScript, pick, seeded, templates } from "../lib/kivoxel/voiceScript.ts";
import { eventTypeForMoment } from "../lib/kivoxel/config.ts";
import type { GameEvent } from "../lib/kivoxel/events.ts";
import { bucketOf, lengthChecks, planShort } from "../lib/kivoxel/shortPlan.ts";
import { chooseHook, hookChecks, hookEvents, hookStyle, hookType, longTopEvents } from "../lib/kivoxel/hookText.ts";
import { planMusicParts } from "../lib/kivoxel/musicPlan.ts";
import { anticipationPrompt, parseAnticipation } from "../lib/kivoxel/scriptPrompt.ts";
import type { PhraseLog } from "./phraseLog.ts";
import type { LocalTts } from "./localTts.ts";
import { AUDIO_MODES, type AudioMode } from "../lib/kivoxel/config.ts";
import { modeCheck, sfxBeds, type MixPlan, type MusicChoice, type SfxCue } from "../lib/kivoxel/mix.ts";
import { beatStart, motifCues, pickTrack, planSfx, type Sfx, type Track } from "../lib/kivoxel/media.ts";
import { storyAss, textOverlays, type StoryText } from "../lib/kivoxel/textStory.ts";
import { momentsFromTimeline } from "../lib/kivoxel/freeMoments.ts";
import { loudnessCheck, targetFrom, type LoudnessTarget } from "../lib/kivoxel/loudness.ts";
import { CAPTION_STYLES, captionEvents, captionStyleLine, timedFromSpoken } from "../lib/kivoxel/captions.ts";
import { learnFrom, type ApprovedScript } from "../lib/kivoxel/learn.ts";
import { freezeFilter, interruptFilter, interruptSfx, longestQuiet, planFreezes, planInterrupts, ZOOM_STYLES } from "../lib/kivoxel/interrupts.ts";
import { chapters, cutDeadInPlan, deadInMontage, firstFrameMoves } from "../lib/kivoxel/longPlan.ts";
import { speakWithGate } from "./voiceGate.ts";

/**
 * FFmpeg montage on this pc: previews go to `rendersDir`, work files to a temporary folder in `tmpDir`.
 * `voice` is null while GOOGLE_TTS_API_KEY is missing from worker/.env.local.
 */
export type Montage = {
  rendersDir: string;
  tmpDir: string;
  /** Path of FFmpeg (the eindredacteur measures the export with it). */
  ffmpeg?: string;
  run: (args: string[], cwd: string, timeoutMs: number, options?: RunOptions) => Promise<void>;
  /** Quality pass over a finished montage (fase C1); optional so older setups keep working. */
  measure?: (file: string, cwd: string, options?: RunOptions) => Promise<{ probe: QcProbe; stderr: string }>;
  boost?: (input: string, output: string, cwd: string, options?: RunOptions & { limit?: number }) => Promise<void>;
  loudness?: (file: string, cwd: string) => Promise<{ integratedLufs: number | null; truePeakDb: number | null }>;
  voice: { tts: Tts; usage: { reserve: (characters: number) => Promise<unknown> } } | null;
  /** KIVOXEL fase 1: proves a thumbnail's yellow header matches brand/thumbnail_header.json. Optional for older setups. */
  headerCheck?: (thumb: string, assFile: string, size: { width: number; height: number }, cwd: string) => Promise<HeaderCheck>;
  /** KIVOXEL fase 1: the Event Timeline per recording (free signals + AI moments), cached on this pc. */
  events?: EventStore;
  /** Length of a spoken line in ms (ffprobe), for the sync gate. */
  duration?: (file: string) => Promise<number>;
  /** Recently used phrases (rotation), on this pc. */
  phrases?: PhraseLog;
  /** KIVOXEL fase 1, section 8: a voice without cloud credits (Piper, Kokoro or Windows), WAV out. */
  localVoice?: LocalTts;
  /** The cloned voice (Chatterbox, reference recording on this pc); used first when presets.json voice.clone.use is on. */
  cloneVoice?: LocalTts;
  /** Whisper on a voice clip (word times), so the captions follow the voice exactly. */
  align?: (file: string, cwd: string) => Promise<{ text: string; startMs: number; endMs: number }[] | null>;
  /** KIVOXEL fase 1: exact loudness in two passes (picture copied); false when FFmpeg gave no measurement. */
  normalize?: (input: string, output: string, cwd: string, target: LoudnessTarget, options?: RunOptions) => Promise<boolean>;
  /** KIVOXEL fase 1: the local music and SFX libraries, and which tracks/SFX were used lately (rotation). */
  media?: {
    music: () => Promise<{ dir: string; tracks: Track[] }>;
    sfx: () => Promise<{ dir: string; items: Sfx[] }>;
    /** The KIVOXEL motif (own music); optional so tests and older setups work without it. */
    motif?: (channel?: string) => Promise<{ file: string; durMs: number } | null>;
    musicLog: PhraseLog;
    sfxLog: PhraseLog;
  };
};

/** YouTube upload (fase D3); null while YouTube is not set up in worker/.env.local. */
/** frame: one picture of a montage as JPEG (fase D4b), written to tmpDir. */
export type Publisher = { uploader: Uploader; rendersDir: string;
  /** The YouTube channel ID the tokens on this pc belong to (free, from the token file). Checked before every new upload. */
  tokensChannelId?: (channelRowId: string) => Promise<string | null>;
  /** 19-11-2026: the uploader with the sign-in of this channel (SpawnNado went to KIVOXEL's account before). */
  uploaderFor?: (channelRowId: string) => Promise<Uploader>; tmpDir?: string; frame?: (input: string, atMs: number, output: string) => Promise<void>; pollMs?: number; pollTimes?: number };

/** The paid analysis service; null while GEMINI_API_KEY is missing from worker/.env.local. */
export type Ai = {
  gemini: Gemini;
  makeProxy: (file: string, fingerprint: string, durationMs: number, options?: RunOptions) => Promise<string>;
  removeProxy: (file: string) => Promise<void>;
  /** Fase C: one part of the small copy, for long recordings. Optional: without it the whole copy goes at once. */
  cutProxy?: (proxy: string, startMs: number, lengthMs: number, options?: RunOptions) => Promise<string>;
  /** Fase 3: free FFmpeg signals (stillness, black, loud moments) before the paid analysis. Optional: without it the analysis works as before. */
  signals?: (file: string, fingerprint: string, durationMs: number, options?: RunOptions) => Promise<Signals>;
  /** Studio 2.0: one full-quality frame of the recording (JPEG); without it scripts are written as before. */
  frame?: (file: string, atMs: number, output: string) => Promise<void>;
};

type Job = { id: string; studio_id: string; recording_id: string | null; video_id: string | null; step: string; attempts: number; max_attempts: number; payload: Record<string, unknown> | null };
/** What a step tells the Live Production Center while it runs (migration 033). Quietly does nothing before 033. */
export type Live = {
  signal: AbortSignal;
  phase: (phase: string, progress?: number | null) => Promise<void>;
  progress: (fields: { progress: number | null; metrics: Record<string, number | null> }) => Promise<void>;
  event: (kind: "log" | "milestone" | "note" | "error", message: string) => Promise<void>;
  stop: () => void;
};
/** Fase 3: moments in parts where nothing happens (AFK, menu, loading) are not kept; the reason goes to "rejected". */
export function dropDead(parsed: { moments: Moment[]; rejected: string[] }, timeline: Timeline): { moments: Moment[]; rejected: string[] } {
  const moments: Moment[] = [];
  const rejected = [...parsed.rejected];
  for (const m of parsed.moments) {
    const why = deadReason(m, timeline);
    if (why) rejected.push(`${m.kind} ${Math.round(m.startMs / 1000)} s: ${why}`);
    else moments.push(m);
  }
  return { moments, rejected };
}
const NO_LIVE: Live = { signal: new AbortController().signal, phase: async () => {}, progress: async () => {}, event: async () => {}, stop: () => {} };

type RecordingRow = { id: string; fingerprint: string; status: string; is_test: boolean; duration_ms: number | null };
type MomentRow = { id: string; kind: Moment["kind"]; start_ms: number; end_ms: number; peak_ms: number | null; reason: string; score: number; has_context: boolean; context_note: string | null; has_payoff: boolean; payoff_note: string | null; privacy_flags: Moment["privacyFlags"]; suggested_format: Format | null };
const MOMENT_COLUMNS = "id, kind, start_ms, end_ms, peak_ms, reason, score, has_context, context_note, has_payoff, payoff_note, privacy_flags, suggested_format";

const fromRow = (r: MomentRow): Moment => ({
  id: r.id,
  kind: r.kind,
  startMs: r.start_ms,
  endMs: r.end_ms,
  peakMs: r.peak_ms ?? Math.round((r.start_ms + r.end_ms) / 2),
  reason: r.reason,
  score: r.score,
  hasContext: r.has_context,
  contextNote: r.context_note,
  hasPayoff: r.has_payoff,
  payoffNote: r.payoff_note,
  privacyFlags: r.privacy_flags,
  suggestedFormat: r.suggested_format ?? "A",
});

const NO_KEY = "Analysedienst nog te verbinden: zet GEMINI_API_KEY in worker/.env.local en start de werker opnieuw. Alleen testdata wordt nu verwerkt.";

export function createQueue(url: string, serviceKey: string, workerName: string, store: Store, log: (msg: string) => void, ai: Ai | null = null, montage: Montage | null = null, client?: SupabaseClient, publisher: Publisher | null = null, research: Research | null = null) {
  const db: SupabaseClient = client ?? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let timer: NodeJS.Timeout | null = null;
  let busy = false;

  // Before migration 033 the live columns do not exist; then the worker works exactly as before.
  let liveReady = true;
  const liveMissing = (error: { code?: string; message: string }) => error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205" || error.code === "42P01" || /column|could not find/i.test(error.message);

  /** Progress, heartbeat (every 10 s), log and the cancel request of one running step. */
  function live(job: Job): Live {
    if (!liveReady) return NO_LIVE;
    const control = new AbortController();
    let last = 0;
    let pending: Record<string, unknown> = {};
    let writing = false;
    async function write(fields: Record<string, unknown>, force: boolean) {
      Object.assign(pending, fields);
      if (!liveReady || writing || (!force && Date.now() - last < 2000)) return;
      writing = true;
      last = Date.now();
      const update = { ...pending, heartbeat_at: new Date().toISOString() };
      pending = {};
      try {
        const { data, error } = await db.from("yt_jobs").update(update).eq("id", job.id).eq("locked_by", workerName).select("cancel_requested").maybeSingle<{ cancel_requested: boolean }>();
        if (error) {
          if (liveMissing(error)) liveReady = false;
          else log(`Voortgang van stap ${job.id} niet bijgewerkt: ${error.message}`);
        } else if (data?.cancel_requested && !control.signal.aborted) {
          log(`Stap ${job.step} wordt geannuleerd (${job.id})`);
          control.abort();
        }
      } finally {
        writing = false;
      }
    }
    const beat = setInterval(() => void write({}, true), 10_000);
    return {
      signal: control.signal,
      // A new phase starts with a clean slate: old frames or remaining time of the previous phase would mislead.
      phase: (phase, progress = null) => write({ phase: phase.slice(0, 80), progress, metrics: null }, true),
      progress: (fields) => write(fields, false),
      async event(kind, message) {
        if (!liveReady) return;
        const { error } = await db.from("yt_job_events").insert({ studio_id: job.studio_id, job_id: job.id, kind, message: message.slice(0, 500) });
        if (error && liveMissing(error)) liveReady = false;
        else if (error) log(`Logregel van stap ${job.id} niet opgeslagen: ${error.message}`);
      },
      stop: () => clearInterval(beat),
    };
  }

  /** Stops a step that Milan cancelled; its video goes back like after a failed montage. */
  async function finishCancelled(job: Job) {
    const { error } = await db
      .from("yt_jobs")
      .update({ status: "cancelled", error: "Geannuleerd", locked_by: null, locked_at: null, finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("locked_by", workerName);
    if (error) log(`Kon stap ${job.id} niet als geannuleerd opslaan: ${error.message}`);
    await afterFinalFailure(job);
  }

  /** The channel profile and game of a recording: KIVOXEL is always Minecraft, SpawnNado takes the game from the label. */
  async function recordingGameInfo(recordingId: string | null, studioId: string): Promise<{ profile: ChannelProfile; game: GameId; label: string | null }> {
    if (!recordingId) return { profile: PROFILES.kivoxel, game: "minecraft", label: null };
    const rec = await db.from("yt_recordings").select("label, channel_id").eq("id", recordingId).eq("studio_id", studioId).maybeSingle<{ label: string; channel_id: string }>();
    const ch = rec.data?.channel_id ? await db.from("yt_channels").select("name, slug").eq("id", rec.data.channel_id).maybeSingle<{ name: string; slug: string | null }>() : null;
    const profile = profileFor(ch?.data);
    return { profile, game: recordingGame(rec.data?.label, profile), label: rec.data?.label ?? null };
  }

  /** The Minecraft HUD signals (hearts, menus, death screen) only count in Minecraft. */
  async function hudOf(recordingId: string | null, studioId: string): Promise<"minecraft" | "none"> {
    return (await recordingGameInfo(recordingId, studioId)).game === "minecraft" ? "minecraft" : "none";
  }

  async function videoGameInfo(videoId: string, studioId: string) {
    const v = await db.from("yt_videos").select("recording_id").eq("id", videoId).maybeSingle<{ recording_id: string | null }>();
    return recordingGameInfo(v.data?.recording_id ?? null, studioId);
  }

  async function videoGame(videoId: string, studioId: string): Promise<GameId> {
    return (await videoGameInfo(videoId, studioId)).game;
  }

  async function recordingRow(job: Job) {
    if (!job.recording_id) throw new Error("Deze stap hoort niet bij een opname");
    const { data, error } = await db.from("yt_recordings").select("id, fingerprint, status, is_test, duration_ms").eq("id", job.recording_id).eq("studio_id", job.studio_id).single<RecordingRow>();
    if (error) throw new Error(error.message);
    return data;
  }

  async function saveRecording(id: string, local: LocalRecording) {
    const p = local.probe;
    const { error } = await db
      .from("yt_recordings")
      .update({
        sha256: local.sha256,
        status: local.intakeError ? "failed" : "ready",
        error: local.intakeError,
        duration_ms: p?.durationMs ?? null,
        width: p?.width ?? null,
        height: p?.height ?? null,
        fps: p?.fps ?? null,
        video_codec: p?.videoCodec ?? null,
        audio_codec: p?.audioCodec ?? null,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  /** Intake: the file must be on this pc; then ffprobe reads length, size and codecs. */
  async function intake(job: Job) {
    const row = await recordingRow(job);
    const local = await store.get(row.fingerprint);
    if (!local) throw new Error("Het bestand staat niet op deze pc");
    const done = local.probe ? local : await store.intake(row.fingerprint);
    await saveRecording(row.id, done);
    if (done.intakeError) throw new Error(done.intakeError);
    // Test data goes straight on to the free test analysis; real footage only when paid processing is switched on.
    if (row.is_test || (ai && (await paidEnabled(job.studio_id)))) await queueStep(job.studio_id, { recording_id: row.id, step: "analyse", idempotency_key: `analyse:${row.id}` });
    return { durationMs: done.probe?.durationMs ?? null, width: done.probe?.width ?? null, height: done.probe?.height ?? null };
  }

  async function queueStep(studioId: string, fields: Record<string, unknown>) {
    const { error } = await db.from("yt_jobs").insert({ studio_id: studioId, ...fields });
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  async function paidEnabled(studioId: string): Promise<boolean> {
    const { data } = await db.from("yt_settings").select("paid_processing_enabled").eq("studio_id", studioId).maybeSingle<{ paid_processing_enabled: boolean }>();
    return data?.paid_processing_enabled === true;
  }

  /** Before a paid call: refused by the database when paid processing is off or the monthly cap would be passed. */
  async function reserve(job: Job, estimateCents: number) {
    const { error } = await db.rpc("reserve_yt_cost", { p_studio: job.studio_id, p_job: job.id, p_category: "analysis", p_service: `Gemini ${ai?.gemini.model}`, p_estimate_cents: estimateCents });
    if (error) throw new Error(error.message);
  }

  /** After a paid call: replace the estimate with what it really cost (a retry of the same step adds to it). */
  async function settle(job: Job, usage: Usage) {
    const cents = costCents(usage);
    const { data, error } = await db.from("yt_costs").select("id, amount_cents, is_estimate").eq("job_id", job.id).eq("category", "analysis").maybeSingle<{ id: string; amount_cents: number; is_estimate: boolean }>();
    if (error || !data) return log(`Kosten van stap ${job.id} niet vastgelegd: ${error?.message ?? "geen reservering"}`);
    const amount = data.is_estimate ? cents : data.amount_cents + cents;
    const description = `${usage.inputTokens} invoer- en ${usage.outputTokens} uitvoertokens`;
    const upd = await db.from("yt_costs").update({ amount_cents: amount, is_estimate: false, description }).eq("id", data.id);
    if (upd.error) log(`Kosten van stap ${job.id} niet bijgewerkt: ${upd.error.message}`);
  }

  /** Runs a paid call and always records what it used, also when the answer turns out to be unusable. */
  async function paid<T extends { usage: Usage }>(job: Job, call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      await settle(job, result.usage);
      return result;
    } catch (e) {
      const usage = (e as { usage?: Usage }).usage;
      if (usage) await settle(job, usage);
      throw e;
    }
  }

  async function aiMoments(job: Job, row: RecordingRow & { duration_ms: number }, lv: Live = NO_LIVE): Promise<{ moments: Moment[]; rejected: string[] }> {
    if (!ai) throw new Error(NO_KEY);
    if (row.duration_ms > MAX_ANALYSIS_MS) throw new Error(`Opname is te lang voor één analyse (${formatTimecode(row.duration_ms)}; maximaal ${formatTimecode(MAX_ANALYSIS_MS)}). Splits de opname.`);
    const local = await store.get(row.fingerprint);
    if (!local) throw new Error("Het bestand staat niet op deze pc");
    await reserve(job, estimateAnalysisCents(row.duration_ms));
    // Fase 3: free signals first. They make the prompt sharper and drop moments in dead parts. A failure here never blocks the analysis.
    let timeline: Timeline | null = null;
    if (ai.signals) {
      await lv.phase("Beeld en geluid nalopen (stilstand, laadschermen, harde geluiden)", 0);
      try {
        timeline = buildTimeline(await ai.signals(local.file, row.fingerprint, row.duration_ms, { signal: lv.signal }));
        const summary = timelineSummary(timeline, row.duration_ms);
        log(`Signalen ${row.fingerprint.slice(0, 8)}: ${summary}`);
        await lv.event("note", `Signalen: ${summary}`);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        log(`Signalen niet gelukt, analyse gaat zonder: ${e instanceof Error ? e.message : "onbekend"}`);
      }
    }
    const hints = timeline ? signalHints(timeline) : "";
    // Progress (fase E3): the proxy is measured by FFmpeg; Gemini only tells which stage it is in, the thinking time is an estimate.
    await lv.phase(ANALYSIS_STAGES.proxy.label, 0);
    const proxyStart = Date.now();
    const proxy = await ai.makeProxy(local.file, row.fingerprint, row.duration_ms, {
      signal: lv.signal,
      onProgress: (snap) => {
        const p = renderProgress(snap, row.duration_ms, Date.now() - proxyStart);
        void lv.progress({ progress: stageProgress("proxy", p.progress ?? 0), metrics: { eta_ms: p.etaMs, speed: snap.speed } });
      },
    });
    // Fase C: a long recording goes in parts of about 8 minutes, so the times Gemini gives stay exact.
    const chunks = ai.cutProxy ? analysisChunks(row.duration_ms) : [{ index: 0, count: 1, startMs: 0, endMs: row.duration_ms }];
    const found: Moment[][] = [];
    const rejected: string[] = [];
    let answered = 0;
    // SpawnNado (several games): the game comes from the label; without one the analysis says which game it sees.
    const gi = await recordingGameInfo(row.id, job.studio_id);
    const detect = gi.profile.games.length > 1 && !gameInText(gi.label, gi.profile) ? gi.profile.games : undefined;
    let detected: unknown = null;
    let timer: NodeJS.Timeout | null = null;
    try {
      for (const chunk of chunks) {
        if (lv.signal.aborted) throw new CancelledError();
        const many = chunk.count > 1;
        const lengthMs = chunk.endMs - chunk.startMs;
        const label = many ? ` (deel ${chunk.index + 1} van ${chunk.count})` : "";
        const file = many && ai.cutProxy ? await ai.cutProxy(proxy, chunk.startMs, lengthMs, { signal: lv.signal }) : proxy;
        try {
          const expected = expectedThinkingMs(lengthMs);
          const partHints = timeline ? signalHints(timeline, many ? chunk : undefined) : hints;
          const prompt = analysisPrompt(row.duration_ms, chunk, { game: gi.game, detect });
          const { json } = await paid(job, () =>
            ai.gemini.analyseVideo(file, partHints ? `${prompt}\n${partHints}` : prompt, (stage) => {
              void lv.phase(`${ANALYSIS_STAGES[stage].label}${label}`, stageProgress(stage, 0));
              if (stage === "thinking") {
                const started = Date.now();
                if (timer) clearInterval(timer);
                timer = setInterval(() => {
                  const elapsed = Date.now() - started;
                  void lv.progress({ progress: stageProgress("thinking", thinkingShare(elapsed, expected)), metrics: { eta_ms: Math.max(0, expected - elapsed), estimate: 1 } });
                }, 2000);
              }
            }),
          );
          if (timer) clearInterval(timer);
          const parsed = parseAnalysis(json, row.duration_ms, chunk);
          detected ??= (json as { game?: unknown } | null)?.game ?? null;
          answered += 1;
          found.push(parsed.moments);
          rejected.push(...parsed.rejected);
          if (many) await lv.event("note", `Deel ${chunk.index + 1} van ${chunk.count}: ${parsed.moments.length} momenten`);
        } finally {
          if (file !== proxy) await ai.removeProxy(file);
        }
      }
      if (detect && detected) {
        // The game goes in front of the label ("Fortnite · ..."), so the script, tags and Milan all see it.
        const label = labelWithGame(gi.label ?? "", recordingGame(null, gi.profile, detected), gi.profile);
        if (label && label !== gi.label) await db.from("yt_recordings").update({ label }).eq("id", row.id);
        await lv.event("note", `Game herkend: ${GAMES[recordingGame(null, gi.profile, detected)].name}`);
      }
      await lv.phase("Momenten opslaan en formats plannen", 0.98);
      const merged = { moments: mergeMoments(found), rejected };
      if (!merged.moments.length && rejected.length && answered) throw new Error(`Antwoord van de analysedienst onbruikbaar: ${rejected.slice(0, 3).join("; ")}`);
      return timeline ? dropDead(merged, timeline) : merged;
    } finally {
      if (timer) clearInterval(timer);
      await ai.removeProxy(proxy);
    }
  }

  /** Analyse: find moments with timecodes, check context and payoff, plan the videos and queue a script per video. */
  async function analyse(job: Job, lv: Live = NO_LIVE) {
    const row = await recordingRow(job);
    if (row.status !== "ready" || !row.duration_ms) throw new Error("De intake van deze opname is nog niet klaar");
    const durationMs = row.duration_ms;
    // Plan again from the moments already found (free, no new analysis): for example to tell a long recording in parts.
    if (job.payload?.replan === true) {
      const stored = await db.from("yt_moments").select(MOMENT_COLUMNS).eq("recording_id", row.id).eq("studio_id", job.studio_id).order("start_ms").returns<MomentRow[]>();
      if (stored.error) throw new Error(stored.error.message);
      if (!stored.data.length) throw new Error("Deze opname heeft nog geen momenten: analyseer hem eerst");
      const moments = stored.data.map(fromRow);
      const videos = await planAndQueue(job, row.id, row.is_test, durationMs, moments);
      return { moments: moments.length, usable: moments.filter((m) => m.hasContext && m.hasPayoff).length, videos, source: "replan", rejected: [] as string[] };
    }
    // KIVOXEL fase 1, section 8: without a key, without credits, with the service down or in free mode, the moments
    // come from the free Event Timeline instead of the paid analysis.
    // A holder object: the closure below changes it (a plain variable would be narrowed by TypeScript).
    const used: { engine: "test" | "ai" | "free"; note: string | null } = { engine: row.is_test ? "test" : "ai", note: null };
    const freeAnalysis = async (why: string) => {
      const local = await store.get(row.fingerprint);
      if (!local || !montage?.events) throw new Error(`${why}; de gratis analyse kan hier niet (geen FFmpeg of bestand)`);
      const hud = await hudOf(row.id, job.studio_id);
      await lv.phase(hud === "minecraft" ? "Gratis analyse: hartjes, doodscherm, klappen en harde geluiden" : "Gratis analyse: beweging, klappen en harde geluiden", 0);
      const t = await montage.events.timeline(row.fingerprint, local.file, durationMs, { hud, signal: lv.signal, onFrames: (n) => void lv.progress({ progress: Math.min(0.99, n / Math.max(1, (durationMs / 1000) * 4)), metrics: {} }) });
      used.engine = "free";
      used.note = why;
      await lv.event("note", `${why}: momenten uit de gratis analyse (${t.events.length} events)`);
      return { moments: momentsFromTimeline(t, durationMs), rejected: [] as string[] };
    };
    const wantsFreeAnalysis = job.payload?.engine === "free" || presetFile.channel_default.engine === "free";
    let result: { moments: Moment[]; rejected: string[] };
    if (row.is_test) result = { moments: testMoments(row.duration_ms), rejected: [] };
    else if (wantsFreeAnalysis) result = await freeAnalysis("Gratis modus");
    else if (!ai) result = await freeAnalysis("Geen analysedienst (GEMINI_API_KEY ontbreekt)");
    else {
      try {
        result = await aiMoments(job, { ...row, duration_ms: row.duration_ms }, lv);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        // Credits gone, budget cap reached, key refused or the service is down: carry on for free.
        result = await freeAnalysis(`Analysedienst niet beschikbaar (${e instanceof Error ? e.message.slice(0, 120) : "onbekend"})`);
      }
    }
    const { moments: found, rejected } = result;
    // yt_moments.source only knows test/ai/manual (migration 009); the free engine is recorded in "model".
    const source = row.is_test ? "test" : "ai";
    const rows = found.map((m) => ({
      studio_id: job.studio_id,
      recording_id: row.id,
      analysis_job_id: job.id,
      kind: m.kind,
      start_ms: m.startMs,
      end_ms: m.endMs,
      peak_ms: m.peakMs,
      reason: m.reason,
      score: m.score,
      has_context: m.hasContext,
      context_note: m.contextNote,
      has_payoff: m.hasPayoff,
      payoff_note: m.payoffNote,
      privacy_flags: m.privacyFlags,
      suggested_format: m.suggestedFormat,
      source,
      model: row.is_test ? null : used.engine === "free" ? FREE_ENGINE_MODEL : (ai?.gemini.model ?? null),
      is_test: row.is_test,
    }));
    const saved = await db.from("yt_moments").upsert(rows, { onConflict: "studio_id,recording_id,kind,start_ms" }).select(MOMENT_COLUMNS).returns<MomentRow[]>();
    if (saved.error) throw new Error(saved.error.message);
    const moments = saved.data.map(fromRow);
    // A new analysis of the same recording (fase C): earlier moments that no video uses are removed, so only this
    // analysis counts. Moments a video already uses stay (that video keeps its plan).
    const older = await db.from("yt_moments").select("id").eq("recording_id", row.id).neq("analysis_job_id", job.id).returns<{ id: string }[]>();
    if (!older.error && older.data.length) {
      const ids = older.data.map((m) => m.id);
      const used = await db.from("yt_video_moments").select("moment_id").in("moment_id", ids).returns<{ moment_id: string }[]>();
      const keep = new Set((used.data ?? []).map((u) => u.moment_id));
      const stale = ids.filter((id) => !keep.has(id) && !moments.some((m) => m.id === id));
      if (!used.error && stale.length) {
        const removed = await db.from("yt_moments").delete().in("id", stale);
        if (removed.error) log(`Oude momenten van opname ${row.id} niet opgeruimd: ${removed.error.message}`);
      }
    }

    // KIVOXEL fase 1: the Event Timeline (when what happens), free signals plus these moments. Never blocks the analysis.
    let events: { events: number; top: string[] } | null = null;
    // The free analysis built the timeline already; merging its own moments back in would count them twice.
    if (!row.is_test && montage?.events && used.engine !== "free") {
      try {
        await lv.phase("Event Timeline maken (hartjes, doodscherm, geluidspieken)", 0);
        const local = await store.get(row.fingerprint);
        if (local) {
          const t = await montage.events.timeline(row.fingerprint, local.file, durationMs, { moments, hud: await hudOf(row.id, job.studio_id), signal: lv.signal, onFrames: (n) => void lv.progress({ progress: Math.min(0.99, n / Math.max(1, (durationMs / 1000) * 4)), metrics: {} }) });
          events = { events: t.events.length, top: topPayoffs(t, 3).map((e) => `${formatTimecode(e.t_peak)} ${e.description}`) };
          await lv.event("note", `Event Timeline: ${t.events.length} events${events.top.length ? `, beste: ${events.top.join("; ")}` : ""}`);
        }
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        await lv.event("error", `Event Timeline niet gelukt: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 23-11-2026, viral check before the montage: the strongest moments of the recording, judged by the producer gate.
    let candidates: ReturnType<typeof rankCandidates> | null = null;
    if (!row.is_test && montage?.events) {
      const t = await montage.events.cached(row.fingerprint, await hudOf(row.id, job.studio_id)).catch(() => null);
      if (t) {
        candidates = rankCandidates(t);
        await lv.event("note", candidates.enough ? `Kandidaten: ${candidates.candidates.filter((c) => c.status !== "AFGEKEURD").length} van ${candidates.candidates.length} verdienen een montage` : "Onvoldoende basis: geen moment in deze opname haalt de producer-poort");
      }
    }
    const videos = await planAndQueue(job, row.id, row.is_test, durationMs, moments);
    return { candidates, moments: moments.length, usable: moments.filter((m) => m.hasContext && m.hasPayoff).length, videos, source, rejected, events, engine: used.engine, engineNote: used.note };
  }

  /**
   * 20-11-2026: what viewers really watched, per kind of moment, for the channel of this recording (see learnedKinds.ts).
   * Uses the stats the worker already collects (no AI, no extra YouTube calls). Never stops an analysis: no data = no boost.
   */
  async function learnedBoosts(studioId: string, recordingId: string): Promise<KindBoost[]> {
    try {
      const rec = await db.from("yt_recordings").select("channel_id").eq("id", recordingId).maybeSingle<{ channel_id: string | null }>();
      const snaps = await db.from("yt_video_snapshots").select("video_id, views, avg_view_pct, taken_at").eq("studio_id", studioId).not("video_id", "is", null).not("avg_view_pct", "is", null).order("taken_at", { ascending: false }).limit(3000).returns<{ video_id: string; views: number; avg_view_pct: number }[]>();
      if (snaps.error || !snaps.data?.length) return [];
      const latest = new Map<string, { views: number; pct: number }>();
      for (const r of snaps.data) if (!latest.has(r.video_id)) latest.set(r.video_id, { views: r.views, pct: Number(r.avg_view_pct) });
      const ids = [...latest.keys()];
      type ShortRow = { id: string; channel_id: string | null; format: string; yt_video_moments: { yt_moments: { kind: Moment["kind"] } | null }[] };
      const rows: ShortRow[] = [];
      // In portions of 150 ids, so the request stays short.
      for (let i = 0; i < ids.length; i += 150) {
        const part = await db.from("yt_videos").select("id, channel_id, format, yt_video_moments(yt_moments(kind))").in("id", ids.slice(i, i + 150)).in("format", ["A", "B"]).returns<ShortRow[]>();
        if (part.error) return [];
        rows.push(...(part.data ?? []));
      }
      // Only Shorts of the same channel: KIVOXEL and SpawnNado viewers watch differently.
      const samples: KindSample[] = [];
      for (const v of rows) {
        if (rec.data?.channel_id && v.channel_id !== rec.data.channel_id) continue;
        const kind = v.yt_video_moments?.map((x) => x.yt_moments?.kind).find(Boolean);
        const s = latest.get(v.id);
        if (kind && s) samples.push({ kind, avgViewPct: s.pct, views: s.views });
      }
      return kindBoosts(samples);
    } catch {
      return [];
    }
  }

  /** Plans the videos of a recording and queues a script per video; returns how many videos were planned. */
  async function planAndQueue(job: Job, recordingId: string, isTest: boolean, durationMs: number, moments: Moment[]): Promise<number> {
    const boosts = isTest ? [] : await learnedBoosts(job.studio_id, recordingId);
    const learned = boostsSummary(boosts);
    if (learned) log(`Keuze van Shorts weegt mee wat kijkers uitkeken: ${learned}`);
    let plans = planVideos(moments, durationMs, (m) => m.id ?? `${m.kind}:${m.startMs}`, (m) => boostOf(boosts, m.kind));
    // Parts that already exist stay as they are: a new analysis must not start a second, differently cut series.
    if (plans.some((p) => p.part)) {
      const parts = await db.from("yt_videos").select("id").eq("studio_id", job.studio_id).eq("recording_id", recordingId).like("plan_key", `${recordingId}:C:part:%`).neq("status", "archived").limit(1).returns<{ id: string }[]>();
      if (parts.error) throw new Error(parts.error.message);
      if (parts.data.length) plans = plans.filter((p) => !p.part);
    }
    for (const plan of plans) {
      const planKey = `${recordingId}:${plan.planKey}`;
      const insert = await db.from("yt_videos").upsert({ studio_id: job.studio_id, recording_id: recordingId, format: plan.format, plan_key: planKey, promise: plan.promise, is_test: isTest }, { onConflict: "studio_id,plan_key", ignoreDuplicates: true });
      if (insert.error) throw new Error(insert.error.message);
      const video = await db.from("yt_videos").select("id").eq("studio_id", job.studio_id).eq("plan_key", planKey).single<{ id: string }>();
      if (video.error) throw new Error(video.error.message);
      const links = plan.moments.map((m, position) => ({ studio_id: job.studio_id, video_id: video.data.id, moment_id: m.id, position }));
      const linked = await db.from("yt_video_moments").upsert(links, { onConflict: "video_id,moment_id", ignoreDuplicates: true });
      if (linked.error) throw new Error(linked.error.message);
      await queueStep(job.studio_id, { video_id: video.data.id, step: "script", idempotency_key: `script:${video.data.id}:v1`, payload: { version: 1 } });
    }
    return plans.length;
  }

  /** Fase C: Milan's comment on the newest earlier version, so the new version changes only what he asks. */
  async function previousFeedback(job: Job, videoId: string, version: number): Promise<ScriptFeedback | null> {
    const note = typeof job.payload?.note === "string" ? job.payload.note.trim().slice(0, 500) : "";
    if (!note || version < 2) return null;
    const prev = await db.from("yt_scripts").select("hook, top_line, lines").eq("video_id", videoId).lt("version", version).order("version", { ascending: false }).limit(1).maybeSingle<{ hook: string; top_line: string | null; lines: ScriptLine[] }>();
    if (prev.error || !prev.data) return null;
    return { note, previous: { hook: prev.data.hook, topLine: prev.data.top_line, lines: prev.data.lines } };
  }

  /** KIVOXEL fase 1: the length bucket of the Short made just before this one from the same recording (batch order). */
  async function previousShortBucket(studioId: string, video: { id: string; recording_id: string | null; created_at?: string }, s: ReturnType<typeof resolveSettings>): Promise<string | null> {
    if (!video.recording_id || !video.created_at) return null;
    const prev = await db.from("yt_videos").select("id").eq("studio_id", studioId).eq("recording_id", video.recording_id).neq("format", "C").neq("id", video.id).lt("created_at", video.created_at).order("created_at", { ascending: false }).limit(1).returns<{ id: string }[]>();
    const prevId = prev.data?.[0]?.id;
    if (prev.error || !prevId) return null;
    const sc = await db.from("yt_scripts").select("target_ms").eq("video_id", prevId).order("version", { ascending: false }).limit(1).returns<{ target_ms: number }[]>();
    const ms = sc.data?.[0]?.target_ms;
    return typeof ms === "number" ? (bucketOf(ms, s.shorts.length_buckets)?.key ?? null) : null;
  }

  /** KIVOXEL fase 1: the hooks (top line) of the latest Shorts in the studio, oldest first; never fails the script. */
  async function recentShortHooks(studioId: string, exceptVideo: string): Promise<string[]> {
    const r = await db.from("yt_scripts").select("video_id, top_line, yt_videos!inner(format)").eq("studio_id", studioId).neq("video_id", exceptVideo).neq("yt_videos.format", "C").order("created_at", { ascending: false }).limit(60).returns<{ video_id: string; top_line: string | null }[]>();
    if (r.error || !Array.isArray(r.data)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of r.data) {
      if (seen.has(row.video_id) || !row.top_line) continue;
      seen.add(row.video_id);
      out.push(row.top_line);
      if (out.length === 10) break;
    }
    return out.reverse();
  }

  /** Script: hook, top line, narration and edit plan with timecodes for one video, as a new version. */
  async function script(job: Job) {
    if (!job.video_id) throw new Error("Deze stap hoort niet bij een video");
    const version = Number(job.payload?.version ?? 1);
    if (!Number.isInteger(version) || version < 1) throw new Error("Ongeldige versie");
    type VideoRow = { id: string; recording_id: string | null; format: Format; language: "en" | "nl"; is_test: boolean; status: string; promise: string | null; plan_key: string | null; created_at?: string; channel_id?: string | null };
    const video = await db.from("yt_videos").select("id, recording_id, format, language, is_test, status, promise, plan_key, created_at, channel_id").eq("id", job.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
    if (video.error) throw new Error(video.error.message);
    const linked = await db.from("yt_video_moments").select(`position, yt_moments(${MOMENT_COLUMNS})`).eq("video_id", video.data.id).order("position").returns<Array<{ position: number; yt_moments: MomentRow }>>();
    if (linked.error) throw new Error(linked.error.message);
    const moments = linked.data.map((l) => fromRow(l.yt_moments));
    if (!moments.length) throw new Error("Deze video heeft geen momenten");
    // The length of the recording lets the plan take build-up and outcome from just outside the moment.
    const rec = video.data.recording_id ? await db.from("yt_recordings").select("duration_ms").eq("id", video.data.recording_id).maybeSingle<{ duration_ms: number | null }>() : null;
    // One part of a story told in parts: its range comes from the plan key, the neighbours from the recording's other moments.
    const part = video.data.format === "C" ? parseSeriesKey(video.data.plan_key) : null;
    let series: SeriesContext | undefined;
    if (part && video.data.recording_id) {
      const all = await db.from("yt_moments").select(MOMENT_COLUMNS).eq("recording_id", video.data.recording_id).eq("studio_id", job.studio_id).order("start_ms").returns<MomentRow[]>();
      if (all.error) throw new Error(all.error.message);
      const others = all.data.map(fromRow);
      series = { part, previous: others.filter((m) => m.peakMs < part.startMs).slice(-2), next: others.filter((m) => m.peakMs >= part.endMs).slice(0, 2) };
    }
    const game = (await recordingGameInfo(video.data.recording_id, job.studio_id)).game;
    let plan = buildEditPlan(video.data.format, moments, rec?.data?.duration_ms ?? undefined, part);
    let draft: ScriptDraft;
    let grounding: Record<string, unknown> | null = null;
    let shortInfo: { bucket: string; reason: string; cutMs: number; hook: string; hookRepeated: boolean } | null = null;
    let longCutMsOut = 0;
    let learnedFrom = 0;
    /** 23-11-2026: set when Milan's feedback asked for another moment (see the Short planning below). */
    let newMoment: { from: number; to: number | null; why: string } | null = null;
    /** 23-11-2026: the producer gate's verdict on the moment of this Short. */
    let producer: GateResult | null = null;
    /** 23-11-2026: lessons from Milan's rejections that this script got (and the hypotheses that it did not). */
    let lessons: Lesson[] = [];
    // KIVOXEL fase 1: "ai" = Gemini writes the lines, "free" = the template engine (no credits needed).
    let engine: "test" | "ai" | "free" = "test";
    let engineNote: string | null = null;
    if (video.data.is_test) draft = testScript(plan, moments);
    else if (job.payload?.assess === true) {
      // Studio 2.0 keuring: only look at the material (no script written), to sort the library into strong and weak.
      if (!ai) throw new Error(NO_KEY);
      const evidence = await gatherEvidence(job, video.data.recording_id, plan.segments, false);
      if (!evidence) throw new Error("Keuren kan alleen met de opname op deze pc");
      await reserve(job, 2);
      const ev0 = await describeEvidence(job, evidence, game);
      return { assess: true, frames: evidence.frames.length, strength: contentStrength(ev0), summary: ev0.summary, uncertain: ev0.uncertain };
    } else {
      const kSettings = resolveSettings(typeof job.payload?.preset === "string" ? job.payload.preset : null);
      const wantsFree = job.payload?.engine === "free" || presetFile.channel_default.engine === "free";
      const short = video.data.format !== "C";
      // The Event Timeline of the recording (free; built once and kept on this pc).
      let timeline: EventTimeline | null = null;
      if (montage?.events && video.data.recording_id) {
        const recRow = await db.from("yt_recordings").select("fingerprint").eq("id", video.data.recording_id).maybeSingle<{ fingerprint: string }>();
        const local = recRow.data ? await store.get(recRow.data.fingerprint) : null;
        if (local?.probe?.durationMs) timeline = await montage.events.timeline(recRow.data!.fingerprint, local.file, local.probe.durationMs, { hud: game === "minecraft" ? "minecraft" : "none" }).catch(() => null);
      }
      const recent = (await montage?.phrases?.recent().catch(() => [] as string[])) ?? [];
      // Long video (section 7.2): menus, standing still and black screens out of every piece, before the script is written.
      let longCutMs = 0;
      if (!short && timeline && kSettings.features.cut_dead_air) {
        const cd = cutDeadInPlan(plan.segments, timeline);
        const total = cd.segments.reduce((sum, sg) => sum + Math.round((sg.src_end_ms - sg.src_start_ms) / sg.speed), 0);
        if (cd.segments.length && total > 0) {
          plan = { ...plan, segments: cd.segments, targetMs: total };
          longCutMs = cd.cutMs;
        }
      }
      longCutMsOut = longCutMs;
      // KIVOXEL fase 1, sections 5 and 6: a Short gets its length from the content and a hook from the library.
      let shortEvent: GameEvent | null = null;
      let shortHook: string | null = null;
      if (short && timeline?.events.length) {
        const main = moments[0];
        let near = timeline.events.filter((e) => Math.abs(e.t_peak - main.peakMs) <= 6000).sort((a, b) => (b.type ? 1 : 0) - (a.type ? 1 : 0) || b.payoff - a.payoff)[0];
        // 23-11-2026, Milan's feedback "verkeerde clip" / "zwakke opening": search the recording again for the strongest
        // other moment, never one another video of this recording already uses (and never the rejected one).
        if (job.payload?.new_moment === true && video.data.recording_id) {
          const others = await db.from("yt_videos").select("id, status, yt_video_moments(yt_moments(peak_ms, start_ms, end_ms))").eq("recording_id", video.data.recording_id).neq("id", video.data.id).neq("status", "archived").returns<{ id: string; status: string; yt_video_moments: { yt_moments: { peak_ms: number | null; start_ms: number; end_ms: number } | null }[] }[]>();
          const used = [main.peakMs, ...(others.data ?? []).flatMap((o) => o.yt_video_moments.map((m) => m.yt_moments?.peak_ms ?? (m.yt_moments ? Math.round((m.yt_moments.start_ms + m.yt_moments.end_ms) / 2) : null)).filter((x): x is number => x !== null))];
          // Only a moment the producer gate would not reject (gameplay at the peak and in the outcome).
          const alt = timeline.events.filter((e) => e.type && e.payoff >= 40 && used.every((p) => Math.abs(p - e.t_peak) > 15_000) && producerGate({ event: e, timeline: timeline!, sourceOnPc: true }).status !== "AFGEKEURD").sort((a, b) => b.payoff - a.payoff)[0];
          if (alt) {
            newMoment = { from: main.peakMs, to: alt.t_peak, why: alt.description };
            near = alt;
          } else newMoment = { from: main.peakMs, to: null, why: "Geen ander sterk moment in deze opname: hetzelfde moment, nieuwe montage." };
        }
        shortEvent = near ?? { id: `moment-${main.peakMs}`, kind: "ai_moment", type: eventTypeForMoment(main.kind), t_start: main.startMs, t_peak: main.peakMs, t_end: main.endMs, intensity: main.score / 100, payoff: main.score, description: main.reason, t_thumb: main.peakMs, sources: [`ai:${main.kind}`] };
        // 23-11-2026, producer gate: does this moment earn a script and a montage? AFGEKEURD = no production time
        // (archived with the reason); Milan's own re-montage request still goes through, with the warning kept.
        producer = producerGate({ event: shortEvent, timeline, sourceOnPc: true });
        if (producer.status === "AFGEKEURD" && job.payload?.remontage !== true && !job.payload?.feedback) {
          const note = `Producer: AFGEKEURD — ${producer.summary}${producer.directions.length ? ` Richting: ${producer.directions[0]}` : ""}`.slice(0, 500);
          await db.from("yt_videos").update({ status: "archived", review_note: note }).eq("id", video.data.id).in("status", ["idea", "scripted"]);
          return { version, producer, archived: true };
        }
        const previousBucket = await previousShortBucket(job.studio_id, video.data, kSettings);
        const sp = planShort(shortEvent, timeline, kSettings, seeded(`${video.data.id}:len:${version}`), previousBucket);
        plan = { segments: sp.segments, targetMs: sp.targetMs, warnings: [...plan.warnings.filter((w) => !/lengte|duur|seconden/i.test(w))] };
        const recentHooks = await recentShortHooks(job.studio_id, video.data.id);
        const h = chooseHook(shortEvent.type ?? eventTypeForMoment(main.kind), recentHooks, seeded(`${video.data.id}:hook:${version}`), kSettings.hooks.no_repeat_within, game === "minecraft" ? hookFile : { ...hookFile, hooks: Object.fromEntries(Object.entries(hookFile.hooks).map(([k, v]) => [k, forGame(v, game)])) as typeof hookFile.hooks }, shortEvent.kind === "death");
        shortHook = h.hook;
        shortInfo = { bucket: sp.bucket, reason: sp.reason, cutMs: sp.cutMs, hook: h.hook, hookRepeated: h.repeated };
      }
      // Section 8: the scripts Milan approved teach the free engine (their generic lines join the pools).
      const approved = await db.from("yt_scripts").select("top_line, lines").eq("studio_id", job.studio_id).eq("status", "approved").order("created_at", { ascending: false }).limit(40).returns<ApprovedScript[]>();
      const learned = approved.error ? undefined : learnFrom(approved.data ?? []);
      learnedFrom = learned?.from ?? 0;
      const free = () => {
        const f = freeScript({ segments: plan.segments, targetMs: plan.targetMs, timeline, language: VIDEO_LANGUAGE, settings: kSettings, seed: `${video.data.id}:${version}`, recent, short, learned, game });
        const overlay = shortHook ?? pick(hookFile.hooks[f.mainType], recent, seeded(`${video.data.id}:hook:${version}`));
        void montage?.phrases?.add([...f.used, overlay]).catch(() => {});
        return { topLine: overlay, hook: f.hook, lines: f.lines, hooks: [], loopLine: null, titles: [] } satisfies ScriptDraft;
      };
      // The hook at the top comes from the library (fits the real event, not used in the last 10 Shorts).
      const withShortHook = (d: ScriptDraft): ScriptDraft => (shortHook ? { ...d, topLine: shortHook, hooks: d.hooks.map((h) => ({ ...h, overlay: shortHook! })) } : d);
      // Milan's own story of the whole recording (payload.story): the arc and the mood for every part.
      const story = typeof job.payload?.story === "string" ? job.payload.story : "";
      const storyText = story.trim() ? "\n" + storyBlock(story, part ?? undefined).join("\n") : "";
      if (wantsFree || !ai) {
        draft = free();
        engine = "free";
        engineNote = wantsFree ? "Gratis modus: script uit de sjabloon-engine" : "Geen analysedienst: script uit de gratis sjabloon-engine";
      } else {
        try {
          // KIVOXEL fase 1, section 1: every line hangs on an event of the timeline and goes through the sync gate.
          // Section 1a "frame description": frames of the real recording (free) are described by Gemini, and those facts
          // go into the anticipation prompt, so the hints are true (Studio 2.0) AND come before the action (fase 1).
          const evidence = job.payload?.grounded === false ? null : await gatherEvidence(job, video.data.recording_id, plan.segments, video.data.format === "C");
          await reserve(job, 2 + (evidence ? evidenceBatches(evidence.frames).length : 0));
          const feedback = await previousFeedback(job, video.data.id, version);
          let facts = "";
          if (evidence) {
            const ev = await describeEvidence(job, evidence, game);
            let edit: { removedMs: number; zooms: number } | null = null;
            // Without an Event Timeline the frames cut the idle stretches (Studio 2.0 editor); with one the timeline already did.
            const polished = timeline || job.payload?.polish === false ? null : polishPlan(plan.segments, evidence.frames, ev, video.data.format, video.data.plan_key);
            if (polished) {
              plan.segments = polished.segments;
              plan.targetMs = totalMs(polished.segments);
              edit = { removedMs: polished.removedMs, zooms: polished.zooms };
              facts = evidenceFacts(polished.evidence, polished.frames);
            } else facts = evidenceFacts(ev, evidence.frames);
            grounding = { frames: evidence.frames.length, summary: ev.summary, uncertain: ev.uncertain, strength: contentStrength(ev), mode: "anticipation", edit };
          }
          // Packaging (hooks, titles, top line) with the same facts; the lines themselves come from the anticipation prompt.
          const { json } = await paid(job, () => ai.gemini.generateText(scriptPrompt(video.data.format, video.data.promise, moments, plan, VIDEO_LANGUAGE, feedback ?? undefined, series, game) + facts + storyText));
          const parsed = parseScript(json, plan.targetMs);
          if ("error" in parsed) throw new Error(`Script van de analysedienst onbruikbaar: ${parsed.error}`);
          draft = withShortHook(parsed.draft);
          engine = "ai";
          // 23-11-2026: lessons from Milan's rejections of this channel and format (rules only when seen at least twice).
          try {
            const since = new Date(Date.now() - 60 * 24 * 3_600_000).toISOString();
            const rej = await db.from("yt_videos").select("id, review_note, created_at, format").eq("studio_id", job.studio_id).eq("channel_id", video.data.channel_id ?? "").not("review_note", "is", null).gte("created_at", since).limit(200).returns<{ id: string; review_note: string; created_at: string; format: string }[]>();
            const same = (rej.data ?? []).filter((r) => (r.format === "C") === !short && r.id !== video.data.id);
            const titles = same.length ? await db.from("yt_scripts").select("video_id, top_line, titles, version").in("video_id", same.map((r) => r.id)).returns<{ video_id: string; top_line: string | null; titles?: string[] | null; version: number }[]>() : { data: [] };
            const titleOf = (id: string) => { const s = (titles.data ?? []).filter((x) => x.video_id === id).sort((a, b) => b.version - a.version)[0]; return s?.titles?.[0] ?? s?.top_line ?? "video"; };
            lessons = lessonsFrom(same.map((r) => ({ title: titleOf(r.id), note: r.review_note, at: r.created_at })));
          } catch {
            lessons = [];
          }
          const ap = anticipationPrompt({ segments: plan.segments, targetMs: plan.targetMs, game, timeline, language: VIDEO_LANGUAGE, settings: kSettings, short, recent, note: feedback?.note, evidence: facts || undefined, story: storyText || undefined, lessons: lessonPrompt(lessons) });
          const answer = await paid(job, () => ai.gemini.generateText(ap.prompt));
          const lines = parseAnticipation(answer.json, ap.ids, plan.segments, plan.targetMs, timeline);
          // Almost nothing left after the checks (17-11-2026: one line for a 6-minute video, the rest read screen text):
          // the free engine writes the lines instead of fillers alone carrying the video.
          const tooFew = "lines" in lines && lines.lines.length < Math.min(6, Math.max(2, Math.floor(plan.targetMs / 45_000)));
          if ("lines" in lines && !tooFew) {
            // The AI may leave long silences: fill them with tension lines, like the free engine does.
            const fillRnd = seeded(`${video.data.id}:fill:${version}`);
            const usedNow: string[] = [];
            const take = (options: string[]) => {
              const t = pick(options, [...recent, ...usedNow], fillRnd);
              usedNow.push(t);
              return t;
            };
            const filled = fillSilences(lines.lines, take, fillRnd, plan.targetMs);
            draft = { ...draft, lines: filled };
            void montage?.phrases?.add(filled.map((l) => l.text)).catch(() => {});
          } else {
            // Lines without events cannot pass the sync gate: the free engine writes them instead (same timeline).
            const f = free();
            draft = { ...draft, lines: f.lines };
            engineNote = `Anticipatie-regels van de AI onbruikbaar (${"error" in lines ? lines.error : `maar ${lines.lines.length} bruikbare regels`}); zinnen uit de gratis sjabloon-engine`;
          }
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          // Credits gone, key refused, the check unreadable or the service down: carry on with the free engine (section 8).
          draft = free();
          engine = "free";
          grounding = null;
          engineNote = `Analysedienst niet beschikbaar (${e instanceof Error ? e.message.slice(0, 120) : "onbekend"}); script uit de gratis sjabloon-engine`;
        }
      }
    }
    if (part && draft.titles) draft = { ...draft, titles: seriesTitles(draft.titles, part) };
    // A Short opens with the first hook by default: a greeting or a long first line goes to the back.
    if (video.data.format !== "C") draft = { ...draft, hooks: rankShortHooks(draft.hooks) };
    // Spoken English for the TTS voice: contractions instead of stiff written forms.
    draft = { ...draft, hook: naturalize(draft.hook), lines: draft.lines.map((l) => ({ ...l, text: naturalize(l.text) })), loopLine: draft.loopLine ? naturalize(draft.loopLine) : draft.loopLine, hooks: draft.hooks.map((h) => ({ ...h, first_line: naturalize(h.first_line) })) };
    // 20-11-2026: a Fortnite/Roblox/GTA/CoD video never says "Minecraft" (titles, hooks, overlay, lines).
    const fx = (t: string) => fixGameName(t, game);
    draft = { ...draft, topLine: fixGameName(draft.topLine, game), hook: fx(draft.hook), loopLine: fixGameName(draft.loopLine, game), titles: draft.titles?.map(fx), lines: draft.lines.map((l) => ({ ...l, text: fx(l.text) })), hooks: draft.hooks.map((h) => ({ ...h, first_line: fx(h.first_line), overlay: fixGameName(h.overlay, game) })) };
    const row = {
      studio_id: job.studio_id,
      video_id: video.data.id,
      version,
      language: VIDEO_LANGUAGE,
      top_line: draft.topLine || null,
      hook: draft.hook,
      lines: draft.lines,
      edit_plan: plan.segments,
      target_ms: Math.max(1, plan.targetMs),
      // yt_scripts.source only knows test/ai (migration 009); the free engine is recorded in the job result.
      source: video.data.is_test ? "test" : "ai",
      // "gratis-engine" when the free template engine wrote it (section 9: show in the review whether the fallback was used).
      model: video.data.is_test ? null : engine === "free" ? FREE_ENGINE_MODEL : (ai?.gemini.model ?? null),
      is_test: video.data.is_test,
    };
    // Hook variants (migration 035): the first one is chosen by default, Milan can pick another in the review.
    const withHooks = draft.hooks.length ? { ...row, hooks: draft.hooks, loop_line: draft.loopLine, chosen_hook: 0 } : row;
    // Titles and Milan's comment (migration 047); without that migration the script is saved as before.
    const note = typeof job.payload?.note === "string" ? job.payload.note.trim().slice(0, 500) : "";
    const full = { ...withHooks, titles: draft.titles ?? [], ...(note ? { feedback: note } : {}) };
    let insert = await db.from("yt_scripts").upsert(full, { onConflict: "video_id,version", ignoreDuplicates: true });
    if (insert.error && liveMissing(insert.error)) insert = await db.from("yt_scripts").upsert(withHooks, { onConflict: "video_id,version", ignoreDuplicates: true });
    if (insert.error && withHooks !== row && liveMissing(insert.error)) insert = await db.from("yt_scripts").upsert(row, { onConflict: "video_id,version", ignoreDuplicates: true });
    if (insert.error) throw new Error(insert.error.message);
    if (video.data.status === "idea") {
      const upd = await db.from("yt_videos").update({ status: "scripted" }).eq("id", video.data.id).eq("status", "idea");
      if (upd.error) throw new Error(upd.error.message);
    }
    // Re-montage (Milan asked for it in bulk): this version is approved right away and the montage starts; the new
    // montage goes to his review again. Same steps as "Goedkeuren" in the review (approveConcept).
    let remontaged = false;
    if (job.payload?.remontage === true && !video.data.is_test) {
      const mine = await db.from("yt_scripts").select("id").eq("video_id", video.data.id).eq("version", version).single<{ id: string }>();
      if (mine.error) throw new Error(mine.error.message);
      const reset = await db.from("yt_scripts").update({ status: "draft" }).eq("video_id", video.data.id).eq("status", "approved");
      if (reset.error) throw new Error(reset.error.message);
      const ok = await db.from("yt_scripts").update({ status: "approved" }).eq("id", mine.data.id);
      if (ok.error) throw new Error(ok.error.message);
      await queueStep(job.studio_id, { video_id: video.data.id, step: "render", idempotency_key: `render:${mine.data.id}:remontage`, payload: { script_id: mine.data.id } });
      await db.from("yt_videos").update({ status: "rendering" }).eq("id", video.data.id).in("status", ["idea", "scripted", "review", "approved"]);
      remontaged = true;
    }
    return { version, remontaged, targetMs: plan.targetMs, segments: plan.segments.length, warnings: plan.warnings, hooks: draft.hooks.length, engine, engineNote, learnedFrom, short: shortInfo, deadCutMs: shortInfo?.cutMs ?? longCutMsOut, ...(grounding ? { grounding } : {}), ...(newMoment ? { newMoment } : {}), ...(producer ? { producer } : {}), ...(lessons.length ? { lessons } : {}) };
  }

  /**
   * Frames of the montage plan from the recording on this pc (full quality, free). Null when frames cannot be made here
   * (no frame helper or the recording is not on this pc): then the script is written as before and the result says so.
   */
  async function gatherEvidence(job: Job, recordingId: string | null, segments: Segment[], dense = false): Promise<{ frames: FramePick[]; images: unknown[] } | null> {
    if (!ai?.frame || !recordingId) return null;
    const rec = await db.from("yt_recordings").select("fingerprint").eq("id", recordingId).maybeSingle<{ fingerprint: string }>();
    const local = rec.data ? await store.get(rec.data.fingerprint) : null;
    if (!local) return null;
    // Long videos: a frame per ~6 s (at most 180, described in batches of 40), so the story can be told all the way.
    const frames = dense ? framePlan(segments, 180, LONG_FRAME_EVERY_MS) : framePlan(segments);
    const dir = await mkdtemp(join(tmpdir(), "kivoxel-bewijs-"));
    try {
      const images: unknown[] = [];
      for (const f of frames) {
        const out = join(dir, `f${f.index}.jpg`);
        await ai.frame(join(store.recordingsDir, local.file), f.srcMs, out);
        images.push({ inlineData: { mimeType: "image/jpeg", data: (await readFile(out)).toString("base64") } });
      }
      return { frames, images };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Gemini describes the frames, in batches of 40; the answers are joined with the frame numbers of the whole video. */
  async function describeEvidence(job: Job, evidence: { frames: FramePick[]; images: unknown[] }, game?: GameId): Promise<Evidence> {
    const parts: { offset: number; evidence: Evidence }[] = [];
    for (const b of evidenceBatches(evidence.frames)) {
      const images = evidence.images.slice(b.offset, b.offset + b.frames.length);
      // Every batch must be described: a gap in the evidence would let the check approve lines it cannot see.
      let parsed: Evidence | { error: string } = { error: "geen antwoord" };
      for (let attempt = 0; attempt < 2 && "error" in parsed; attempt++) {
        try {
          const { json } = await paid(job, () => ai!.gemini.generateWithParts([...images, { text: evidencePrompt(b.frames, game) }]));
          parsed = parseEvidence(json, b.frames.length);
        } catch (e) {
          parsed = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      if ("error" in parsed) throw new Error(`Beeldbewijs onbruikbaar (beelden ${b.offset + 1}-${b.offset + b.frames.length}): ${parsed.error}`);
      parts.push({ offset: b.offset, evidence: parsed });
    }
    return mergeEvidence(parts);
  }

  /** Render: cuts the edit plan into a preview with subtitles (the narrator follows with Google TTS). The file stays on this pc. */
  async function render(job: Job, lv: Live = NO_LIVE) {
    if (!montage) throw new Error("Montage is op deze pc niet beschikbaar");
    const scriptId = String(job.payload?.script_id ?? "");
    if (!scriptId) throw new Error("Geen script gekozen voor de montage");
    // "*": hooks, loop_line and chosen_hook only exist after migration 035.
    type ScriptRow = { id: string; video_id: string; version: number; top_line: string | null; hook: string; lines: ScriptLine[]; edit_plan: Segment[]; target_ms: number; hooks?: unknown; loop_line?: string | null; chosen_hook?: number | null };
    const s = await db.from("yt_scripts").select("*").eq("id", scriptId).eq("studio_id", job.studio_id).single<ScriptRow>();
    if (s.error) throw new Error(s.error.message);
    type VideoRow = { id: string; recording_id: string | null; format: Format; is_test: boolean; status: string; plan_key?: string | null; created_at?: string; channel_id?: string | null };
    const video = await db.from("yt_videos").select("id, recording_id, format, is_test, status, plan_key, created_at, channel_id").eq("id", s.data.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
    if (video.error) throw new Error(video.error.message);
    if (!video.data.recording_id) throw new Error("De opname van deze video is verwijderd");
    const rec = await db.from("yt_recordings").select("fingerprint").eq("id", video.data.recording_id).single<{ fingerprint: string }>();
    if (rec.error) throw new Error(rec.error.message);
    const local = await store.get(rec.data.fingerprint);
    if (!local) throw new Error("Het bestand staat niet op deze pc");
    if (!local.probe?.durationMs) throw new Error("De intake van deze opname is nog niet klaar");
    // "*": the privacy columns only exist after migration 031; before that the montage runs as before.
    type SettingsRow = { game_volume: number; voice_name: string; speaking_rate: number; privacy_blur?: boolean; privacy_regions?: unknown; mute_flagged_voice?: boolean };
    const settings = await db.from("yt_settings").select("*").eq("studio_id", job.studio_id).maybeSingle<SettingsRow>();
    if (settings.error) throw new Error(settings.error.message);
    const privacyReady = !!settings.data && "privacy_regions" in settings.data;
    const channelProfile = (await recordingGameInfo(video.data.recording_id, job.studio_id)).profile;
    const blur = channelProfile.blur && privacyReady && settings.data!.privacy_blur ? cleanRegions(settings.data!.privacy_regions) : [];
    type FlagRow = { position: number; yt_moments: { privacy_flags: string[]; start_ms: number; end_ms: number; peak_ms: number | null; kind?: string | null; reason?: string | null } | null };
    const flags = await db.from("yt_video_moments").select("position, yt_moments(privacy_flags, start_ms, end_ms, peak_ms, kind, reason)").eq("video_id", video.data.id).order("position").returns<FlagRow[]>();
    if (flags.error) throw new Error(flags.error.message);
    const voiceHeard = (flags.data ?? []).some((f) => f.yt_moments?.privacy_flags.includes("voice"));
    const muteGame = privacyReady && settings.data!.mute_flagged_voice === true && voiceHeard;

    // The hook Milan chose (fase C2) decides the opening; without hooks the stored script is used as it is.
    const hooks = parseHooks(s.data.hooks);
    const chosen = typeof s.data.chosen_hook === "number" ? (hooks[s.data.chosen_hook] ?? null) : null;
    const main = flags.data?.[0]?.yt_moments ?? null;
    // 23-11-2026: a targeted correction after Milan's feedback changes only what he pointed at in this timeline
    // (crop of one piece, more time after the peak, music); the moments and the script stay.
    const fixes = (job.payload?.fixes ?? null) as Fixes | null;
    // 23-11-2026: after "kies een ander moment" the plan has a new moment while the video is still linked to the old one;
    // the cold open then takes the plan's own peak (it opened with 1.5 s of the rejected moment).
    const linkedPeak = main ? (main.peak_ms ?? Math.round((main.start_ms + main.end_ms) / 2)) : null;
    const fixed = applyFixes(applyHook(s.data, chosen, coldOpenPeak(linkedPeak, s.data.edit_plan)), fixes, local.probe.durationMs);
    const cut = fixed.cut;
    if (fixed.changes.length) await lv.event("note", `Gerichte correctie: ${fixed.changes.join("; ")}`);
    const size = renderSize(video.data.format);
    let spoken = narration(cut.hook, cut.lines).filter((l) => l.at_ms < cut.targetMs);
    // KIVOXEL fase 1: a script written against the Event Timeline (its lines have a kind) goes through the sync gate.
    const fase1 = (cut.lines as VoLine[]).some((l) => !!l.kind);
    let timeline: EventTimeline | null = null;
    if (montage.events && !video.data.is_test) {
      timeline = await montage.events.timeline(rec.data.fingerprint, local.file, local.probe.durationMs, { hud: await hudOf(video.data.recording_id, job.studio_id), signal: lv.signal }).catch(async (e) => {
        if (e instanceof CancelledError) throw e;
        await lv.event("error", `Event Timeline niet gelukt: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
    }
    let sync: { ok: boolean; flagged: boolean; summary: string; items: GateItem[] } | null = null;
    /** Set when a local voice (no cloud) spoke this montage. */
    let localVoiceName: string | null = null;
    // KIVOXEL fase 1, section 3: the audio mode of this montage (chosen in the review, else the channel default).
    const askedMode = typeof job.payload?.audio_mode === "string" && (AUDIO_MODES as readonly string[]).includes(job.payload.audio_mode) ? (job.payload.audio_mode as AudioMode) : null;
    // 23-11-2026, voice-over split per channel: without a choice in the review, 1 of every 3 Shorts and 1 of every 5 long
    // videos gets the English voice-over (the one where telling adds most); the choice is kept per video, so a retry or a
    // version 2 never counts twice. Archived videos give their place back.
    let voicePlan: { voice: boolean; reason: string } | null = null;
    if (!askedMode && !video.data.is_test && video.data.channel_id) {
      try {
        const ledger = createVoiceLedger(join(montage.rendersDir, "..", "voice-plan.json"));
        const fmt = video.data.format === "C" ? "long" : "short";
        const known = await ledger.slots(video.data.channel_id, fmt);
        const ids = known.filter((x) => !x.released).map((x) => x.videoId);
        const gone = ids.length ? ((await db.from("yt_videos").select("id").in("id", ids).eq("status", "archived").returns<{ id: string }[]>()).data ?? []).map((x) => x.id) : [];
        const m0 = flags.data?.[0]?.yt_moments;
        // The moment the plan really shows: after "kies een ander moment" that is not the linked one (23-11-2026).
        const planPeak = coldOpenPeak(linkedPeak, s.data.edit_plan);
        const shown = planPeak !== linkedPeak && timeline ? timeline.events.filter((e) => Math.abs(e.t_peak - planPeak!) <= 3000).sort((a, b) => b.payoff - a.payoff)[0] : undefined;
        const tell = shown ? narrationValue({ type: shown.type, description: shown.description }) : narrationValue({ kind: m0?.kind ?? null, description: m0?.reason ?? null });
        const slot = await ledger.decide(video.data.channel_id, fmt, video.data.id, tell, gone);
        voicePlan = { voice: slot.voice, reason: slot.reason };
        await lv.event("note", `Stemverdeling: ${slot.voice ? "met Engelse voice-over" : "zonder voice-over"} (${slot.reason})`);
      } catch (e) {
        await lv.event("error", `Stemverdeling niet bepaald: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const planned = askedMode ?? (voicePlan ? (voicePlan.voice ? "vo_muziek" : presetFile.channel_default.audio_mode) : presetFile.channel_default.audio_mode);
    const kSettings = resolveSettings(typeof job.payload?.preset === "string" ? job.payload.preset : null, channelAudioMode(planned, channelProfile));
    const modeSpec = kSettings.audio_modes[kSettings.audio_mode];
    let storyOverlays: StoryText[] = [];
    let mixPlan: MixPlan | null = null;
    let mixNote: string | null = null;
    const voice: VoiceClip[] = [];
    // Studio 2.0: a voice for this montage only (comparing voices), else the studio setting. KIVOXEL videos are English,
    // always: a non-English voice falls back to the English one.
    const voiceOverride = typeof job.payload?.voice_name === "string" && /^en-US-Chirp3-HD-[A-Za-z]{2,20}$/.test(job.payload.voice_name) ? job.payload.voice_name : null;
    const voiceName = voiceOverride ?? (/^en-/.test(settings.data?.voice_name ?? "") ? settings.data!.voice_name : "en-US-Chirp3-HD-Fenrir");
    const fileName = renderFileName(video.data.id, s.data.version, job.id);
    const output = join(montage.rendersDir, fileName);
    const partial = join(montage.rendersDir, fileName.replace(/\.mp4$/, ".part.mp4"));
    await mkdir(montage.rendersDir, { recursive: true });
    const tmp = await mkdtemp(join(montage.tmpDir, "render-"));
    try {
      // The narrator: only real footage, only with a key, and only while the free tier has room. Otherwise a montage without voice.
      let note: string | null = null;
      let characters = 0;
      if (video.data.is_test) note = "Testdata: montage zonder stem";
      else if (fase1 && !modeSpec.voice && modeSpec.text_story === false) {
        // "Muziek, geen stem" and "Alleen gamegeluid": no voice, no captions, no story text; only the yellow header text.
        spoken = [];
        note = `Audio-modus "${modeSpec.label}": geen stem, geen ondertiteling of verhaaltekst, alleen de gele tekst bovenin`;
      } else if (fase1 && !modeSpec.voice) {
        // No voice in this mode: the same anticipation lines become text in the picture (no TTS, no characters used).
        const story = textOverlays(narration(cut.hook, cut.lines).filter((l) => l.at_ms < cut.targetMs) as VoLine[], cut.segments, timeline, cut.targetMs, kSettings);
        storyOverlays = story.overlays;
        spoken = [];
        note = `Audio-modus "${modeSpec.label}": geen stem, het verhaal staat als tekst in beeld (${story.overlays.length} teksten${story.dropped.length ? `, ${story.dropped.length} weggelaten` : ""})`;
      } else if (fase1 && montage.duration && (montage.voice || montage.localVoice)) {
        // Line by line, with the real spoken length; lines that do not fit are shortened (max 3 attempts) or left out.
        // Google first (free tier); without a key, with the free tier used up, or in free mode: the best local voice.
        await lv.phase("Voice-over maken");
        const preferLocal = job.payload?.engine === "free" || presetFile.channel_default.engine === "free";
        const lines = narration(cut.hook, cut.lines).filter((l) => l.at_ms < cut.targetMs) as VoLine[];
        const gateWith = (tts: Parameters<typeof speakWithGate>[0]["tts"], reserve: (n: number) => Promise<unknown>) =>
          speakWithGate({ align: montage.align, verify: tts === montage.cloneVoice, lines, segments: cut.segments, timeline, targetMs: cut.targetMs, settings: kSettings, tts, voiceName, baseRate: Number(settings.data?.speaking_rate ?? 1.1), tmp, reserve, duration: montage.duration!, run: (args, cwd, timeoutMs) => montage.run(args, cwd, timeoutMs, { signal: lv.signal }) });
        let g: Awaited<ReturnType<typeof speakWithGate>> | null = null;
        let localWhy: string | null = preferLocal ? "gratis modus" : !montage.voice ? "geen Google-sleutel" : null;
        // The cloned voice first (payload.voice "kloon"/"google" overrides the preset for comparing).
        const cloneCfg = kSettings.voice.clone;
        const wantClone = job.payload?.voice === "kloon" || (job.payload?.voice !== "google" && cloneCfg.use && (video.data.format !== "C" || !cloneCfg.shorts_only));
        if (wantClone && montage.cloneVoice) {
          try {
            g = await gateWith(montage.cloneVoice, async () => undefined);
            localVoiceName = montage.cloneVoice.name;
            note = `Stemkloon ${montage.cloneVoice.name}`;
          } catch (e) {
            if (e instanceof CancelledError) throw e;
            localWhy = `stemkloon mislukt: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
          }
        }
        if (!g && montage.voice && !preferLocal) {
          try {
            g = await gateWith(montage.voice.tts, (n) => montage.voice!.usage.reserve(n));
          } catch (e) {
            if (e instanceof CancelledError) throw e;
            localWhy = e instanceof Error ? e.message.slice(0, 160) : String(e);
            if (!montage.localVoice) note = localWhy;
          }
        }
        if (!g && montage.localVoice) {
          try {
            g = await gateWith(montage.localVoice, async () => undefined);
            localVoiceName = montage.localVoice.name;
            note = `Lokale stem ${montage.localVoice.name} (${localWhy ?? "terugval"})`;
          } catch (e) {
            if (e instanceof CancelledError) throw e;
            note = `Lokale stem mislukt: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        if (g) {
          voice.push(...g.clips);
          spoken = g.spoken;
          characters = localVoiceName ? 0 : g.characters;
          sync = { ok: g.result.gate.ok && !g.result.flagged, flagged: g.result.flagged, summary: gateSummary(g.result.gate, g.result.attempts, g.result.dropped), items: g.result.gate.items };
          await lv.event(sync.ok ? "note" : "error", `VO-sync: ${sync.summary}${localVoiceName ? ` (stem: ${localVoiceName})` : ""}`);
        }
        if (characters) {
          const cost = await db.from("yt_costs").insert({ studio_id: job.studio_id, job_id: job.id, category: "voiceover", service: "Google TTS Chirp 3 HD", amount_cents: 0, is_estimate: false, description: `${characters} tekens, binnen het gratis deel (per zin, met sync-controle)` });
          if (cost.error && cost.error.code !== "23505") log(`Stemgebruik van stap ${job.id} niet vastgelegd: ${cost.error.message}`);
        }
      } else if (!montage.voice) note = "Montage zonder stem: stem nog te verbinden (GOOGLE_TTS_API_KEY in worker/.env.local)";
      else {
        await lv.phase("Voice-over maken");
        const needed = spoken.reduce((sum, l) => sum + l.text.length, 0);
        try {
          await montage.voice.usage.reserve(needed);
          characters = needed;
        } catch (e) {
          note = e instanceof Error ? e.message : String(e);
        }
        if (characters) {
          for (const [i, line] of spoken.entries()) {
            const file = `line${i}.mp3`;
            await writeFile(join(tmp, file), await montage.voice.tts.speak(line.text, { voiceName, speakingRate: Number(settings.data?.speaking_rate ?? 1.15) }));
            voice.push({ file, atMs: line.at_ms });
          }
          const cost = await db.from("yt_costs").insert({ studio_id: job.studio_id, job_id: job.id, category: "voiceover", service: "Google TTS Chirp 3 HD", amount_cents: 0, is_estimate: false, description: `${characters} tekens, binnen het gratis deel` });
          if (cost.error && cost.error.code !== "23505") log(`Stemgebruik van stap ${job.id} niet vastgelegd: ${cost.error.message}`);
        }
      }
      const isShort = video.data.format !== "C";
      const inMontage = eventsInMontage(cut.segments, timeline);
      const mainEvent = isShort ? [...inMontage].sort((a, b) => b.payoff - a.payoff)[0] ?? null : null;
      const montageMs = cut.segments.reduce((sum, sg) => sum + Math.round((sg.src_end_ms - sg.src_start_ms) / sg.speed), 0);
      // KIVOXEL fase 1, section 7.3/7.8: pattern interrupts, with a zoom style that rotates between videos.
      const recentStyles = (await montage.phrases?.recent().catch(() => [] as string[])) ?? [];
      const lastOf = (prefix: string) => [...recentStyles].reverse().find((x) => x.startsWith(prefix))?.slice(prefix.length) ?? null;
      const rotate = <T extends string>(options: readonly T[], last: string | null, salt: string): T => {
        const pool = options.filter((o) => o !== last);
        return pool[Math.floor(seeded(`${job.id}:${salt}`)() * pool.length)] ?? options[0];
      };
      const zoomStyle = rotate(ZOOM_STYLES, lastOf("zoom:"), "zoom");
      const captionStyle = rotate(CAPTION_STYLES, lastOf("caption:"), "caption");
      const interrupts = fase1 && !video.data.is_test ? planInterrupts({ durationMs: montageMs, peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff })), short: isShort, style: zoomStyle, settings: kSettings, rnd: seeded(`${job.id}:fx`) }) : [];
      if (interrupts.length) void montage.phrases?.add([`zoom:${zoomStyle}`, `caption:${captionStyle}`]).catch(() => {});
      // Section 7.3: freeze-frame + text right after a fail (the record scratch comes from the SFX layer).
      const outFps = (local.probe.fps ?? 30) >= 50 ? 60 : 30;
      const freezeRnd = seeded(`${job.id}:freeze`);
      const freezes = fase1 && !video.data.is_test && modeSpec.text_story !== false ? planFreezes({ peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, fail: e.kind === "death" || e.type === "fail" })), durationMs: montageMs, short: isShort, settings: kSettings, take: () => pick(templates.freeze_text, recentStyles, freezeRnd) }) : [];
      if (freezes.length) {
        storyOverlays = [...storyOverlays, ...freezes.map((f) => ({ startMs: f.atMs, endMs: f.atMs + f.ms, text: f.text, reaction: true }))];
        void montage.phrases?.add(freezes.map((f) => f.text)).catch(() => {});
      }
      const fxFilter = [freezeFilter(freezes, outFps), interruptFilter(interrupts, size)].filter(Boolean).join(",");
      // KIVOXEL fase 1, sections 3 and 7.6: music (on the beat of the payoff) and SFX, per audio mode.
      if (fase1 && montage.media && !video.data.is_test) {
        const media = montage.media;
        const rnd = seeded(`${job.id}:mix`);
        const cutMs = cut.segments.reduce((sum, sg) => sum + Math.round((sg.src_end_ms - sg.src_start_ms) / sg.speed), 0);
        const peakOut = (mainEvent ?? [...inMontage].sort((a, b) => b.payoff - a.payoff)[0])?.peak_out ?? null;
        let music: MusicChoice | null = null;
        // Review fix "muziek uit": this version without music (the rest of the mix stays).
        if (modeSpec.music && fixes?.music !== "none") {
          const lib = await media.music().catch(() => ({ dir: "", tracks: [] as Track[] }));
          const recentTracks = await media.musicLog.recent().catch(() => [] as string[]);
          // Milan, 16-11-2026: busy music for action, calm music for searching and farming, cross-fading with the content.
          const parts = planMusicParts({ durationMs: cutMs, events: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, type: e.type, kind: e.kind })), library: lib.tracks.filter((t) => !t.channels?.length || t.channels.includes(channelProfile.key)), recent: recentTracks, rnd, short: isShort, noRepeatWithin: kSettings.variation.music_no_repeat_within });
          if (parts.length) {
            const titles = [...new Set(parts.map((p) => p.title))];
            const own = parts.every((p) => lib.tracks.find((t) => t.file === p.file)?.source.startsWith("eigen"));
            music = { file: join(lib.dir, parts[0].file), startMs: parts[0].startMs, title: `${titles.join(" / ")} (${own ? "eigen KIVOXEL-muziek" : parts.every((p) => lib.tracks.find((t) => t.file === p.file)?.source.startsWith("Uppbeat")) ? "Uppbeat" : "Pixabay"})`, parts: parts.map((p) => ({ ...p, file: join(lib.dir, p.file) })) };
            void media.musicLog.add([...new Set(parts.map((p) => p.file))]).catch(() => {});
            mixNote = parts.length > 1 ? `Muziek wisselt mee: ${parts.map((p) => `${p.kind === "action" ? "actie" : "rustig"} ${(p.atMs / 1000).toFixed(0)}-${((p.atMs + p.durMs) / 1000).toFixed(0)} s`).join(", ")}` : null;
          } else mixNote = "Geen muziek in de bibliotheek: zet rechtenvrije tracks in kivoxel-media/music (zie docs/kivoxel-presets.md)";
          void peakOut;
        }
        let sfx: SfxCue[] = [];
        // "Alleen gamegeluid" has no sound effects at all (Milan, 16-11-2026).
        if (kSettings.features.sfx_layer && modeSpec.sfx !== false) {
          const lib = await media.sfx().catch(() => ({ dir: "", items: [] as Sfx[] }));
          const recentSfx = await media.sfxLog.recent().catch(() => [] as string[]);
          sfx = planSfx({ segments: cut.segments, peaks: inMontage.map((e) => ({ atMs: e.peak_out, payoff: e.payoff, death: e.kind === "death" })), library: lib.items, recent: recentSfx, rnd, withVoice: modeSpec.voice, noRepeatWithin: kSettings.variation.sfx_no_repeat_within, durationMs: cutMs }).map((c) => ({ ...c, file: join(lib.dir, c.file) }));
          // A small accent on every interrupt (pop on a punch, whoosh on a whip), a bit softer than the main SFX.
          if (kSettings.features.interrupts.includes("sfx_accent")) {
            for (const a of interruptSfx(interrupts)) {
              const options = lib.items.filter((x) => x.kind === a.kind);
              const pickFile = options[Math.floor(rnd() * options.length)];
              if (pickFile) sfx.push({ file: join(lib.dir, pickFile.file), atMs: a.atMs, db: (modeSpec.voice ? -14 : -9) + (pickFile.db ?? 0), kind: a.kind });
            }
          }
          void media.sfxLog.add(sfx.map((c) => c.file)).catch(() => {});
        }
        // Own KIVOXEL motif (Milan, 18-11-2026): start of every Short, start and end of a long video.
        const motif = await media.motif?.((await recordingGameInfo(video.data.recording_id, job.studio_id)).profile.key).catch(() => null);
        if (motif) for (const c of motifCues({ short: isShort, durationMs: cutMs, motifMs: motif.durMs, music: !!modeSpec.music, voice: !!modeSpec.voice })) sfx.push({ file: motif.file, atMs: c.atMs, db: c.db, kind: "motif" });
        mixPlan = { mode: kSettings.audio_mode, spec: modeSpec, music, sfx, voiceChain: true };
      }
      const renderInput: RenderInput = {
        recording: join(store.recordingsDir, local.file),
        recordingMs: local.probe.durationMs,
        hasAudio: !!local.probe.audioCodec,
        segments: cut.segments,
        size,
        assFile: "subs.ass",
        voice,
        gameVolume: Number(settings.data?.game_volume ?? 0.25),
        output: partial,
        blur,
        muteGame,
        ...(mixPlan ? { mix: { plan: mixPlan, settings: kSettings } } : {}),
        // Section 7.7: frame rate as the source (60 for PS5 60 fps, else 30) and a high bitrate for the new montages.
        ...(fase1 ? { fps: outFps, highQuality: true, fx: fxFilter || undefined, ...(isShort && kSettings.features.loop_ending ? { loopFadeMs: 400 } : {}) } : {}),
      };
      // 18-11-2026: a long part with hundreds of cuts is first made in chunks (each at most MAX_PIECES_PER_RUN pieces),
      // otherwise FFmpeg runs out of memory or over the Windows command-line limit. Shorts need no chunks.
      // 18-11-2026: many sound effects (a whoosh on every cut of a long part) are first mixed into a few tracks.
      if (mixPlan) {
        const beds = sfxBeds(mixPlan.sfx, montageMs, (k) => join(tmp, `sfx-bed-${k}.flac`));
        if (beds.length) {
          await lv.phase(`Geluidseffecten samenvoegen (${mixPlan.sfx.length} in ${beds.length} sporen)`, 0);
          for (const b of beds) await montage.run(b.args, tmp, 10 * 60_000, { signal: lv.signal });
          mixPlan = { ...mixPlan, sfx: beds.map((b) => b.cue) };
          renderInput.mix = { plan: mixPlan, settings: kSettings };
        }
      }
      const chunks = renderChunks(renderInput, (k) => join(tmp, `chunk-${String(k).padStart(3, "0")}.mkv`));
      if (chunks.length) {
        await lv.phase(`Montage in ${chunks.length} delen voorbereiden`, 0);
        for (const [k, c] of chunks.entries()) {
          if (lv.signal.aborted) throw new CancelledError();
          await montage.run(c.args, tmp, Math.max(10 * 60_000, c.ms * 20), { signal: lv.signal });
          void lv.progress({ progress: (k + 1) / chunks.length, metrics: { chunk: k + 1, chunks: chunks.length } });
        }
        await lv.event("log", `${chunks.length} deelstukken klaar (${chunks.reduce((s, c) => s + c.pieces, 0)} fragmenten)`);
      }
      const plan = renderArgs(renderInput, chunks.map((c) => ({ file: c.file, ms: c.ms })));
      // KIVOXEL fase 1, section 5: in a Short the hook pops in and shakes at the payoff (the main event of the video).
      // The yellow header text: a Short keeps it all the way; a long video shows it for the first minute, then it fades (Milan, 16-11-2026).
      const hook = fase1 && cut.topLine?.trim() ? { style: hookStyle(size, kSettings), events: isShort ? hookEvents(cut.topLine, plan.durationMs, mainEvent?.peak_out ?? null, size, kSettings) : longTopEvents(cut.topLine, plan.durationMs, size, kSettings) } : undefined;
      // Section 7.4: word-by-word captions in the safe zone for the spoken lines.
      const words = fase1 && kSettings.features.word_captions && spoken.length ? { style: captionStyleLine(size, kSettings), events: captionEvents(timedFromSpoken(spoken as (ScriptLine & { ms?: number })[], plan.durationMs), captionStyle, size, kSettings, plan.durationMs) } : undefined;
      // Section 7.1: after a teaser of the payoff, "N SECONDS EARLIER…".
      const teaser = cut.segments.find((sg) => sg.part === "teaser" && sg.out_start_ms === 0);
      if (teaser && fase1 && modeSpec.text_story !== false) {
        const next = [...cut.segments].sort((a, b) => a.out_start_ms - b.out_start_ms)[1];
        const tEnd = Math.round((teaser.src_end_ms - teaser.src_start_ms) / teaser.speed);
        if (next) storyOverlays = [...storyOverlays, { startMs: tEnd, endMs: tEnd + 1100, text: `${Math.max(2, Math.round((teaser.src_start_ms - next.src_start_ms) / 1000))} SECONDS EARLIER…`, reaction: false }];
      }
      await writeFile(join(tmp, "subs.ass"), buildAss({ size, topLine: cut.topLine, lines: spoken, durationMs: plan.durationMs, overlays: segmentOverlays(cut.segments, local.probe.durationMs), hook, words, story: storyOverlays.length ? storyAss(storyOverlays, size, plan.durationMs) : undefined }), "utf8");
      if (lv.signal.aborted) throw new CancelledError();
      await lv.phase("Video renderen", 0);
      await lv.event("log", `FFmpeg gestart: ${plan.segments} fragmenten, ${size.width}×${size.height}${blur.length ? `, ${blur.length} hoeken vervaagd` : ""}${muteGame ? ", gamegeluid gedempt" : ""}`);
      const started = Date.now();
      await montage.run(plan.args, tmp, Math.max(10 * 60_000, plan.durationMs * 20), {
        signal: lv.signal,
        onProgress: (snap) => {
          const { progress, etaMs } = renderProgress(snap, plan.durationMs, Date.now() - started);
          void lv.progress({ progress, metrics: { frame: snap.frame, fps: snap.fps, speed: snap.speed, out_ms: snap.outMs, total_ms: plan.durationMs, eta_ms: etaMs, elapsed_ms: Date.now() - started } });
        },
      });
      // KIVOXEL fase 1: exact loudness (-14 LUFS, true peak <= -1 dB) in two passes; the picture is copied.
      if (mixPlan && montage.normalize) {
        await lv.phase("Geluid op -14 LUFS zetten");
        const exact = partial.replace(/\.part\.mp4$/, ".loud.part.mp4");
        try {
          if (await montage.normalize(partial, exact, tmp, targetFrom(kSettings.mix), { signal: lv.signal })) await rename(exact, partial);
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          await lv.event("error", `Luidheid niet exact gezet (de montage blijft zoals hij is): ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await rm(exact, { force: true });
        }
      }
      await lv.phase("Preview opslaan", 1);
      await rename(partial, output);
      // Fase D4b: the same captions as a separate file, for YouTube (search and accessibility).
      await writeFile(join(montage.rendersDir, srtFileName(fileName)), buildSrt(spoken, plan.durationMs), "utf8");
      const insert = await db.from("yt_renders").upsert(
        { studio_id: job.studio_id, video_id: video.data.id, script_id: s.data.id, job_id: job.id, file_name: fileName, duration_ms: Math.max(1, plan.durationMs), width: size.width, height: size.height, voice_name: voice.length && !localVoiceName ? voiceName : null, tts_characters: characters, is_test: video.data.is_test, ...(privacyReady ? { privacy_blur: blur.length > 0, game_muted: muteGame } : {}) },
        { onConflict: "job_id", ignoreDuplicates: true },
      );
      if (insert.error) throw new Error(insert.error.message);
      // Quality check with real measurements (fase C1). A failing check never fails the montage itself.
      let qcSummary: { green: number; orange: number; red: number; lufs: number | null; /** Reds a new montage cannot change (the voice-over sync). */ voSyncRed?: number } | null = null;
      if (montage.measure) {
        try {
          if (lv.signal.aborted) throw new CancelledError();
          await lv.phase("Kwaliteitscontrole", 0);
          const qcStarted = Date.now();
          const measured = await montage.measure(output, tmp, {
            signal: lv.signal,
            onProgress: (snap) => void lv.progress({ progress: renderProgress(snap, plan.durationMs, Date.now() - qcStarted).progress, metrics: { frame: snap.frame, speed: snap.speed, out_ms: snap.outMs, total_ms: plan.durationMs } }),
          });
          const log = parseQcLog(measured.stderr);
          // Too quiet or clipping: extra sound pass (picture copied) with a few limiter ceilings; the loudest safe one wins.
          if (needsLoudnessFix(log) && montage.boost && montage.loudness && log.integratedLufs !== null) {
            await lv.phase("Luidheid verbeteren");
            const tries: (Loudness & { id: string })[] = [];
            for (const limit of BOOST_LIMITS) {
              const file = join(tmp, `louder-${limit}.mp4`);
              await montage.boost(output, file, tmp, { signal: lv.signal, limit });
              tries.push({ id: file, ...(await montage.loudness(file, tmp)) });
            }
            const pick = pickLoudnessFix(log, tries);
            const fmt = (v: number | null) => (v === null ? "?" : v.toLocaleString("nl-NL"));
            if (pick) {
              await rm(output, { force: true });
              await rename(pick.id, output);
              await lv.event("note", `Geluid verbeterd: ${fmt(log.integratedLufs)} naar ${fmt(pick.integratedLufs)} LUFS, pieken ${fmt(log.truePeakDb)} naar ${fmt(pick.truePeakDb)} dBFS`);
              log.integratedLufs = pick.integratedLufs;
              log.truePeakDb = pick.truePeakDb;
            } else await lv.event("note", `Geluid niet te verbeteren zonder vervorming (${fmt(log.integratedLufs)} LUFS, pieken ${fmt(log.truePeakDb)} dBFS)`);
          }
          const moments = (flags.data ?? []).map((f) => f.yt_moments).filter((m): m is NonNullable<typeof m> => !!m);
          const items: QcItem[] = qcChecklist(measured.probe, log, {
            format: video.data.format,
            expected: size,
            targetMs: { min: targetFor(video.data.format, video.data.plan_key).minMs, max: targetFor(video.data.format, video.data.plan_key).maxMs },
            firstActionMs: firstActionMs(cut.segments, moments),
            hasVoice: voice.length > 0,
            captionsInSafeZone: true,
            planChanges: planChanges(cut.segments),
          });
          // Section 9: first frame moves, no dead stretch > 0.7 s, interrupts often enough (Shorts), chapters (long).
          if (fase1 && timeline) {
            const moves = firstFrameMoves(cut.segments, timeline.dead);
            items.push({ key: "first_frame", label: "Eerste frame beweegt", level: moves ? "green" : "red", value: moves ? "ja" : "nee", note: moves ? "start direct in de actie" : "de video begint in een menu, stilstand of zwart beeld" });
            const dead = deadInMontage(cut.segments, timeline.dead, kSettings.features.max_pause_ms, inMontage.map((e) => e.t_peak));
            items.push({ key: "dead_air", label: "Geen dode stukken > 0,7 s", level: dead.longestMs === 0 ? "green" : dead.longestMs < 2000 ? "orange" : "red", value: dead.longestMs ? `${(dead.longestMs / 1000).toFixed(1)} s` : "geen", note: dead.totalMs ? `${(dead.totalMs / 1000).toFixed(1)} s dood beeld over` : "alles eruit geknipt" });
            if (isShort && kSettings.features.pattern_interrupts) {
              const gap = longestQuiet(interrupts, plan.durationMs);
              items.push({ key: "interrupts", label: "Pattern interrupt elke 2-4 s", level: gap <= 4500 ? "green" : gap <= 6500 ? "orange" : "red", value: `${interrupts.length}×, langste gat ${(gap / 1000).toFixed(1)} s`, note: `stijl: ${zoomStyle}, captions: ${captionStyle}` });
            }
            if (!isShort) {
              const ch = chapters(cut.segments, timeline, plan.durationMs);
              items.push({ key: "chapters", label: "Hoofdstukken", level: ch.length >= 3 ? "green" : "orange", value: ch.length ? `${ch.length}` : "geen", note: ch.length ? ch.join(" · ") : "te weinig grote momenten voor YouTube-hoofdstukken (minstens 3)" });
            }
          }
          if (mixPlan) {
            // Section 9: -14 LUFS ±1 and true peak <= -1 dB (stricter than the general loudness line above).
            const lc = loudnessCheck(log.integratedLufs, log.truePeakDb, kSettings.mix);
            items.push({ key: "loudness_target", label: "Luidheid op doel (−14 ±1 LUFS, piek ≤ −1 dB)", level: lc.ok ? "green" : "red", value: lc.value, note: lc.note });
            const m = modeCheck(mixPlan, voice.length);
            // An empty music library is something for Milan to fill, not a broken montage: orange instead of red.
            items.push({ key: "audio_mode", label: "Audio-modus toegepast", level: m.ok ? "green" : mixNote ? "orange" : "red", value: m.value, note: mixNote ?? m.note });
          }
          if (sync) items.push({ key: "vo_sync", label: "VO-sync (stem vóór de piek)", level: sync.ok ? "green" : "red", value: sync.ok ? "op tijd" : sync.flagged ? "nakijken" : "fout", note: sync.summary.slice(0, 400) });
          // Section 9: hook and length of a Short (fase-1 scripts only; older Shorts keep their old checks).
          if (isShort && fase1) {
            const recentHooks = await recentShortHooks(job.studio_id, video.data.id);
            const checks = [
              ...(cut.topLine ? hookChecks(cut.topLine, mainEvent?.type ?? null, recentHooks, kSettings, mainEvent?.kind === "death") : []),
              ...lengthChecks(plan.durationMs, await previousShortBucket(job.studio_id, { id: video.data.id, recording_id: video.data.recording_id, created_at: video.data.created_at }, kSettings), kSettings),
            ];
            for (const c of checks) items.push({ key: c.key, label: c.label, level: c.ok ? "green" : c.key === "hook_fresh" || c.key === "length_varies" ? "orange" : "red", value: c.value, note: c.note });
          }
          const count = (l: string) => items.filter((i) => i.level === l).length;
          qcSummary = { green: count("green"), orange: count("orange"), red: count("red"), lufs: log.integratedLufs, voSyncRed: items.filter((i) => i.level === "red" && i.key === "vo_sync").length };
          // "audio": which mode, music and SFX this montage got (the review shows it; no extra column needed).
          const audio = mixPlan ? { mode: mixPlan.mode, label: mixPlan.spec.label, music: mixPlan.music?.title ?? null, /** 23-11-2026: which library files (for the credit on the upload sheet and the usage per version). */ musicFiles: (mixPlan.music?.parts ?? []).map((p) => basename(p.file)), sfx: mixPlan.sfx.length, voice: voice.length > 0, voiceEngine: voice.length ? (localVoiceName ?? voiceName) : null, /** Captions on the real word times and the voice version of 16-11-2026 (for re-montage). */ aligned: (spoken as { heard?: unknown[] }[]).some((l) => !!l.heard?.length), voiceVersion: 3 } : null;
          // Chapters of a long video, ready for the description (section 7.7).
          const chapterLines = fase1 && !isShort ? chapters(cut.segments, timeline, plan.durationMs) : [];
          const saved = await db.from("yt_renders").update({ qc: { measured_at: new Date().toISOString(), probe: measured.probe, log, items, ...(audio ? { audio } : {}), ...(chapterLines.length ? { chapters: chapterLines } : {}), ...(interrupts.length ? { fx: { zoom: zoomStyle, captions: captionStyle, interrupts: interrupts.length, freezes: freezes.map((f) => f.text) } } : {}) } }).eq("job_id", job.id);
          if (saved.error && !liveMissing(saved.error)) await lv.event("error", `Kwaliteitscontrole niet opgeslagen: ${saved.error.message}`);
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          await lv.event("error", `Kwaliteitscontrole mislukt: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Fase C: thumbnails from the montage itself (so blurred corners stay blurred). Never fails the montage.
      let thumbs: StoredThumb[] = [];
      const headerFails: string[] = [];
      try {
        if (lv.signal.aborted) throw new CancelledError();
        await lv.phase("Thumbnails maken");
        const tsize = video.data.format === "C" ? THUMB_SIZE.long : THUMB_SIZE.short;
        const texts = [...new Set([chosen?.overlay, ...hooks.map((h) => h.overlay), cut.topLine, cut.hook].filter((t): t is string => !!t))];
        // KIVOXEL fase 1: the frame comes from the recording itself (no burned-in captions), at the best event the video shows.
        const recordingPath = join(store.recordingsDir, local.file);
        for (const [i, p] of thumbnailPlans(video.data.format, cut.segments, texts).entries()) {
          const file = thumbFileName(fileName, i);
          await writeFile(join(tmp, `thumb${i}.ass`), thumbAss(tsize, p.text), "utf8");
          const outMs = p.atMs.map((t) => Math.min(t, Math.max(0, plan.durationMs - 500)));
          // The main thumbnail (cover / most exciting moment) follows the events; result and before/after keep their planned moments.
          const srcMs = p.key === "cover" || p.key === "moment" ? [sourceThumbMs(cut.segments, timeline, outMs[0]).srcMs] : outMs.map((t) => outToSource(cut.segments, t));
          await montage.run(thumbFromSourceArgs(recordingPath, srcMs, tsize, `thumb${i}.ass`, join(montage.rendersDir, file), blur), tmp, 2 * 60_000, { signal: lv.signal });
          // The yellow header is sacred: a thumbnail whose header deviates from the brand file is thrown away.
          if (montage.headerCheck && p.text.trim()) {
            const check = await montage.headerCheck(join(montage.rendersDir, file), `thumb${i}.ass`, tsize, tmp);
            if (!check.ok) {
              await rm(join(montage.rendersDir, file), { force: true });
              headerFails.push(`${p.label}: ${check.reason}`);
              await lv.event("error", `Thumbnail "${p.label}" afgekeurd: ${check.reason}`);
              continue;
            }
          }
          thumbs.push({ file, key: p.key, label: p.label, text: p.text, at_ms: p.atMs[0] });
        }
        if (headerFails.length) {
          // A red line in the quality check, so the review shows why a thumbnail is missing.
          const current = await db.from("yt_renders").select("qc").eq("job_id", job.id).maybeSingle<{ qc: { items?: QcItem[] } | null }>();
          const qc = current.data?.qc ?? null;
          if (qc && !current.error) {
            const item: QcItem = { key: "thumbnail_header", label: "Thumbnail-header geel", level: "red", value: `${headerFails.length} afgekeurd`, note: headerFails.join(" ").slice(0, 400) };
            await db.from("yt_renders").update({ qc: { ...qc, items: [...(qc.items ?? []), item] } }).eq("job_id", job.id);
          }
          if (qcSummary) qcSummary.red += 1;
        }
        const savedThumbs = await db.from("yt_renders").update({ thumbnails: thumbs }).eq("job_id", job.id);
        if (savedThumbs.error && !liveMissing(savedThumbs.error)) await lv.event("error", `Thumbnails niet opgeslagen: ${savedThumbs.error.message}`);
        else await lv.event("note", `${thumbs.length} ${thumbs.length === 1 ? "thumbnail" : "thumbnails"} gemaakt`);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        thumbs = [];
        await lv.event("error", `Thumbnails mislukt: ${e instanceof Error ? e.message : String(e)}`);
      }
      // Section 9: a montage with a red check does not go to the review yet: it is made once more by itself (new seeds
      // for zooms, captions, music and SFX). Still red after that: to the review, where the red checks block approval
      // until Milan ticks that he saw them.
      // 23-11-2026, eindredacteur: judge the export Milan will get (picture, final sound, captions, and how much of the
      // footage used is gameplay), store it with this version, and correct the cause once by itself.
      let editor: EditorReport | null = null;
      if (!video.data.is_test) {
        try {
          const outFile = join(montage.rendersDir, fileName);
          const srt = outFile.replace(/\.mp4$/i, ".srt");
          const slow = cut.segments.find((g) => g.effects?.includes("slowmo"));
          const payoffSeg = cut.segments.find((g) => g.part === "payoff");
          const peakOutMs = slow ? slow.out_start_ms + Math.round((slow.src_end_ms - slow.src_start_ms) / (slow.speed || 1)) : payoffSeg ? payoffSeg.out_start_ms : null;
          let gameplayShare: number | null = null;
          if ((await hudOf(video.data.recording_id!, job.studio_id)) === "minecraft") {
            const vis = JSON.parse(await readFile(join(montage.rendersDir, "..", "visual", `${rec.data.fingerprint}.json`), "utf8").catch(() => "null")) as { fps: number; frames: { health: number; ui: number }[] } | null;
            if (vis?.frames?.length) {
              // Without recognisable hearts in this recording (frozen hearts, other HUD) only the menu panel counts.
              const hearts = vis.frames.filter((f) => f.health >= 0).length / vis.frames.length >= 0.3;
              let tot = 0;
              let game = 0;
              for (const g of cut.segments) for (let i = Math.floor((g.src_start_ms / 1000) * vis.fps); i < Math.ceil((g.src_end_ms / 1000) * vis.fps) && i < vis.frames.length; i++) {
                tot++;
                if ((!hearts || vis.frames[i].health >= 0) && vis.frames[i].ui < 120) game++;
              }
              gameplayShare = tot ? game / tot : null;
            }
          }
          const measuredEvents = timeline ? timeline.events.filter((e) => e.payoff >= 30 && cut.segments.some((g) => e.t_peak >= g.src_start_ms && e.t_peak <= g.src_end_ms)).length : null;
          const measure = await measureExport(montage.ffmpeg ?? "ffmpeg", outFile, plan.durationMs, existsSync(srt) ? srt : null);
          editor = reviewExport(measure, { short: isShort, peakOutMs, voiceLines: spoken.map((l) => ({ atMs: l.at_ms, text: l.text })), hasVoice: voice.length > 0, gameplayShare, measuredEvents });
          const cur = await db.from("yt_renders").select("qc").eq("job_id", job.id).maybeSingle<{ qc: Record<string, unknown> | null }>();
          await db.from("yt_renders").update({ qc: { ...(cur.data?.qc ?? {}), editor } }).eq("job_id", job.id);
          await lv.event("note", `Eindredacteur: ${editor.status}. ${editor.main}`.slice(0, 500));
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          await lv.event("error", `Eindredacteur kon de export niet beoordelen: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Correct the cause once, never in a loop (editor_fix marks a version that already is a correction).
      if (editor?.status === "Correctie nodig" && !job.payload?.editor_fix && isShort) {
        const menu = editor.findings.some((f) => f.severity === "blokkeert" && /gameplay/.test(f.text));
        const outcome = editor.findings.some((f) => f.severity === "blokkeert" && f.kind === "uitkomst");
        if (menu) {
          const next = Math.max(s.data.version + 1, 2);
          await queueStep(job.studio_id, { video_id: video.data.id, step: "script", idempotency_key: `script:${video.data.id}:v${next}`, payload: { version: next, remontage: true, new_moment: true, editor_fix: 1, note: `Eindredacteur: ${editor.main}`.slice(0, 500) } });
          await db.from("yt_videos").update({ status: "scripted" }).eq("id", video.data.id).in("status", ["rendering"]);
          await lv.event("note", "Eindredacteur: vooral menu in beeld; nieuwe montage met een ander moment (één keer).");
          return { file: fileName, durationMs: plan.durationMs, qc: qcSummary, editor, editorFix: "nieuw moment", audioMode: kSettings.audio_mode, voicePlan };
        }
        if (outcome) {
          await queueStep(job.studio_id, { video_id: video.data.id, step: "render", idempotency_key: `render:${scriptId}:editor:${job.id}`, payload: { ...job.payload, editor_fix: 1, fixes: { ...((job.payload?.fixes as object) ?? {}), payoffExtraMs: 2500 } } });
          await lv.event("note", "Eindredacteur: uitkomst te kort in beeld; de montage wordt één keer gemaakt met een langere uitkomst.");
          return { file: fileName, durationMs: plan.durationMs, qc: qcSummary, editor, editorFix: "langere uitkomst", audioMode: kSettings.audio_mode, voicePlan };
        }
      }
      const qcRetry = Number(job.payload?.qc_retry ?? 0);
      // 18-11-2026: only for Shorts. A long part takes 25 minutes and its red checks (first frame, a peak of -0.8 dB)
      // come out the same the second time; it goes straight to the review instead.
      // 20-11-2026: a new montage only helps for what the new seeds change. The voice-over sync comes out the same
      // (same script, same voice), so a red that is only "vo_sync" goes straight to the review instead of costing a
      // second montage with the slow cloned voice.
      const fixableRed = (qcSummary?.red ?? 0) - (qcSummary?.voSyncRed ?? 0);
      if (fase1 && isShort && !video.data.is_test && fixableRed > 0 && qcRetry < 1) {
        await queueStep(job.studio_id, { video_id: video.data.id, step: "render", idempotency_key: `render:${scriptId}:qc:${job.id}`, payload: { ...job.payload, qc_retry: qcRetry + 1 } });
        await lv.event("note", `Kwaliteitscontrole niet gehaald (${qcSummary!.red} rood): de montage wordt automatisch nog één keer gemaakt`);
        return { file: fileName, durationMs: plan.durationMs, qc: qcSummary, qcRetry: true, audioMode: kSettings.audio_mode };
      }
      if (["idea", "scripted", "rendering"].includes(video.data.status)) await db.from("yt_videos").update({ status: "review" }).eq("id", video.data.id);
      // Voice-over split: this production is delivered (counts once, whatever versions follow).
      if (voicePlan && video.data.channel_id) await createVoiceLedger(join(montage.rendersDir, "..", "voice-plan.json")).delivered(video.data.channel_id, video.data.format === "C" ? "long" : "short", video.data.id).catch(() => undefined);
      // Fase 3: every new montage gets a Viral-check before Milan reviews it. Never fails the montage.
      await queueStep(job.studio_id, { video_id: video.data.id, step: "viral", idempotency_key: `viral:${job.id}`, payload: { render_job: job.id } }).catch((e) => lv.event("error", `Viral-check niet klaargezet: ${e instanceof Error ? e.message : String(e)}`));
      return { file: fileName, durationMs: plan.durationMs, recordingMs: local.probe.durationMs, segments: plan.segments, voice: voice.length ? voiceName : null, characters, note, blurredRegions: blur.length, gameMuted: muteGame, qc: qcSummary, hookType: chosen?.type ?? null, coldOpen: !!chosen?.cold_open, thumbnails: thumbs.length, sync: sync ? { ok: sync.ok, summary: sync.summary } : null, audioMode: kSettings.audio_mode, localVoice: localVoiceName, music: mixPlan?.music?.title ?? null, sfx: mixPlan?.sfx.length ?? 0, mixNote, changes: fixed.changes, feedback: job.payload?.feedback ?? null, previousRender: job.payload?.previous_render ?? null, voicePlan, editor: editor ? { status: editor.status, main: editor.main } : null };
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(partial, { force: true });
    }
  }

  type PublicationRow = { id: string; channel_id: string; error: string | null; video_id: string; render_id: string | null; title: string; description: string; tags: string[]; category_id: string; language: "en" | "nl"; made_for_kids: boolean | null; contains_synthetic_media: boolean | null; visibility: "private" | "unlisted" | "public"; publish_at: string | null; status: string; youtube_video_id: string | null; is_test: boolean;
    /** Migration 040 (fase D4b); absent before. */
    captions_enabled?: boolean; thumbnail_ms?: number | null; captions_status?: string | null; thumbnail_status?: string | null };
  // All columns, so the worker keeps working before and after migration 040.
  const PUB_COLUMNS = "*";

  /** Loads a publication Milan sent; refuses anything that is not his explicit, complete choice. */
  async function publication(job: Job) {
    const pubId = String(job.payload?.publication_id ?? "");
    const { data: pub, error } = await db.from("yt_publications").select(PUB_COLUMNS).eq("id", pubId).eq("studio_id", job.studio_id).maybeSingle<PublicationRow>();
    if (error) throw new Error(error.message);
    if (!pub) throw new Error("Deze publicatie bestaat niet (meer)");
    if (pub.made_for_kids === null || pub.contains_synthetic_media === null) throw new Error("Doelgroep of AI-melding ontbreekt");
    // Test videos never go public or scheduled (2.2 chapter 23); the database refuses this too.
    if (pub.is_test && (pub.visibility !== "private" || pub.publish_at)) throw new Error("Een testvideo blijft altijd privé");
    const setPub = async (fields: Record<string, unknown>) => {
      const res = await db.from("yt_publications").update(fields).eq("id", pub.id);
      if (res.error) throw new Error(`Publicatie niet bijgewerkt: ${res.error.message}`);
    };
    return { pub, setPub };
  }

  /** Final state once YouTube accepted the visibility: publication and video show the same. */
  async function settlePublication(pub: PublicationRow, videoId: string, setPub: (f: Record<string, unknown>) => Promise<void>) {
    const status = pub.publish_at ? "scheduled" : pub.visibility === "private" ? "uploaded" : "published";
    await setPub({ status, error: null });
    // Opschonen 13-11-2026: on YouTube = live (or planned). A private upload is live too (privacy_status says who can see it).
    const videoStatus = status === "scheduled" ? { status: "scheduled" } : { status: "published", published_at: new Date().toISOString() };
    const video = await db.from("yt_videos").update({ youtube_video_id: videoId, privacy_status: pub.visibility, scheduled_at: pub.publish_at, ...videoStatus }).eq("id", pub.video_id);
    if (video.error) log(`Videostatus niet bijgewerkt: ${video.error.message}`);
    // Nothing of this video waits any more: open steps (a new script, montage, check) are closed.
    const closed = await db.from("yt_jobs").update({ status: "cancelled", error: "Niet meer nodig: de video staat op YouTube" }).eq("video_id", pub.video_id).eq("status", "queued").in("step", ["script", "render", "suggest", "viral"]);
    if (closed.error) log(`Open stappen niet gesloten: ${closed.error.message}`);
    return status;
  }

  /**
   * Fase D4b: captions as a separate track and the chosen thumbnail. Never fails the step: the result is written
   * to the publication, so Milan sees what worked and why something did not.
   */
  /** The uploader of the channel this video belongs to; KIVOXEL (default) keeps the main sign-in. */
  async function uploaderOf(videoId: string): Promise<Uploader> {
    if (!publisher) throw new Error("YouTube is niet gekoppeld op deze pc");
    if (!publisher.uploaderFor) return publisher.uploader;
    const v = await db.from("yt_videos").select("channel_id").eq("id", videoId).single<{ channel_id: string | null }>();
    if (v.error) throw new Error(v.error.message);
    return v.data.channel_id ? publisher.uploaderFor(v.data.channel_id) : publisher.uploader;
  }

  async function extras(pub: PublicationRow, videoId: string, lv: Live, setPub: (f: Record<string, unknown>) => Promise<void>) {
    if (!publisher || pub.captions_enabled === undefined || !pub.render_id) return { captions: null, thumbnail: null };
    // "*": thumbnails only exist after migration 047.
    const render = await db.from("yt_renders").select("*").eq("id", pub.render_id).single<{ file_name: string; thumbnails?: StoredThumb[] }>();
    if (render.error) return { captions: null, thumbnail: null };
    const stamp = () => new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" });
    let captions: string | null = null;
    if (pub.captions_enabled && !(pub.captions_status ?? "").startsWith("Klaar")) {
      await lv.phase("Ondertitels naar YouTube");
      try {
        const srt = await readFile(join(publisher.rendersDir, srtFileName(render.data.file_name)), "utf8").catch(() => null);
        if (srt === null) captions = "Niet verstuurd: deze montage heeft nog geen ondertitelbestand. Maak de montage opnieuw (werker 57.2 of nieuwer).";
        else if (!srt.trim()) captions = "Niet verstuurd: deze montage heeft geen gesproken tekst.";
        else captions = `Klaar op ${stamp()} (spoor ${await (await uploaderOf(pub.video_id)).insertCaption(videoId, pub.language, srt)})`;
      } catch (e) {
        captions = `Mislukt: ${e instanceof Error ? e.message : String(e)}`;
      }
      await setPub({ captions_status: captions.slice(0, 300) });
      await lv.event(captions.startsWith("Klaar") ? "note" : "log", `Ondertitels: ${captions}`);
    }
    let thumbnail: string | null = null;
    if (pub.thumbnail_ms !== null && pub.thumbnail_ms !== undefined && publisher.frame) {
      await lv.phase("Thumbnail naar YouTube");
      const file = join(publisher.tmpDir ?? publisher.rendersDir, `thumb-${pub.id}.jpg`);
      // Fase C: one of the made thumbnails (with text) when Milan chose it; otherwise a plain frame as before.
      const made = (render.data.thumbnails ?? []).find((t) => t.at_ms === pub.thumbnail_ms);
      try {
        const picture = made ? await readFile(join(publisher.rendersDir, made.file)).catch(() => null) : null;
        if (picture) await (await uploaderOf(pub.video_id)).setThumbnail(videoId, picture);
        else {
          await publisher.frame(join(publisher.rendersDir, render.data.file_name), pub.thumbnail_ms, file);
          await (await uploaderOf(pub.video_id)).setThumbnail(videoId, await readFile(file));
        }
        thumbnail = picture && made ? `Klaar op ${stamp()} (thumbnail "${made.label}")` : `Klaar op ${stamp()} (beeld op ${(pub.thumbnail_ms / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} s)`;
      } catch (e) {
        thumbnail = `Mislukt: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        await rm(file, { force: true });
      }
      await setPub({ thumbnail_status: thumbnail.slice(0, 300) });
      await lv.event(thumbnail.startsWith("Klaar") ? "note" : "log", `Thumbnail: ${thumbnail}`);
    }
    return { captions, thumbnail };
  }

  /**
   * 23-11-2026: a track whose licence asks for a credit (an Uppbeat free download) gets its credit line in the description
   * of exactly the version that uses it. On Milan's paid plan with the channel on the safelist no credit is needed, so
   * nothing is added. Never twice; never past YouTube's 5000 bytes.
   */
  async function withMusicCredit(description: string, files: string[]): Promise<string> {
    if (!files.length || !montage?.media) return description;
    const lib = await montage.media.music().catch(() => null);
    const credits = [...new Set((lib?.tracks ?? []).filter((t) => files.includes(t.file) && t.credit).map((t) => t.credit!))].filter((c) => !description.includes(c));
    if (!credits.length) return description;
    const next = [description.trim(), credits.join("\n")].filter(Boolean).join("\n\n");
    return Buffer.byteLength(next, "utf8") <= 5000 ? next : description;
  }

  const visibilityWord = (pub: PublicationRow) => (pub.publish_at ? "ingepland" : pub.visibility === "private" ? "privé" : pub.visibility === "public" ? "openbaar" : "verborgen");

  /** Upload to YouTube (fase D3, D4). Only for a publication that Milan sent (status queued). */
  async function upload(job: Job, lv: Live) {
    if (!publisher) throw new Error("YouTube is niet ingesteld in deze werker");
    const { pub, setPub } = await publication(job);
    let videoId = pub.youtube_video_id;
    let bytes = 0;
    let adopted = false;
    if (!videoId) {
      if (pub.status !== "queued" && pub.status !== "uploading") throw new Error("Deze publicatie staat niet klaar om te uploaden");
      // The same checks as the screen: Milan chose title, audience, AI notice and montage himself.
      if (!pub.title.trim() || !pub.render_id) throw new Error("Titel of montage ontbreekt");
      const render = await db.from("yt_renders").select("file_name, video_id, qc").eq("id", pub.render_id).single<{ file_name: string; video_id: string; qc: { audio?: { musicFiles?: string[] } } | null }>();
      if (render.error) throw new Error(render.error.message);
      if (render.data.video_id !== pub.video_id) throw new Error("Deze montage hoort niet bij deze video");
      if (publisher.tokensChannelId) {
        // Fase 0.5: the right YouTube channel, before a single byte goes out. A video without a channel is KIVOXEL's (default).
        const v = await db.from("yt_videos").select("channel_id").eq("id", pub.video_id).single<{ channel_id: string | null }>();
        if (v.error) throw new Error(v.error.message);
        const ch = v.data.channel_id
          ? await db.from("yt_channels").select("id, name, youtube_channel_id, is_default").eq("id", v.data.channel_id).maybeSingle<{ id: string; name: string; youtube_channel_id: string | null; is_default: boolean }>()
          : await db.from("yt_channels").select("id, name, youtube_channel_id, is_default").eq("studio_id", job.studio_id).eq("is_default", true).maybeSingle<{ id: string; name: string; youtube_channel_id: string | null; is_default: boolean }>();
        const problem = uploadChannelProblem(ch.data ? { name: ch.data.name, youtubeChannelId: ch.data.youtube_channel_id, isDefault: ch.data.is_default } : null, ch.data ? await publisher.tokensChannelId(ch.data.id) : null);
        if (problem) throw new Error(problem);
      }
      {
        // 20-11-2026: never a Fortnite/Roblox/GTA/CoD recording on KIVOXEL (or Minecraft-only channel), whatever went wrong before.
        const gi = await videoGameInfo(pub.video_id, job.studio_id);
        const wrong = wrongChannelProblem(gi.profile, gi.label);
        if (wrong) throw new Error(wrong);
      }
      // 22-11-2026, Wachtrij YouTube: when videos of this channel already wait in line, a new one joins at the back
      // instead of jumping ahead, so the order Milan sent them in stays the order they go to YouTube.
      const myWait = parseWait(pub.error);
      if (!myWait) {
        const ahead = await db.from("yt_publications").select("id").eq("channel_id", pub.channel_id).eq("status", "queued").is("youtube_video_id", null).like("error", "Wachtrij YouTube%").neq("id", pub.id).limit(1).returns<{ id: string }[]>();
        if (!ahead.error && ahead.data?.length) {
          const at = new Date().toISOString();
          const note = waitNote({ since: at, retryAt: at, reason: "Achter in de wachtrij: er wachten al video's van dit kanaal." });
          await setPub({ status: "queued", error: note });
          await lv.event("note", "In de Wachtrij YouTube gezet, achter de video's die er al staan.");
          return { deferred: "line" };
        }
      }
      await setPub({ status: "uploading", error: null });
      await lv.phase(`Uploaden naar YouTube (${visibilityWord(pub)})`, 0);
      const started = Date.now();
      let quotaWhy = "";
      const result = await (await uploaderOf(pub.video_id))
        .upload({
        key: pub.id,
        file: join(publisher.rendersDir, render.data.file_name),
        meta: { title: pub.title, description: await withMusicCredit(pub.description, render.data.qc?.audio?.musicFiles ?? []), tags: pub.tags, category_id: pub.category_id, language: pub.language, made_for_kids: pub.made_for_kids!, contains_synthetic_media: pub.contains_synthetic_media!, visibility: pub.visibility, publish_at: pub.publish_at },
        signal: lv.signal,
        onProgress: (sent, total) => {
          const seconds = (Date.now() - started) / 1000;
          const bps = seconds > 1 ? sent / seconds : null;
          void lv.progress({ progress: total ? sent / total : null, metrics: { sent_bytes: sent, total_bytes: total, bytes_per_s: bps, eta_ms: bps ? Math.round(((total - sent) / bps) * 1000) : null } });
        },
        onEvent: (m) => lv.event("log", m),
      })
        .catch((e: unknown) => {
          // Quota guard (17-11-2026): the day's YouTube quota is used up. Retrying only fails again, so the video goes
          // straight back to "Klaar voor YouTube" with a clear note instead of ending as Mislukt after five tries.
          if (e instanceof Error && isQuotaError(e.message)) {
            quotaWhy = e.message;
            return null;
          }
          throw e;
        });
      if (!result) {
        // 22-11-2026, Wachtrij YouTube: not back to "concept" but in line. It keeps its place (since) and the worker
        // tries again by itself (24 hours after a refusal by the channel limit, after midnight Pacific for the quota).
        const now = Date.now();
        const note = waitNote({ since: myWait?.since ?? new Date(now).toISOString(), retryAt: new Date(retryAfter(quotaWhy, now)).toISOString(), reason: quotaWhy });
        await setPub({ status: "queued", error: note });
        await lv.event("note", `In de Wachtrij YouTube: ${quotaWhy}`.slice(0, 500));
        return { deferred: "quota", waiting: true, reason: quotaWhy.slice(0, 500) };
      }
      videoId = result.videoId;
      bytes = result.bytes;
      adopted = result.adopted;
      await setPub({ youtube_video_id: videoId, status: "processing", error: null });
      await lv.event("milestone", `Geüpload: https://youtu.be/${videoId} (${visibilityWord(pub)})`);
    }
    // Processing at YouTube: ask now and then (1 unit each), at most about 10 minutes.
    await lv.phase("YouTube verwerkt de video");
    const times = publisher.pollTimes ?? 20;
    for (let i = 0; i < times; i++) {
      const p = await (await uploaderOf(pub.video_id)).processing(videoId);
      if (p.uploadStatus === "rejected" || p.uploadStatus === "failed" || p.uploadStatus === "deleted" || p.uploadStatus === "missing" || p.processingStatus === "failed" || p.processingStatus === "terminated") {
        await setPub({ status: "failed", error: `YouTube: ${p.uploadStatus}${p.reason ? ` (${p.reason})` : ""}`.slice(0, 500) });
        throw new Error(`YouTube verwerkte de video niet: ${p.uploadStatus}${p.reason ? ` (${p.reason})` : ""}`);
      }
      if (p.privacyStatus && p.privacyStatus !== pub.visibility) await lv.event("note", `Let op: YouTube meldt zichtbaarheid ${p.privacyStatus}, gevraagd was ${pub.visibility}`);
      if (p.uploadStatus === "processed" || p.processingStatus === "succeeded") {
        const extra = await extras(pub, videoId, lv, setPub);
        const status = await settlePublication(pub, videoId, setPub);
        return { youtube_video_id: videoId, bytes, adopted, processed: true, status, publish_at: pub.publish_at, ...extra };
      }
      await new Promise((r) => setTimeout(r, publisher.pollMs ?? 30_000));
    }
    // Still processing: the upload itself is done; the screen shows the link and YouTube finishes on its own.
    const extra = await extras(pub, videoId, lv, setPub);
    const status = await settlePublication(pub, videoId, setPub);
    return { youtube_video_id: videoId, bytes, adopted, processed: false, status, publish_at: pub.publish_at, ...extra };
  }

  /** Fase D4: only the visibility of a video already on YouTube (schedule, publish now, back to private). */
  async function publish(job: Job, lv: Live) {
    if (!publisher) throw new Error("YouTube is niet ingesteld in deze werker");
    const { pub, setPub } = await publication(job);
    if (!pub.youtube_video_id) throw new Error("Deze video staat nog niet op YouTube");
    if (pub.status !== "queued") throw new Error("Deze publicatie staat niet klaar");
    // Fase D4b: only captions and thumbnail, the visibility stays as it is.
    if (job.payload?.action === "extras") {
      const extra = await extras(pub, pub.youtube_video_id, lv, setPub);
      const status = await settlePublication(pub, pub.youtube_video_id, setPub);
      return { youtube_video_id: pub.youtube_video_id, status, publish_at: pub.publish_at, extras: true, ...extra };
    }
    await lv.phase(pub.publish_at ? "Inplannen bij YouTube" : pub.visibility === "private" ? "Op privé zetten bij YouTube" : "Publiceren bij YouTube");
    await (await uploaderOf(pub.video_id)).setStatus(pub.youtube_video_id, { made_for_kids: pub.made_for_kids!, contains_synthetic_media: pub.contains_synthetic_media!, visibility: pub.visibility, publish_at: pub.publish_at });
    const check = await (await uploaderOf(pub.video_id)).processing(pub.youtube_video_id);
    if (check.privacyStatus && check.privacyStatus !== pub.visibility) await lv.event("note", `Let op: YouTube meldt zichtbaarheid ${check.privacyStatus}, gevraagd was ${pub.visibility}`);
    const status = await settlePublication(pub, pub.youtube_video_id, setPub);
    return { youtube_video_id: pub.youtube_video_id, status, publish_at: pub.publish_at };
  }

  /**
   * Fase 1.6: 10-15 tags, 3 titles and a description for the publication screen. The answer goes to yt_jobs.result;
   * nothing is put in the draft automatically. Test videos get fixed suggestions without Gemini (free).
   */
  async function suggest(job: Job) {
    if (!job.video_id) throw new Error("Deze stap hoort niet bij een video");
    type VideoRow = { id: string; format: Format; language: "en" | "nl"; is_test: boolean; channel_id: string | null };
    const video = await db.from("yt_videos").select("id, format, language, is_test, channel_id").eq("id", job.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
    if (video.error) throw new Error(video.error.message);
    const kind = video.data.format === "C" ? "long" : "short";
    if (video.data.is_test) return testSuggestions({ kind });
    if (!ai) throw new Error(NO_KEY);
    type ScriptRow = { hook: string; lines: ScriptLine[]; hooks?: { first_line: string }[] | null; chosen_hook?: number | null };
    const [scriptRow, channel, settings, used] = await Promise.all([
      db.from("yt_scripts").select("*").eq("video_id", video.data.id).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle<ScriptRow>(),
      video.data.channel_id ? db.from("yt_channels").select("name, audience, banned_words").eq("id", video.data.channel_id).maybeSingle<{ name: string; audience: string | null; banned_words: string[] | null }>() : Promise.resolve({ data: null }),
      db.from("yt_settings").select("private_terms").eq("studio_id", job.studio_id).maybeSingle<{ private_terms: string[] | null }>(),
      db.from("yt_publications").select("tags").eq("studio_id", job.studio_id).limit(50).returns<{ tags: string[] }[]>(),
    ]);
    const counts = new Map<string, number>();
    for (const p of used.data ?? []) for (const t of p.tags ?? []) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
    const learned = await learning(job.studio_id, video.data.channel_id);
    const forbidden = [...(settings.data?.private_terms ?? []), ...(channel.data?.banned_words ?? [])];
    const s = scriptRow.data;
    const p = job.payload ?? {};
    const input: SuggestInput = {
      language: video.data.language,
      kind,
      channel: channel.data ? { name: channel.data.name, audience: channel.data.audience } : null,
      game: await videoGame(video.data.id, job.studio_id),
      title: typeof p.title === "string" ? p.title.slice(0, 100) : "",
      description: typeof p.description === "string" ? p.description.slice(0, 2000) : "",
      narration: (s?.lines ?? []).map((l) => l.text),
      hook: s ? (s.hooks?.[s.chosen_hook ?? -1]?.first_line ?? s.hook) : null,
      // Defaults Milan chose first, then the tags he kept before, then what he used most.
      usedTags: [...new Set([...learned.defaults, ...learned.liked, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)].map((t) => t.toLowerCase()))].filter((t) => !learned.disliked.includes(t)),
      forbidden,
      dislikedTags: learned.disliked,
      likedTitles: learned.titles,
    };
    await reserve(job, 1);
    const { json } = await paid(job, () => ai.gemini.generateText(suggestPrompt(input)));
    const parsed = parseSuggestions(json, forbidden, learned.disliked);
    if ("error" in parsed) throw new Error(`Suggesties van de analysedienst onbruikbaar: ${parsed.error}`);
    // 20-11-2026: no "Minecraft" in titles, tags or description of a Fortnite/Roblox/GTA/CoD video.
    const g = input.game ?? "minecraft";
    return { ...parsed, titles: parsed.titles.map((t) => fixGameName(t, g)), tags: [...new Set(parsed.tags.map((t) => fixGameName(t, g)))], description: fixGameName(parsed.description, g) };
  }

  /**
   * Fase 2: what Milan did with earlier suggestions on this channel (kept, removed, titles picked) and his default tags.
   * Before migration 049 (or on any error) this is empty and the suggestions work as before.
   */
  async function learning(studioId: string, channelId: string | null): Promise<{ defaults: string[]; liked: string[]; disliked: string[]; titles: string[] }> {
    const none = { defaults: [], liked: [], disliked: [], titles: [] };
    try {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      let ev = db.from("studio_events").select("action, screen, at, channel_id, metadata").eq("studio_id", studioId).gte("at", since).in("action", ["ai_tag_accepted", "ai_tag_removed", "tag_added", "tag_removed", "ai_title_used"]).order("at", { ascending: false }).limit(1000);
      if (channelId) ev = ev.eq("channel_id", channelId);
      const [events, prefs, offered] = await Promise.all([
        ev.returns<StudioEvent[]>(),
        db.from("studio_preferences").select("id, channel_id, key, value, updated_at").eq("studio_id", studioId).eq("key", "default_tags").returns<Preference[]>(),
        db.from("yt_jobs").select("video_id, result").eq("studio_id", studioId).eq("step", "suggest").eq("status", "done").order("created_at", { ascending: false }).limit(30).returns<{ video_id: string; result: unknown }[]>(),
      ]);
      if (events.error || prefs.error) return none;
      // Offered tags against the tags that really went to YouTube.
      const ids = [...new Set((offered.data ?? []).map((o) => o.video_id))];
      const pubs = ids.length ? await db.from("yt_publications").select("video_id, tags, status").in("video_id", ids).neq("status", "draft").returns<{ video_id: string; tags: string[]; status: string }[]>() : { data: [] };
      const finalOf = new Map((pubs.data ?? []).map((p) => [p.video_id, p.tags]));
      const history = (offered.data ?? []).flatMap((o) => {
        const s = readSuggestions(o.result);
        const final = finalOf.get(o.video_id);
        return s && final && s.source === "ai" ? [{ offered: s.tags, final }] : [];
      });
      const { liked, disliked } = learnTags(history, events.data ?? []);
      return { defaults: defaultTags(prefs.data ?? [], channelId), liked: liked.slice(0, 20), disliked: disliked.slice(0, 30), titles: likedTitles(events.data ?? []) };
    } catch {
      return none;
    }
  }

  /**
   * Fase 3.2: the Viral-check of the newest montage of a video. Rules on measured facts always (free); Gemini listens to
   * the voice-over only for test videos (fixed answer, free) or when paid processing is on (within the monthly cap).
   */
  async function viral(job: Job, lv: Live) {
    if (!job.video_id) throw new Error("Deze stap hoort niet bij een video");
    type VideoRow = { id: string; format: Format; language: "en" | "nl"; is_test: boolean; channel_id: string | null; recording_id: string | null };
    const video = await db.from("yt_videos").select("id, format, language, is_test, channel_id, recording_id").eq("id", job.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
    if (video.error) throw new Error(video.error.message);
    type RenderRow = { id: string; script_id: string; file_name: string; duration_ms: number; width: number; height: number; voice_name: string | null };
    const render = await db.from("yt_renders").select("id, script_id, file_name, duration_ms, width, height, voice_name").eq("video_id", video.data.id).order("created_at", { ascending: false }).limit(1).maybeSingle<RenderRow>();
    if (render.error) throw new Error(render.error.message);
    if (!render.data) throw new Error("Deze video heeft nog geen montage");
    type ScriptRow = { id: string; top_line: string | null; hook: string; lines: ScriptLine[]; edit_plan: Segment[]; target_ms: number; hooks?: unknown; loop_line?: string | null; chosen_hook?: number | null };
    const script = await db.from("yt_scripts").select("*").eq("id", render.data.script_id).single<ScriptRow>();
    if (script.error) throw new Error(script.error.message);
    const kind = video.data.format === "C" ? "long" : "short";

    // The cut as it was rendered: the chosen hook can move the opening (cold open).
    const linked = await db.from("yt_video_moments").select("position, yt_moments(start_ms, end_ms, peak_ms)").eq("video_id", video.data.id).order("position").limit(1).returns<Array<{ yt_moments: { start_ms: number; end_ms: number; peak_ms: number | null } }>>();
    const main = linked.data?.[0]?.yt_moments ?? null;
    const hooks = parseHooks(script.data.hooks);
    const chosen = typeof script.data.chosen_hook === "number" ? (hooks[script.data.chosen_hook] ?? null) : null;
    const cut = applyHook(script.data, chosen, main ? (main.peak_ms ?? Math.round((main.start_ms + main.end_ms) / 2)) : null);

    const [channel, settings, others, refs] = await Promise.all([
      video.data.channel_id ? db.from("yt_channels").select("language, audience").eq("id", video.data.channel_id).maybeSingle<{ language: "en" | "nl"; audience: string | null }>() : Promise.resolve({ data: null }),
      db.from("yt_settings").select("speaking_rate").eq("studio_id", job.studio_id).maybeSingle<{ speaking_rate: number | null }>(),
      video.data.channel_id ? db.from("yt_videos").select("id").eq("channel_id", video.data.channel_id).neq("id", video.data.id).eq("is_test", false).returns<{ id: string }[]>() : Promise.resolve({ data: [] as { id: string }[] }),
      db.from("yt_reference_videos").select("title, tags, duration_s, is_short, published_at, views, ratio, hook").eq("studio_id", job.studio_id).eq("channel_id", video.data.channel_id ?? "").returns<ReferenceVideo[]>(),
    ]);
    const otherIds = (others.data ?? []).map((v) => v.id);
    const prev = otherIds.length ? await db.from("yt_renders").select("voice_name").in("video_id", otherIds.slice(0, 100)).not("voice_name", "is", null).order("created_at", { ascending: false }).limit(10).returns<{ voice_name: string }[]>() : { data: [] };

    // Dead parts of the recording (the free FFmpeg signal pass, cached on this pc).
    let dead = null;
    let peaks = null;
    if (ai?.signals && video.data.recording_id) {
      try {
        const rec = await db.from("yt_recordings").select("fingerprint, duration_ms").eq("id", video.data.recording_id).single<{ fingerprint: string; duration_ms: number | null }>();
        if (rec.data?.duration_ms) {
          const local = await store.get(rec.data.fingerprint);
          if (!local) throw new Error("de opname staat niet op deze pc");
          const t = buildTimeline(await ai.signals(local.file, rec.data.fingerprint, rec.data.duration_ms, { signal: lv.signal }));
          dead = t.dead;
          peaks = t.peaks;
        }
      } catch (e) {
        await lv.event("log", `Saaie stukken niet gemeten: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const input = {
      game: await videoGame(video.data.id, job.studio_id),
      kind,
      language: channel.data?.language ?? video.data.language,
      audience: channel.data?.audience ?? null,
      hook: cut.hook,
      lines: cut.lines,
      loopLine: script.data.loop_line ?? null,
      segments: cut.segments,
      durationMs: render.data.duration_ms,
      width: render.data.width,
      height: render.data.height,
      voiceName: render.data.voice_name,
      speakingRate: settings.data?.speaking_rate != null ? Number(settings.data.speaking_rate) : null,
      previousVoices: (prev.data ?? []).map((r) => r.voice_name),
      dead,
      peaks,
    } as const;
    const reference = summarizeReference(refs.data ?? [], kind);

    // The listening check (fase 3: Milan chose "ook luistercheck"): Gemini hears the real voice-over.
    let listen: ListenResult | null = null;
    let source: "ai" | "rules" | "test" = "rules";
    if (video.data.is_test) {
      listen = testListen();
      source = "test";
    } else if (ai && montage && (await paidEnabled(job.studio_id))) {
      await lv.phase("Luisteren naar de voice-over", null);
      const audio = join(montage.tmpDir, `luister-${job.id}.mp3`);
      try {
        await montage.run(listenAudioArgs(join(montage.rendersDir, render.data.file_name), audio), montage.tmpDir, 3 * 60_000, { signal: lv.signal });
        await reserve(job, 2);
        const rules = buildViral({ ...input, segments: [...input.segments] }, null, reference).parts;
        const { json } = await paid(job, () => ai.gemini.analyseFile(audio, "audio/mpeg", listenPrompt({ ...input, segments: [...input.segments] }, rules)));
        const parsed = parseListen(json, render.data.duration_ms);
        if ("error" in parsed) await lv.event("error", `Luistercheck onbruikbaar (${parsed.error}); score alleen op regels`);
        else {
          listen = parsed;
          source = "ai";
        }
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        await lv.event("error", `Luistercheck mislukt: ${e instanceof Error ? e.message : String(e)}; score alleen op regels`);
      } finally {
        await rm(audio, { force: true });
      }
    } else await lv.event("note", "Luistercheck overgeslagen: betaalde verwerking staat uit (score alleen op regels, gratis)");

    const result = buildViral({ ...input, segments: [...input.segments] }, listen, reference);
    const insert = await db.from("yt_viral_checks").insert({ studio_id: job.studio_id, video_id: video.data.id, render_id: render.data.id, script_id: script.data.id, overall: result.overall, result, source, model: source === "ai" ? ai?.gemini.model : null, is_test: video.data.is_test });
    if (insert.error) throw new Error(insert.error.message);
    return { overall: result.overall, source, voice: result.parts.voice.score, script: result.parts.script.score, gameplay: result.parts.gameplay.score };
  }

  /** Fase 3.1: the best performing recent videos for the search terms of one channel. Only quota, no money. */
  async function reference(job: Job) {
    if (!research) throw new Error("YouTube is niet gekoppeld op deze pc; referentievideo's ophalen kan niet");
    const channelId = typeof job.payload?.channel_id === "string" ? job.payload.channel_id : null;
    if (!channelId) throw new Error("Geen kanaal opgegeven");
    const ch = await db.from("yt_channels").select("name, language, is_default, slug, safety_profile").eq("id", channelId).single<{ name: string; language: "en" | "nl"; is_default: boolean; slug: string | null; safety_profile: string | null }>();
    if (ch.error) throw new Error(ch.error.message);
    const pref = await db.from("studio_preferences").select("value").eq("studio_id", job.studio_id).eq("channel_id", channelId).eq("key", "reference_queries").maybeSingle<{ value: unknown }>();
    const queries = Array.isArray(pref.data?.value) && pref.data.value.length ? (pref.data.value as string[]).slice(0, 3) : profileFor(ch.data).key === "spawnnado" ? profileFor(ch.data).games.slice(0, 3).map((g) => GAMES[g].queries[0]) : (nicheQueries(isDreamnestChannel({ id: channelId, ...ch.data }) ? "dreamnest" : "kivoxel", ch.data.language) ?? defaultQueries(ch.data.language));
    let saved = 0;
    for (const query of queries) {
      const found = (await research.search(query, ch.data.language)).filter((v) => v.views > 0).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 20);
      if (!found.length) continue;
      const del = await db.from("yt_reference_videos").delete().eq("studio_id", job.studio_id).eq("channel_id", channelId).eq("query", query);
      if (del.error) throw new Error(del.error.message);
      const ins = await db.from("yt_reference_videos").insert(found.map((v) => ({ studio_id: job.studio_id, channel_id: channelId, query, ...v, fetched_at: new Date().toISOString() })));
      if (ins.error) throw new Error(ins.error.message);
      saved += found.length;
    }
    return { queries, saved };
  }

  /**
   * Every hour: a step that has been running for 2 hours without a sign of life is stuck; it becomes "mislukt" with the
   * reason, so it shows up under Actie nodig with "Opnieuw proberen" instead of hanging around.
   */
  async function failStuck(now = Date.now()) {
    const limit = new Date(now - 2 * 3_600_000).toISOString();
    const { data, error } = await db.from("yt_jobs").select("id, step, video_id, heartbeat_at, locked_at").eq("status", "running").returns<{ id: string; step: string; video_id: string | null; heartbeat_at?: string | null; locked_at: string | null }[]>();
    if (error) return log(`Vastgelopen stappen niet nagekeken: ${error.message}`);
    for (const j of data ?? []) {
      const last = j.heartbeat_at ?? j.locked_at;
      if (!last || last > limit) continue;
      const upd = await db.from("yt_jobs").update({ status: "failed", error: "Vastgelopen: 2 uur geen voortgang", locked_by: null, locked_at: null, finished_at: new Date(now).toISOString() }).eq("id", j.id).eq("status", "running");
      if (upd.error) log(`Stap ${j.id} niet op mislukt gezet: ${upd.error.message}`);
      else {
        log(`Stap ${j.step} (${j.id}) vastgelopen: op mislukt gezet`);
        await afterFinalFailure(j);
      }
    }
  }

  /**
   * 22-11-2026, Wachtrij YouTube: every 2 minutes the worker sends the first video in line of each channel to YouTube,
   * once its time has come and nothing else uploads for that channel. One at a time per channel, oldest first, so the
   * order stays as Milan sent them. Videos refused before the queue existed (back in "concept" with a quota or limit
   * note) join the line once, in the order they were refused. Archived videos and videos already on YouTube drop out.
   */
  async function drainWaiting(now = Date.now()) {
    type Row = { id: string; studio_id: string; channel_id: string; video_id: string; status: string; error: string | null; updated_at: string; yt_videos: { status: string } | null };
    const cols = "id, studio_id, channel_id, video_id, status, error, updated_at, yt_videos(status)";
    const [waiting, refused] = await Promise.all([
      db.from("yt_publications").select(cols).eq("status", "queued").is("youtube_video_id", null).like("error", "Wachtrij YouTube%").limit(500).returns<Row[]>(),
      db.from("yt_publications").select(cols).eq("status", "draft").is("youtube_video_id", null).not("error", "is", null).limit(500).returns<Row[]>(),
    ]);
    if (waiting.error || refused.error) return log(`Wachtrij YouTube niet nagekeken: ${(waiting.error ?? refused.error)!.message}`);
    // Refusals from before the queue: into the line, oldest refusal first (they keep that moment as "since").
    for (const r of (refused.data ?? []).filter((x) => oldRefusal(x.error) && x.yt_videos?.status !== "archived").sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
      const at = new Date(r.updated_at).toISOString();
      const upd = await db.from("yt_publications").update({ status: "queued", error: waitNote({ since: at, retryAt: new Date(now).toISOString(), reason: (r.error ?? "").slice(0, 300) }) }).eq("id", r.id).eq("status", "draft");
      if (upd.error) log(`Publicatie ${r.id} niet in de wachtrij gezet: ${upd.error.message}`);
    }
    if ((refused.data ?? []).some((x) => oldRefusal(x.error))) return; // the next round sees them in line
    const list: (WaitingPub & { studioId: string; videoId: string })[] = [];
    for (const r of waiting.data ?? []) {
      const wait = parseWait(r.error);
      if (!wait) continue;
      if (r.yt_videos?.status === "archived") {
        // Archived while waiting: out of the line (back to concept, so nothing is sent).
        await db.from("yt_publications").update({ status: "draft", error: null }).eq("id", r.id).eq("status", "queued");
        continue;
      }
      list.push({ id: r.id, channelId: r.channel_id, wait, studioId: r.studio_id, videoId: r.video_id });
    }
    if (!list.length) return;
    // A channel with an upload that waits or runs goes on with that one first.
    const open = await db.from("yt_jobs").select("payload").eq("step", "upload").in("status", ["queued", "running"]).returns<{ payload: { publication_id?: string } | null }[]>();
    if (open.error) return log(`Wachtrij YouTube: lopende uploads niet nagekeken: ${open.error.message}`);
    const openIds = (open.data ?? []).map((j) => j.payload?.publication_id).filter((x): x is string => !!x);
    const busy = new Set<string>();
    if (openIds.length) {
      const chans = await db.from("yt_publications").select("channel_id").in("id", openIds).returns<{ channel_id: string }[]>();
      for (const c of chans.data ?? []) busy.add(c.channel_id);
    }
    for (const next of nextInLine(list, busy, now)) {
      const p = list.find((x) => x.id === next.id)!;
      try {
        await queueStep(p.studioId, { video_id: p.videoId, step: "upload", idempotency_key: `upload:${p.id}:wachtrij:${now}`, payload: { publication_id: p.id }, max_attempts: 5 });
        log(`Wachtrij YouTube: publicatie ${p.id} gaat nu naar YouTube`);
      } catch (e) {
        log(`Wachtrij YouTube: publicatie ${p.id} niet verstuurd: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * 20-11-2026: every 5 minutes, a montage that failed, was cancelled or got lost is started again once by the worker
   * itself (see revive.ts), so Milan does not have to click "Opnieuw proberen" for it.
   */
  async function reviveMontages(now = Date.now()) {
    const vids = await db.from("yt_videos").select("id, studio_id, status, review_note").in("status", ["rendering", "scripted"]).limit(500).returns<ReviveVideo[]>();
    if (vids.error) return log(`Montages niet nagekeken: ${vids.error.message}`);
    const ids = (vids.data ?? []).map((v) => v.id);
    if (!ids.length) return;
    const [jobs, scripts] = await Promise.all([
      db.from("yt_jobs").select("id, video_id, step, status, payload, created_at, finished_at, error").in("video_id", ids).in("step", ["render", "script"]).returns<(ReviveJob & { video_id: string })[]>(),
      db.from("yt_scripts").select("id, video_id, version, status").in("video_id", ids).returns<(ReviveScript & { video_id: string })[]>(),
    ]);
    if (jobs.error || scripts.error) return log(`Montages niet nagekeken: ${(jobs.error ?? scripts.error)!.message}`);
    for (const v of vids.data ?? []) {
      const r = reviveMontage(v, (jobs.data ?? []).filter((j) => j.video_id === v.id), (scripts.data ?? []).filter((s) => s.video_id === v.id), now);
      if (!r) continue;
      try {
        await queueStep(v.studio_id, { video_id: v.id, step: "render", idempotency_key: r.idempotency_key, payload: r.payload });
        if (v.status !== "rendering") await db.from("yt_videos").update({ status: "rendering" }).eq("id", v.id).eq("status", v.status);
        log(`Montage van video ${v.id} vanzelf opnieuw gestart (${r.why})`);
      } catch (e) {
        log(`Montage van video ${v.id} niet opnieuw gestart: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * 17-11-2026: YouTube makes a scheduled video public at its moment by itself; the Studio did not notice that, so the
   * video stayed under Ingepland. Once the moment has passed, publication and video move to Live (no YouTube call needed).
   */
  async function settleDueSchedules(now = Date.now()) {
    const at = new Date(now).toISOString();
    const due = await db.from("yt_publications").select("id, video_id, publish_at").eq("status", "scheduled").lte("publish_at", at).returns<{ id: string; video_id: string; publish_at: string }[]>();
    if (due.error) return log(`Ingeplande video's niet nagekeken: ${due.error.message}`);
    for (const p of due.data ?? []) {
      const pub = await db.from("yt_publications").update({ status: "published", visibility: "public", publish_at: null, error: null }).eq("id", p.id).eq("status", "scheduled");
      if (pub.error) {
        log(`Publicatie ${p.id} niet op live gezet: ${pub.error.message}`);
        continue;
      }
      const video = await db.from("yt_videos").update({ status: "published", privacy_status: "public", published_at: p.publish_at, scheduled_at: null }).eq("id", p.video_id).in("status", ["scheduled", "published"]);
      if (video.error) log(`Video ${p.video_id} niet op live gezet: ${video.error.message}`);
    }
    // A video planned without a publication row of its own (older data): the same, from its own planned moment.
    const videos = await db.from("yt_videos").update({ status: "published", privacy_status: "public" }).eq("status", "scheduled").not("youtube_video_id", "is", null).lte("scheduled_at", at).select("id");
    if (videos.error) log(`Ingeplande video's niet nagekeken: ${videos.error.message}`);
    const n = (due.data?.length ?? 0) + (videos.data?.length ?? 0);
    if (n) log(`${n} ingeplande video('s) staan nu live`);
  }

  /** Once a week per active channel: queue a reference step (only while YouTube is linked on this pc). */
  async function scheduleReference() {
    if (!research) return;
    const chans = await db.from("yt_channels").select("id, studio_id").eq("status", "active").returns<{ id: string; studio_id: string }[]>();
    for (const c of chans.data ?? []) {
      const last = await db.from("yt_reference_videos").select("fetched_at").eq("channel_id", c.id).order("fetched_at", { ascending: false }).limit(1).maybeSingle<{ fetched_at: string }>();
      if (last.error) return; // before migration 050
      if (last.data && Date.now() - Date.parse(last.data.fetched_at) < 7 * 86_400_000) continue;
      const week = Math.floor(Date.now() / (7 * 86_400_000));
      await queueStep(c.studio_id, { step: "reference", idempotency_key: `reference:${c.id}:${week}`, payload: { channel_id: c.id } }).catch((e) => log(`Referentievideo's niet klaargezet: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  const handlers: Record<string, (job: Job, lv: Live) => Promise<unknown>> = { intake, analyse, script, ...(montage ? { render } : {}) };
  /** Short steps that must not wait behind a montage of many minutes: they run in their own lane, next to the main one. */
  const fastHandlers: Record<string, (job: Job, lv: Live) => Promise<unknown>> = { suggest, viral, reference };
  /** 18-11-2026: uploads to YouTube in their own lane, so 24 uploads do not wait behind 35 montages (network, not CPU). */
  const uploadHandlers: Record<string, (job: Job, lv: Live) => Promise<unknown>> = publisher ? { upload, publish } : {};

  async function finish(job: Job, outcome: { result: unknown } | { error: string }) {
    const failed = "error" in outcome;
    const again = failed && job.attempts < job.max_attempts;
    const { error } = await db
      .from("yt_jobs")
      .update(
        failed
          ? { status: again ? "queued" : "failed", error: outcome.error.slice(0, 500), locked_by: null, locked_at: null, finished_at: again ? null : new Date().toISOString() }
          : { status: "done", result: outcome.result ?? {}, error: null, locked_by: null, finished_at: new Date().toISOString() },
      )
      .eq("id", job.id)
      .eq("locked_by", workerName);
    if (error) log(`Kon stap ${job.id} niet afronden: ${error.message}`);
    if (failed && !again) await afterFinalFailure(job);
  }

  /** A montage that failed for good: the video goes back to "Script klaar", so it does not stay on "Montage" forever. */
  async function afterFinalFailure(job: Pick<Job, "id" | "step" | "video_id">) {
    if (job.step !== "render" || !job.video_id) return;
    const { error } = await db.from("yt_videos").update({ status: "scripted" }).eq("id", job.video_id).eq("status", "rendering");
    if (error) log(`Videostatus na mislukte montage ${job.id} niet teruggezet: ${error.message}`);
  }

  /**
   * After a restart this worker no longer runs anything, so steps it had claimed are released straight away instead of
   * waiting 30 minutes: back in the queue while attempts are left, otherwise failed with a clear reason.
   */
  async function recover(): Promise<number> {
    type Running = Pick<Job, "id" | "step" | "video_id" | "attempts" | "max_attempts">;
    const { data, error } = await db.from("yt_jobs").select("id, step, video_id, attempts, max_attempts").eq("status", "running").eq("locked_by", workerName).returns<Running[]>();
    if (error) {
      log(`Onderbroken stappen niet nagekeken: ${error.message}`);
      return 0;
    }
    for (const job of data ?? []) {
      const again = job.attempts < job.max_attempts;
      const update = await db
        .from("yt_jobs")
        .update({ status: again ? "queued" : "failed", error: "Onderbroken: de werker is opnieuw gestart", locked_by: null, locked_at: null, finished_at: again ? null : new Date().toISOString() })
        .eq("id", job.id)
        .eq("locked_by", workerName);
      if (update.error) log(`Stap ${job.id} niet vrijgegeven: ${update.error.message}`);
      else if (!again) await afterFinalFailure(job);
      log(`Stap ${job.step} was onderbroken (${job.id}): ${again ? "opnieuw in de wachtrij" : "mislukt, te vaak geprobeerd"}`);
    }
    return data?.length ?? 0;
  }

  // The exported tick also runs the upload lane (after the main lane), so one tick handles every KIVOXEL step.
  const tickMain = () => runLane(handlers, "main");
  const tick = async () => {
    await tickMain();
    await tickUpload();
  };
  const tickFast = () => runLane(fastHandlers, "fast");
  const tickUpload = () => (Object.keys(uploadHandlers).length ? runLane(uploadHandlers, "upload") : Promise.resolve());
  let fastBusy = false;
  let uploadBusy = false;

  /**
   * Milan, 18-11-2026: "eerst uploads, als die allemaal naar YouTube zijn (alle kanalen), dan verder met montage, analyse
   * enzo". True while any upload or publish step waits or runs, for KIVOXEL (yt_jobs) or Dreamnest (dn_publish). A step
   * that is already running is never interrupted; only new montages, analyses and scripts wait. Unknown = not pending.
   */
  async function uploadsPending(): Promise<boolean> {
    const k = await db.from("yt_jobs").select("id").in("step", ["upload", "publish"]).in("status", ["queued", "running"]).limit(1).returns<{ id: string }[]>();
    if (!k.error && k.data?.length) return true;
    const d = await db.from("dn_render_jobs").select("id").eq("step", "dn_publish").in("status", ["queued", "running"]).limit(1).returns<{ id: string }[]>();
    return !d.error && !!d.data?.length;
  }
  let lastUploadWaitLog = 0;

  async function runLane(handlers: Record<string, (job: Job, lv: Live) => Promise<unknown>>, lane: "main" | "fast" | "upload") {
    if (lane === "main" ? busy : lane === "fast" ? fastBusy : uploadBusy) return;
    if (lane === "main") busy = true;
    else if (lane === "fast") fastBusy = true;
    else uploadBusy = true;
    try {
      for (;;) {
        if (lane === "main" && (await uploadsPending().catch(() => false))) {
          if (Date.now() - lastUploadWaitLog > 5 * 60_000) {
            lastUploadWaitLog = Date.now();
            log("Eerst de uploads naar YouTube; montage en analyse gaan daarna verder");
          }
          return;
        }
        const { data, error } = await db.rpc("claim_yt_job", { p_worker: workerName, p_steps: Object.keys(handlers) });
        if (error) {
          log(`Wachtrij niet bereikbaar: ${error.message}`);
          return;
        }
        const job = (data as Job[] | null)?.[0];
        if (!job) return;
        log(`Stap ${job.step} gestart (${job.id}, poging ${job.attempts})`);
        const lv = live(job);
        try {
          await lv.phase(STEP_PHASE[job.step] ?? job.step);
          if (job.attempts > 1) await lv.event("log", `Poging ${job.attempts} van ${job.max_attempts}`);
          const result = await handlers[job.step](job, lv);
          for (const note of stepNotes(job.step, result as Record<string, unknown>)) await lv.event("note", note);
          if (STEP_MILESTONE[job.step]) await lv.event("milestone", STEP_MILESTONE[job.step]);
          lv.stop();
          await finish(job, { result });
          log(`Stap ${job.step} klaar (${job.id})`);
        } catch (e) {
          lv.stop();
          if (e instanceof CancelledError || lv.signal.aborted) {
            await lv.event("log", "Geannuleerd: FFmpeg is gestopt");
            await finishCancelled(job);
            log(`Stap ${job.step} geannuleerd (${job.id})`);
            continue;
          }
          const message = e instanceof Error ? e.message : String(e);
          await lv.event("error", message);
          await finish(job, { error: message });
          log(`Stap ${job.step} mislukt (${job.id}): ${message}`);
        }
      }
    } finally {
      if (lane === "main") busy = false;
      else if (lane === "fast") fastBusy = false;
      else uploadBusy = false;
    }
  }

  return {
    start(intervalMs = 5000) {
      // Fase 2: old Studio events are not needed to learn (migration 049; quietly nothing before it).
      void Promise.resolve(db.rpc("prune_studio_events", { p_days: 180 })).catch(() => undefined);
      void recover().then(() => Promise.all([tickMain(), tickFast(), tickUpload()]));
      timer = setInterval(() => void Promise.all([tickMain(), tickFast(), tickUpload()]), intervalMs);
      // Fase 3.1: reference videos once a week (checked at start and every 6 hours).
      void scheduleReference().catch(() => undefined);
      setInterval(() => void scheduleReference().catch(() => undefined), 6 * 60 * 60_000);
      setInterval(() => void failStuck().catch(() => undefined), 60 * 60_000);
      // 17-11-2026: a scheduled video moves to Live once its moment has passed (checked at start and every 5 minutes).
      void settleDueSchedules().catch(() => undefined);
      setInterval(() => void settleDueSchedules().catch(() => undefined), 5 * 60_000);
      // 20-11-2026: failed, cancelled or lost montages start again once by themselves (checked at start and every 5 minutes).
      void reviveMontages().catch(() => undefined);
      // 22-11-2026: the Wachtrij YouTube (checked at start and every 2 minutes).
      void drainWaiting().catch(() => undefined);
      setInterval(() => void drainWaiting().catch(() => undefined), 2 * 60_000);
      setInterval(() => void reviveMontages().catch(() => undefined), 5 * 60_000);
    },
    recover,
    tick,
    tickFast,
    scheduleReference,
    failStuck,
    settleDueSchedules,
    reviveMontages,
    drainWaiting,
    stop() {
      if (timer) clearInterval(timer);
    },
    poke: () => void Promise.all([tickMain(), tickFast(), tickUpload()]),
    /** Dreamnest (only with FEATURE_DREAMNEST=true) asks this before each step: KIVOXEL goes first. Read-only. */
    mainBusy: () => busy,
    uploadsPending,
  };
}

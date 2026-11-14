// The queue in Supabase (table yt_jobs, migration 007). The dashboard puts steps in; this worker picks them up.
// Uses the service key from worker/.env.local; that key never goes into the app or Git.
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { applyHook, parseHooks } from "../lib/youtube/hooks.ts";
import { STEP_MILESTONE, STEP_PHASE, stepNotes } from "../lib/youtube/live.ts";
import { parseSuggestions, readSuggestions, suggestPrompt, testSuggestions, type SuggestInput } from "../lib/youtube/suggest.ts";
import { defaultTags, learnTags, likedTitles, type Preference, type StudioEvent } from "../lib/youtube/learning.ts";
import { buildViral, defaultQueries, listenAudioArgs, listenPrompt, parseListen, summarizeReference, testListen, type ListenResult, type ReferenceVideo } from "../lib/youtube/viral.ts";
import type { Research } from "./research.ts";
import { ANALYSIS_STAGES, expectedThinkingMs, renderProgress, stageProgress, thinkingShare } from "../lib/youtube/progress.ts";
import { buildAss, buildSrt, cleanRegions, narration, renderArgs, renderFileName, renderSize, segmentOverlays, srtFileName, type VoiceClip } from "../lib/youtube/render.ts";
import { CancelledError, type RunOptions } from "./ffmpeg.ts";
import { buildTimeline, deadReason, signalHints, timelineSummary, type Signals, type Timeline } from "../lib/youtube/footage.ts";
import type { Uploader } from "./youtubeUpload.ts";
import { uploadChannelProblem } from "../lib/youtube/connection.ts";
import { firstActionMs, needsLoudnessFix, parseQcLog, pickLoudnessFix, qcChecklist, type Loudness, type QcItem, type QcProbe } from "../lib/youtube/qc.ts";
import { BOOST_LIMITS } from "./ffmpeg.ts";
import { thumbArgs, thumbAss, thumbFileName, thumbnailPlans, THUMB_SIZE, type StoredThumb } from "../lib/youtube/thumbnails.ts";
import { costCents, type Gemini, type Usage } from "./gemini.ts";
import type { Store } from "./store.ts";
import type { Tts } from "./tts.ts";

/**
 * FFmpeg montage on this pc: previews go to `rendersDir`, work files to a temporary folder in `tmpDir`.
 * `voice` is null while GOOGLE_TTS_API_KEY is missing from worker/.env.local.
 */
export type Montage = {
  rendersDir: string;
  tmpDir: string;
  run: (args: string[], cwd: string, timeoutMs: number, options?: RunOptions) => Promise<void>;
  /** Quality pass over a finished montage (fase C1); optional so older setups keep working. */
  measure?: (file: string, cwd: string, options?: RunOptions) => Promise<{ probe: QcProbe; stderr: string }>;
  boost?: (input: string, output: string, cwd: string, options?: RunOptions & { limit?: number }) => Promise<void>;
  loudness?: (file: string, cwd: string) => Promise<{ integratedLufs: number | null; truePeakDb: number | null }>;
  voice: { tts: Tts; usage: { reserve: (characters: number) => Promise<unknown> } } | null;
};

/** YouTube upload (fase D3); null while YouTube is not set up in worker/.env.local. */
/** frame: one picture of a montage as JPEG (fase D4b), written to tmpDir. */
export type Publisher = { uploader: Uploader; rendersDir: string;
  /** The YouTube channel ID the tokens on this pc belong to (free, from the token file). Checked before every new upload. */
  tokensChannelId?: (channelRowId: string) => Promise<string | null>; tmpDir?: string; frame?: (input: string, atMs: number, output: string) => Promise<void>; pollMs?: number; pollTimes?: number };

/** The paid analysis service; null while GEMINI_API_KEY is missing from worker/.env.local. */
export type Ai = {
  gemini: Gemini;
  makeProxy: (file: string, fingerprint: string, durationMs: number, options?: RunOptions) => Promise<string>;
  removeProxy: (file: string) => Promise<void>;
  /** Fase C: one part of the small copy, for long recordings. Optional: without it the whole copy goes at once. */
  cutProxy?: (proxy: string, startMs: number, lengthMs: number, options?: RunOptions) => Promise<string>;
  /** Fase 3: free FFmpeg signals (stillness, black, loud moments) before the paid analysis. Optional: without it the analysis works as before. */
  signals?: (file: string, fingerprint: string, durationMs: number, options?: RunOptions) => Promise<Signals>;
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
          const prompt = analysisPrompt(row.duration_ms, chunk);
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
          answered += 1;
          found.push(parsed.moments);
          rejected.push(...parsed.rejected);
          if (many) await lv.event("note", `Deel ${chunk.index + 1} van ${chunk.count}: ${parsed.moments.length} momenten`);
        } finally {
          if (file !== proxy) await ai.removeProxy(file);
        }
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
    const { moments: found, rejected } = row.is_test ? { moments: testMoments(row.duration_ms), rejected: [] as string[] } : await aiMoments(job, { ...row, duration_ms: row.duration_ms }, lv);
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
      model: row.is_test ? null : ai?.gemini.model,
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

    const videos = await planAndQueue(job, row.id, row.is_test, durationMs, moments);
    return { moments: moments.length, usable: moments.filter((m) => m.hasContext && m.hasPayoff).length, videos, source, rejected };
  }

  /** Plans the videos of a recording and queues a script per video; returns how many videos were planned. */
  async function planAndQueue(job: Job, recordingId: string, isTest: boolean, durationMs: number, moments: Moment[]): Promise<number> {
    let plans = planVideos(moments, durationMs, (m) => m.id ?? `${m.kind}:${m.startMs}`);
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

  /** Script: hook, top line, narration and edit plan with timecodes for one video, as a new version. */
  async function script(job: Job) {
    if (!job.video_id) throw new Error("Deze stap hoort niet bij een video");
    const version = Number(job.payload?.version ?? 1);
    if (!Number.isInteger(version) || version < 1) throw new Error("Ongeldige versie");
    type VideoRow = { id: string; recording_id: string | null; format: Format; language: "en" | "nl"; is_test: boolean; status: string; promise: string | null; plan_key: string | null };
    const video = await db.from("yt_videos").select("id, recording_id, format, language, is_test, status, promise, plan_key").eq("id", job.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
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
    const plan = buildEditPlan(video.data.format, moments, rec?.data?.duration_ms ?? undefined, part);
    let draft: ScriptDraft;
    if (video.data.is_test) draft = testScript(plan, moments);
    else {
      if (!ai) throw new Error(NO_KEY);
      await reserve(job, 1);
      const feedback = await previousFeedback(job, video.data.id, version);
      const { json } = await paid(job, () => ai.gemini.generateText(scriptPrompt(video.data.format, video.data.promise, moments, plan, video.data.language, feedback ?? undefined, series)));
      const parsed = parseScript(json, plan.targetMs);
      if ("error" in parsed) throw new Error(`Script van de analysedienst onbruikbaar: ${parsed.error}`);
      draft = parsed.draft;
    }
    if (part && draft.titles) draft = { ...draft, titles: seriesTitles(draft.titles, part) };
    const row = {
      studio_id: job.studio_id,
      video_id: video.data.id,
      version,
      language: video.data.language,
      top_line: draft.topLine || null,
      hook: draft.hook,
      lines: draft.lines,
      edit_plan: plan.segments,
      target_ms: Math.max(1, plan.targetMs),
      source: video.data.is_test ? "test" : "ai",
      model: video.data.is_test ? null : ai?.gemini.model,
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
    return { version, targetMs: plan.targetMs, segments: plan.segments.length, warnings: plan.warnings, hooks: draft.hooks.length };
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
    type VideoRow = { id: string; recording_id: string | null; format: Format; is_test: boolean; status: string; plan_key?: string | null };
    const video = await db.from("yt_videos").select("id, recording_id, format, is_test, status, plan_key").eq("id", s.data.video_id).eq("studio_id", job.studio_id).single<VideoRow>();
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
    const blur = privacyReady && settings.data!.privacy_blur ? cleanRegions(settings.data!.privacy_regions) : [];
    type FlagRow = { position: number; yt_moments: { privacy_flags: string[]; start_ms: number; end_ms: number; peak_ms: number | null } | null };
    const flags = await db.from("yt_video_moments").select("position, yt_moments(privacy_flags, start_ms, end_ms, peak_ms)").eq("video_id", video.data.id).order("position").returns<FlagRow[]>();
    if (flags.error) throw new Error(flags.error.message);
    const voiceHeard = (flags.data ?? []).some((f) => f.yt_moments?.privacy_flags.includes("voice"));
    const muteGame = privacyReady && settings.data!.mute_flagged_voice !== false && voiceHeard;

    // The hook Milan chose (fase C2) decides the opening; without hooks the stored script is used as it is.
    const hooks = parseHooks(s.data.hooks);
    const chosen = typeof s.data.chosen_hook === "number" ? (hooks[s.data.chosen_hook] ?? null) : null;
    const main = flags.data?.[0]?.yt_moments ?? null;
    const cut = applyHook(s.data, chosen, main ? (main.peak_ms ?? Math.round((main.start_ms + main.end_ms) / 2)) : null);
    const size = renderSize(video.data.format);
    const spoken = narration(cut.hook, cut.lines).filter((l) => l.at_ms < cut.targetMs);
    const voice: VoiceClip[] = [];
    const voiceName = settings.data?.voice_name ?? "en-US-Chirp3-HD-Charon";
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
      else if (!montage.voice) note = "Montage zonder stem: stem nog te verbinden (GOOGLE_TTS_API_KEY in worker/.env.local)";
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
            await writeFile(join(tmp, file), await montage.voice.tts.speak(line.text, { voiceName, speakingRate: Number(settings.data?.speaking_rate ?? 1.1) }));
            voice.push({ file, atMs: line.at_ms });
          }
          const cost = await db.from("yt_costs").insert({ studio_id: job.studio_id, job_id: job.id, category: "voiceover", service: "Google TTS Chirp 3 HD", amount_cents: 0, is_estimate: false, description: `${characters} tekens, binnen het gratis deel` });
          if (cost.error && cost.error.code !== "23505") log(`Stemgebruik van stap ${job.id} niet vastgelegd: ${cost.error.message}`);
        }
      }
      const plan = renderArgs({
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
      });
      await writeFile(join(tmp, "subs.ass"), buildAss({ size, topLine: cut.topLine, lines: spoken, durationMs: plan.durationMs, overlays: segmentOverlays(cut.segments, local.probe.durationMs) }), "utf8");
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
      await lv.phase("Preview opslaan", 1);
      await rename(partial, output);
      // Fase D4b: the same captions as a separate file, for YouTube (search and accessibility).
      await writeFile(join(montage.rendersDir, srtFileName(fileName)), buildSrt(spoken, plan.durationMs), "utf8");
      const insert = await db.from("yt_renders").upsert(
        { studio_id: job.studio_id, video_id: video.data.id, script_id: s.data.id, job_id: job.id, file_name: fileName, duration_ms: Math.max(1, plan.durationMs), width: size.width, height: size.height, voice_name: voice.length ? voiceName : null, tts_characters: characters, is_test: video.data.is_test, ...(privacyReady ? { privacy_blur: blur.length > 0, game_muted: muteGame } : {}) },
        { onConflict: "job_id", ignoreDuplicates: true },
      );
      if (insert.error) throw new Error(insert.error.message);
      // Quality check with real measurements (fase C1). A failing check never fails the montage itself.
      let qcSummary: { green: number; orange: number; red: number; lufs: number | null } | null = null;
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
          });
          const count = (l: string) => items.filter((i) => i.level === l).length;
          qcSummary = { green: count("green"), orange: count("orange"), red: count("red"), lufs: log.integratedLufs };
          const saved = await db.from("yt_renders").update({ qc: { measured_at: new Date().toISOString(), probe: measured.probe, log, items } }).eq("job_id", job.id);
          if (saved.error && !liveMissing(saved.error)) await lv.event("error", `Kwaliteitscontrole niet opgeslagen: ${saved.error.message}`);
        } catch (e) {
          if (e instanceof CancelledError) throw e;
          await lv.event("error", `Kwaliteitscontrole mislukt: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Fase C: thumbnails from the montage itself (so blurred corners stay blurred). Never fails the montage.
      let thumbs: StoredThumb[] = [];
      try {
        if (lv.signal.aborted) throw new CancelledError();
        await lv.phase("Thumbnails maken");
        const tsize = video.data.format === "C" ? THUMB_SIZE.long : THUMB_SIZE.short;
        const texts = [...new Set([chosen?.overlay, ...hooks.map((h) => h.overlay), cut.topLine, cut.hook].filter((t): t is string => !!t))];
        for (const [i, p] of thumbnailPlans(video.data.format, cut.segments, texts).entries()) {
          const file = thumbFileName(fileName, i);
          await writeFile(join(tmp, `thumb${i}.ass`), thumbAss(tsize, p.text), "utf8");
          await montage.run(thumbArgs(output, { ...p, atMs: p.atMs.map((t) => Math.min(t, Math.max(0, plan.durationMs - 500))) }, tsize, `thumb${i}.ass`, join(montage.rendersDir, file)), tmp, 2 * 60_000, { signal: lv.signal });
          thumbs.push({ file, key: p.key, label: p.label, text: p.text, at_ms: p.atMs[0] });
        }
        const savedThumbs = await db.from("yt_renders").update({ thumbnails: thumbs }).eq("job_id", job.id);
        if (savedThumbs.error && !liveMissing(savedThumbs.error)) await lv.event("error", `Thumbnails niet opgeslagen: ${savedThumbs.error.message}`);
        else await lv.event("note", `${thumbs.length} ${thumbs.length === 1 ? "thumbnail" : "thumbnails"} gemaakt`);
      } catch (e) {
        if (e instanceof CancelledError) throw e;
        thumbs = [];
        await lv.event("error", `Thumbnails mislukt: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (["idea", "scripted", "rendering"].includes(video.data.status)) await db.from("yt_videos").update({ status: "review" }).eq("id", video.data.id);
      // Fase 3: every new montage gets a Viral-check before Milan reviews it. Never fails the montage.
      await queueStep(job.studio_id, { video_id: video.data.id, step: "viral", idempotency_key: `viral:${job.id}`, payload: { render_job: job.id } }).catch((e) => lv.event("error", `Viral-check niet klaargezet: ${e instanceof Error ? e.message : String(e)}`));
      return { file: fileName, durationMs: plan.durationMs, recordingMs: local.probe.durationMs, segments: plan.segments, voice: voice.length ? voiceName : null, characters, note, blurredRegions: blur.length, gameMuted: muteGame, qc: qcSummary, hookType: chosen?.type ?? null, coldOpen: !!chosen?.cold_open, thumbnails: thumbs.length };
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(partial, { force: true });
    }
  }

  type PublicationRow = { id: string; video_id: string; render_id: string | null; title: string; description: string; tags: string[]; category_id: string; language: "en" | "nl"; made_for_kids: boolean | null; contains_synthetic_media: boolean | null; visibility: "private" | "unlisted" | "public"; publish_at: string | null; status: string; youtube_video_id: string | null; is_test: boolean;
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
        else captions = `Klaar op ${stamp()} (spoor ${await publisher.uploader.insertCaption(videoId, pub.language, srt)})`;
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
        if (picture) await publisher.uploader.setThumbnail(videoId, picture);
        else {
          await publisher.frame(join(publisher.rendersDir, render.data.file_name), pub.thumbnail_ms, file);
          await publisher.uploader.setThumbnail(videoId, await readFile(file));
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
      const render = await db.from("yt_renders").select("file_name, video_id").eq("id", pub.render_id).single<{ file_name: string; video_id: string }>();
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
      await setPub({ status: "uploading", error: null });
      await lv.phase(`Uploaden naar YouTube (${visibilityWord(pub)})`, 0);
      const started = Date.now();
      const result = await publisher.uploader.upload({
        key: pub.id,
        file: join(publisher.rendersDir, render.data.file_name),
        meta: { title: pub.title, description: pub.description, tags: pub.tags, category_id: pub.category_id, language: pub.language, made_for_kids: pub.made_for_kids!, contains_synthetic_media: pub.contains_synthetic_media!, visibility: pub.visibility, publish_at: pub.publish_at },
        signal: lv.signal,
        onProgress: (sent, total) => {
          const seconds = (Date.now() - started) / 1000;
          const bps = seconds > 1 ? sent / seconds : null;
          void lv.progress({ progress: total ? sent / total : null, metrics: { sent_bytes: sent, total_bytes: total, bytes_per_s: bps, eta_ms: bps ? Math.round(((total - sent) / bps) * 1000) : null } });
        },
        onEvent: (m) => lv.event("log", m),
      });
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
      const p = await publisher.uploader.processing(videoId);
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
    await publisher.uploader.setStatus(pub.youtube_video_id, { made_for_kids: pub.made_for_kids!, contains_synthetic_media: pub.contains_synthetic_media!, visibility: pub.visibility, publish_at: pub.publish_at });
    const check = await publisher.uploader.processing(pub.youtube_video_id);
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
    return parsed;
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
    const ch = await db.from("yt_channels").select("language").eq("id", channelId).single<{ language: "en" | "nl" }>();
    if (ch.error) throw new Error(ch.error.message);
    const pref = await db.from("studio_preferences").select("value").eq("studio_id", job.studio_id).eq("channel_id", channelId).eq("key", "reference_queries").maybeSingle<{ value: unknown }>();
    const queries = Array.isArray(pref.data?.value) && pref.data.value.length ? (pref.data.value as string[]).slice(0, 3) : defaultQueries(ch.data.language);
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

  const handlers: Record<string, (job: Job, lv: Live) => Promise<unknown>> = { intake, analyse, script, ...(montage ? { render } : {}), ...(publisher ? { upload, publish } : {}) };
  /** Short steps that must not wait behind a montage of many minutes: they run in their own lane, next to the main one. */
  const fastHandlers: Record<string, (job: Job, lv: Live) => Promise<unknown>> = { suggest, viral, reference };

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

  const tick = () => runLane(handlers, "main");
  const tickFast = () => runLane(fastHandlers, "fast");
  let fastBusy = false;

  async function runLane(handlers: Record<string, (job: Job, lv: Live) => Promise<unknown>>, lane: "main" | "fast") {
    if (lane === "main" ? busy : fastBusy) return;
    if (lane === "main") busy = true;
    else fastBusy = true;
    try {
      for (;;) {
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
      else fastBusy = false;
    }
  }

  return {
    start(intervalMs = 5000) {
      // Fase 2: old Studio events are not needed to learn (migration 049; quietly nothing before it).
      void Promise.resolve(db.rpc("prune_studio_events", { p_days: 180 })).catch(() => undefined);
      void recover().then(() => Promise.all([tick(), tickFast()]));
      timer = setInterval(() => void Promise.all([tick(), tickFast()]), intervalMs);
      // Fase 3.1: reference videos once a week (checked at start and every 6 hours).
      void scheduleReference().catch(() => undefined);
      setInterval(() => void scheduleReference().catch(() => undefined), 6 * 60 * 60_000);
      setInterval(() => void failStuck().catch(() => undefined), 60 * 60_000);
    },
    recover,
    tick,
    tickFast,
    scheduleReference,
    failStuck,
    stop() {
      if (timer) clearInterval(timer);
    },
    poke: () => void Promise.all([tick(), tickFast()]),
    /** Dreamnest (only with FEATURE_DREAMNEST=true) asks this before each step: KIVOXEL goes first. Read-only. */
    mainBusy: () => busy,
  };
}

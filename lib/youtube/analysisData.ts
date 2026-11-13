// Analysis and script data in Supabase (migration 009). Until that migration has run, the studio shows that.
import { friendlyError, supabase } from "../supabase";
import type { Hook } from "./hooks";
import type { QcItem } from "./qc";
import { cleanRegions, type Region } from "./render";
import type { Format, MomentKind, PrivacyFlag, ScriptLine, Segment } from "./analysis";

export type DbSettings = { paid_processing_enabled: boolean; monthly_cap_cents: number; warn_at_percent: number; approved_at: string | null };
export type DbMoment = {
  id: string;
  recording_id: string;
  kind: MomentKind;
  start_ms: number;
  end_ms: number;
  peak_ms: number | null;
  reason: string;
  score: number;
  has_context: boolean;
  context_note: string | null;
  has_payoff: boolean;
  payoff_note: string | null;
  privacy_flags: PrivacyFlag[];
  suggested_format: Format | null;
  usable: boolean;
  source: "ai" | "test" | "manual";
  is_test: boolean;
};
export type DbVideo = { id: string; recording_id: string | null; format: Format; status: string; language: "en" | "nl"; promise: string | null; is_test: boolean; created_at: string; yt_video_moments: { moment_id: string; position: number }[]; /** Migration 031. */ review_note?: string | null };
export type DbScript = { id: string; video_id: string; version: number; top_line: string | null; hook: string; lines: ScriptLine[]; edit_plan: Segment[]; target_ms: number; source: string; status: "draft" | "approved" | "rejected"; is_test: boolean; created_at: string; /** Migration 035. */ hooks?: Hook[]; loop_line?: string | null; chosen_hook?: number | null; /** Migration 047. */ titles?: string[]; feedback?: string | null };
export type DbRecordingInfo = { id: string; label: string; status: string; is_test: boolean; duration_ms: number | null };

export type DbRender = { id: string; video_id: string; script_id: string; file_name: string; duration_ms: number; width: number; height: number; voice_name: string | null; is_test: boolean; created_at: string; /** Migration 031; absent before. */ privacy_blur?: boolean; game_muted?: boolean; /** Migration 034: real measurements and checklist. */ qc?: { measured_at: string; items: QcItem[] } | null };
export type RenderJob = { script_id: string; status: string; error: string | null; created_at: string };
/** Montage (migration 030); null until that migration has run. */
export type VoiceSettings = { voice_name: string; speaking_rate: number; game_volume: number };
export const DEFAULT_VOICE: VoiceSettings = { voice_name: "en-US-Chirp3-HD-Charon", speaking_rate: 1.1, game_volume: 0.25 };
/** Blurring and muting (migration 031). */
export type PrivacySettings = { privacy_blur: boolean; privacy_regions: Region[]; mute_flagged_voice: boolean };
/** privacy is null until migration 031 has run. */
export type MontageState = { renders: DbRender[]; jobs: RenderJob[]; voice: VoiceSettings; privacy: PrivacySettings | null } | null;

/**
 * Chirp 3 HD voices to choose from (names from Google's voice list; check with a real key before relying on one).
 * Starting language is English (research chapter 5); Dutch for later tests.
 */
export const VOICES: { name: string; label: string }[] = [
  { name: "en-US-Chirp3-HD-Charon", label: "Charon · Amerikaans Engels, mannelijk, rustig" },
  { name: "en-US-Chirp3-HD-Puck", label: "Puck · Amerikaans Engels, mannelijk, levendig" },
  { name: "en-US-Chirp3-HD-Fenrir", label: "Fenrir · Amerikaans Engels, mannelijk, enthousiast" },
  { name: "en-US-Chirp3-HD-Kore", label: "Kore · Amerikaans Engels, vrouwelijk" },
  { name: "en-GB-Chirp3-HD-Charon", label: "Charon · Brits Engels, mannelijk" },
  { name: "nl-NL-Chirp3-HD-Charon", label: "Charon · Nederlands, mannelijk" },
];

export type AnalysisState =
  | { ready: true; settings: DbSettings | null; spentCents: number; recordings: DbRecordingInfo[]; moments: DbMoment[]; videos: DbVideo[]; scripts: DbScript[]; analyseJobs: Record<string, string>; montage: MontageState }
  | { ready: false; reason: "migration" | "error"; message?: string };

const isMissing = (error: { code?: string; message: string }) => error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /does not exist|could not find/i.test(error.message);

/** First day of this month in Europe/Amsterdam, as yyyy-mm-dd. */
function monthStart(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).format(now).split("-");
  return `${y}-${m}-01`;
}

export async function loadAnalysis(studioId: string): Promise<AnalysisState> {
  const [settings, costs, recordings, moments, videos, scripts, jobs, montage] = await Promise.all([
    supabase.from("yt_settings").select("paid_processing_enabled, monthly_cap_cents, warn_at_percent, approved_at").eq("studio_id", studioId).maybeSingle<DbSettings>(),
    supabase.from("yt_costs").select("amount_cents").eq("studio_id", studioId).eq("currency", "EUR").gte("incurred_on", monthStart()).returns<{ amount_cents: number }[]>(),
    supabase.from("yt_recordings").select("id, label, status, is_test, duration_ms").eq("studio_id", studioId).order("created_at", { ascending: false }).returns<DbRecordingInfo[]>(),
    supabase.from("yt_moments").select("id, recording_id, kind, start_ms, end_ms, peak_ms, reason, score, has_context, context_note, has_payoff, payoff_note, privacy_flags, suggested_format, usable, source, is_test").eq("studio_id", studioId).order("start_ms").returns<DbMoment[]>(),
    supabase.from("yt_videos").select("*, yt_video_moments(moment_id, position)").eq("studio_id", studioId).order("created_at").returns<DbVideo[]>(),
    supabase.from("yt_scripts").select("*").eq("studio_id", studioId).order("version", { ascending: false }).returns<DbScript[]>(),
    // Oldest first, so the newest analysis of a recording wins below.
    supabase.from("yt_jobs").select("recording_id, status").eq("studio_id", studioId).eq("step", "analyse").order("created_at").returns<{ recording_id: string | null; status: string }[]>(),
    loadMontage(studioId),
  ]);
  const error = settings.error ?? costs.error ?? recordings.error ?? moments.error ?? videos.error ?? scripts.error ?? jobs.error;
  if (error) return isMissing(error) ? { ready: false, reason: "migration" } : { ready: false, reason: "error", message: friendlyError(error.message) };
  const analyseJobs: Record<string, string> = {};
  for (const j of jobs.data ?? []) if (j.recording_id) analyseJobs[j.recording_id] = j.status;
  return {
    ready: true,
    settings: settings.data,
    spentCents: (costs.data ?? []).reduce((sum, c) => sum + c.amount_cents, 0),
    recordings: recordings.data ?? [],
    moments: moments.data ?? [],
    videos: videos.data ?? [],
    scripts: scripts.data ?? [],
    analyseJobs,
    montage,
  };
}

/** Renders and montage steps, newest first. Missing table (migration 030 not run yet) gives null, not an error. */
let montageMissing = false;
async function loadMontage(studioId: string): Promise<MontageState> {
  // Before migration 030 these requests fail; ask once per page load instead of every refresh.
  if (montageMissing) return null;
  const [renders, jobs, voice] = await Promise.all([
    supabase.from("yt_renders").select("*").eq("studio_id", studioId).order("created_at", { ascending: false }).returns<DbRender[]>(),
    supabase.from("yt_jobs").select("payload, status, error, created_at").eq("studio_id", studioId).eq("step", "render").order("created_at", { ascending: false }).returns<{ payload: { script_id?: string } | null; status: string; error: string | null; created_at: string }[]>(),
    supabase.from("yt_settings").select("*").eq("studio_id", studioId).maybeSingle<VoiceSettings & Partial<PrivacySettings>>(),
  ]);
  const error = renders.error ?? jobs.error ?? voice.error;
  if (error) {
    montageMissing = isMissing(error);
    return null;
  }
  return {
    voice: voice.data ? { voice_name: voice.data.voice_name, speaking_rate: Number(voice.data.speaking_rate), game_volume: Number(voice.data.game_volume) } : DEFAULT_VOICE,
    privacy: voice.data && "privacy_regions" in voice.data ? { privacy_blur: voice.data.privacy_blur !== false, privacy_regions: cleanRegions(voice.data.privacy_regions), mute_flagged_voice: voice.data.mute_flagged_voice !== false } : null,
    renders: renders.data ?? [],
    jobs: (jobs.data ?? []).filter((j) => j.payload?.script_id).map((j) => ({ script_id: j.payload!.script_id!, status: j.status, error: j.error, created_at: j.created_at })),
  };
}

/** Voice, tempo and game sound for the next montage. Only admins can change settings (RLS, migration 009). */
export async function saveVoiceSettings(studioId: string, v: VoiceSettings): Promise<void> {
  const language = v.voice_name.slice(0, 5);
  const { error } = await supabase.from("yt_settings").upsert({ studio_id: studioId, voice_language: language, voice_name: v.voice_name, speaking_rate: v.speaking_rate, game_volume: v.game_volume }, { onConflict: "studio_id" });
  if (error) throw new Error(friendlyError(error.message));
}

/** Fixed corners to blur and whether the game sound goes off when a voice is heard (migration 031). */
export async function savePrivacySettings(studioId: string, p: PrivacySettings): Promise<void> {
  const { error } = await supabase.from("yt_settings").upsert({ studio_id: studioId, ...p, privacy_regions: cleanRegions(p.privacy_regions) }, { onConflict: "studio_id" });
  if (error) throw new Error(friendlyError(error.message));
}

/** "Montage maken": queues a montage of an approved script. Each click is a new attempt (render:<script>:<n>). */
export async function queueRender(studioId: string, script: DbScript, attempt: number): Promise<void> {
  if (script.status !== "approved") throw new Error("Keur het script eerst goed.");
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, video_id: script.video_id, step: "render", idempotency_key: `render:${script.id}:${attempt}`, payload: { script_id: script.id } });
  if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
  // A new montage needs a new check: an earlier approval no longer counts. The worker sets "review" when it is done.
  await setVideoStatus(script.video_id, "rendering", ["idea", "scripted", "review", "approved"]);
}

async function setVideoStatus(videoId: string, status: string, from: string[]): Promise<void> {
  const { error } = await supabase.from("yt_videos").update({ status }).eq("id", videoId).in("status", from);
  if (error) throw new Error(friendlyError(error.message));
}

/** After the preview: approve the montage for publication, or send it back (then adjust the script or montage again). */
export async function setVideoReview(videoId: string, decision: "approve" | "reject" | "withdraw", note?: string): Promise<void> {
  if (decision === "approve") return setVideoStatus(videoId, "approved", ["review"]);
  if (decision === "withdraw") return setVideoStatus(videoId, "review", ["approved"]);
  await setVideoStatus(videoId, "scripted", ["review", "approved"]);
  // The reason is kept from migration 031 on; before that it is simply not stored.
  const reason = note?.trim().slice(0, 500) || null;
  const { error } = await supabase.from("yt_videos").update({ review_note: reason }).eq("id", videoId);
  if (error && !isMissing(error) && error.code !== "PGRST204") throw new Error(friendlyError(error.message));
}

/** Switching paid processing on records who approved it (trigger in migration 009). */
export async function saveSettings(studioId: string, enabled: boolean, capCents: number): Promise<void> {
  const { error } = await supabase.from("yt_settings").upsert({ studio_id: studioId, paid_processing_enabled: enabled, monthly_cap_cents: capCents }, { onConflict: "studio_id" });
  if (error) throw new Error(friendlyError(error.message));
}

/** Queues the analysis of a recording. Nothing is added twice; a failed analysis is restarted from the queue. */
export async function queueAnalysis(studioId: string, recordingId: string): Promise<"queued" | "exists"> {
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, recording_id: recordingId, step: "analyse", idempotency_key: `analyse:${recordingId}` });
  if (error?.code === "23505") return "exists";
  if (error) throw new Error(friendlyError(error.message));
  return "queued";
}

/**
 * A recording that was uploaded as test data by mistake: give it a proper name, remove the free test analysis
 * (test moments and test videos, with their scripts) and queue the real, paid analysis.
 */
export async function markAsRealGameplay(studioId: string, recordingId: string, label: string): Promise<void> {
  // From migration 031 on this is one database step, so a recording is never left half converted.
  const rpc = await supabase.rpc("mark_yt_recording_real", { p_recording: recordingId, p_label: label.trim() });
  if (!rpc.error) return;
  if (rpc.error.code !== "PGRST202" && rpc.error.code !== "42883") throw new Error(friendlyError(rpc.error.message));
  const steps = [
    () => supabase.from("yt_recordings").update({ label: label.trim(), is_test: false }).eq("id", recordingId).eq("studio_id", studioId),
    () => supabase.from("yt_videos").delete().eq("recording_id", recordingId).eq("studio_id", studioId).eq("is_test", true),
    () => supabase.from("yt_moments").delete().eq("recording_id", recordingId).eq("studio_id", studioId).eq("source", "test"),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) throw new Error(friendlyError(error.message));
  }
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, recording_id: recordingId, step: "analyse", idempotency_key: `analyse:${recordingId}:real` });
  if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
}

/**
 * Editor (fase C3): saves the edited montage plan and narration as a new script version (source "manual").
 * Earlier versions stay as they are. With approve, the new version is approved and the montage is queued at once.
 */
export async function saveEditedScript(studioId: string, base: DbScript, nextVersion: number, edit: { topLine: string; lines: ScriptLine[]; segments: Segment[]; targetMs: number }, approve: boolean): Promise<void> {
  const row = {
    studio_id: studioId,
    video_id: base.video_id,
    version: nextVersion,
    top_line: edit.topLine.trim() || null,
    hook: (edit.lines[0]?.text || base.hook).slice(0, 300),
    lines: edit.lines,
    edit_plan: edit.segments,
    target_ms: Math.max(1, edit.targetMs),
    source: "manual",
    is_test: base.is_test,
  };
  const { data, error } = await supabase.from("yt_scripts").insert(row).select("*").single<DbScript>();
  if (error) throw new Error(friendlyError(error.message));
  if (approve) {
    await setScriptStatus(data, "approved");
    await queueRender(studioId, { ...data, status: "approved" }, 1);
  }
}

/** "Opnieuw genereren": queues a new script version for a video. */
export async function regenerateScript(studioId: string, videoId: string, nextVersion: number, note?: string): Promise<void> {
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, video_id: videoId, step: "script", idempotency_key: `script:${videoId}:v${nextVersion}`, payload: { version: nextVersion, ...(note ? { note } : {}) } });
  if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
}

/** Approve one version (any earlier approval of that video goes back to draft) or reject it. */
/** Milan picks one of the hook variants. A montage with another hook no longer matches, so the video is checked again. */
export async function setChosenHook(script: DbScript, index: number): Promise<void> {
  const { error } = await supabase.from("yt_scripts").update({ chosen_hook: index }).eq("id", script.id);
  if (error) throw new Error(friendlyError(error.message));
  if (script.status === "approved") await setVideoStatus(script.video_id, "scripted", ["review", "approved"]);
}

export async function setScriptStatus(script: DbScript, status: "approved" | "rejected" | "draft"): Promise<void> {
  if (status === "approved") {
    const reset = await supabase.from("yt_scripts").update({ status: "draft" }).eq("video_id", script.video_id).eq("status", "approved");
    if (reset.error) throw new Error(friendlyError(reset.error.message));
  }
  const { error } = await supabase.from("yt_scripts").update({ status }).eq("id", script.id);
  if (error) throw new Error(friendlyError(error.message));
  // Another approved script means the existing montage no longer matches: the video has to be checked again.
  if (status === "approved" || script.status === "approved") await setVideoStatus(script.video_id, "scripted", ["review", "approved"]);
}

/** 1234 -> "€ 12,34". */
export const euros = (cents: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(cents / 100);

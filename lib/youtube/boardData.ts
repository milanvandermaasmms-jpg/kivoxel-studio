// Data for the pipeline board and the review mode (fase A). Reuses the existing review steps: approving a script
// (Keur 1) and approving a montage (Keur 2) work exactly as in the Productiestudio.
import { friendlyError, supabase } from "../supabase";
import type { DbRender, DbScript } from "./analysisData";
import { queueRender, setScriptStatus, setVideoReview } from "./analysisData";
import type { BoardCost, BoardInput, BoardJob, BoardMoment, BoardRecording, BoardVideo } from "./board";
import { loadChannels, type Channel } from "./channels";

export type BoardJobWithPayload = BoardJob & { payload: { script_id?: string } | null };
export type BoardState =
  | { ready: true; channels: Channel[]; input: BoardInput; scripts: DbScript[]; renders: DbRender[]; jobs: BoardJobWithPayload[] }
  | { ready: false; reason: "migration" | "error"; message?: string };

const isMissing = (error: { code?: string; message: string }) => error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /does not exist|could not find/i.test(error.message);

export async function loadBoard(studioId: string): Promise<BoardState> {
  const [channels, recordings, videos, scripts, jobs, costs, moments, renders] = await Promise.all([
    loadChannels(studioId).catch(() => null),
    supabase.from("yt_recordings").select("id, label, status, error, is_test, channel_id, created_at").eq("studio_id", studioId).returns<BoardRecording[]>(),
    supabase.from("yt_videos").select("*, yt_video_moments(moment_id)").eq("studio_id", studioId).returns<BoardVideo[]>(),
    supabase.from("yt_scripts").select("*").eq("studio_id", studioId).order("version", { ascending: false }).returns<DbScript[]>(),
    supabase.from("yt_jobs").select("id, recording_id, video_id, step, status, error, created_at, payload").eq("studio_id", studioId).order("created_at").limit(2000).returns<BoardJobWithPayload[]>(),
    supabase.from("yt_costs").select("video_id, job_id, amount_cents").eq("studio_id", studioId).eq("currency", "EUR").returns<BoardCost[]>(),
    supabase.from("yt_moments").select("id, privacy_flags").eq("studio_id", studioId).returns<BoardMoment[]>(),
    supabase.from("yt_renders").select("*").eq("studio_id", studioId).order("created_at", { ascending: false }).returns<DbRender[]>(),
  ]);
  const error = recordings.error ?? videos.error ?? scripts.error ?? jobs.error ?? costs.error ?? moments.error ?? renders.error;
  if (error) return isMissing(error) ? { ready: false, reason: "migration" } : { ready: false, reason: "error", message: friendlyError(error.message) };
  const jobRows = jobs.data ?? [];
  return {
    ready: true,
    channels: channels ?? [],
    input: { recordings: recordings.data ?? [], videos: videos.data ?? [], scripts: scripts.data ?? [], jobs: jobRows, costs: costs.data ?? [], moments: moments.data ?? [] },
    scripts: scripts.data ?? [],
    renders: renders.data ?? [],
    jobs: jobRows,
  };
}

/** Keur 1: approve the concept and start the montage at once. */
export async function approveConcept(studioId: string, script: DbScript, jobs: BoardJobWithPayload[]): Promise<void> {
  const attempts = jobs.filter((j) => j.step === "render" && j.payload?.script_id === script.id).length;
  await setScriptStatus(script, "approved");
  await queueRender(studioId, { ...script, status: "approved" }, attempts + 1);
}

/** Keur 1: send the concept back with a reason; the reason is kept with the video. */
export async function rejectConcept(script: DbScript, note: string): Promise<void> {
  await setScriptStatus(script, "rejected");
  const reason = note.trim().slice(0, 500) || null;
  const { error } = await supabase.from("yt_videos").update({ review_note: reason }).eq("id", script.video_id);
  if (error) throw new Error(friendlyError(error.message));
}

/** Keur 2: approve the final version (publishing stays a separate click) or send it back with a reason. */
export const approveFinal = (videoId: string) => setVideoReview(videoId, "approve");
export const rejectFinal = (videoId: string, note: string) => setVideoReview(videoId, "reject", note);

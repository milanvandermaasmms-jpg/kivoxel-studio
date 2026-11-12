// Live progress of the running analysis for the AI Video Maker (migration 033 columns on yt_jobs).
import { supabase } from "../supabase";

export type AnalyseProgress = { progress: number | null; phase: string | null; etaMs: number | null; estimate: boolean };

export async function loadAnalyseProgress(studioId: string, recordingId: string): Promise<AnalyseProgress | null> {
  const { data, error } = await supabase
    .from("yt_jobs")
    .select("progress, phase, metrics, status")
    .eq("studio_id", studioId)
    .eq("recording_id", recordingId)
    .eq("step", "analyse")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ progress: number | string | null; phase: string | null; metrics: Record<string, number | null> | null; status: string }>();
  if (error || !data || (data.status !== "running" && data.status !== "queued")) return null;
  const p = data.progress === null ? null : Number(data.progress);
  return { progress: Number.isFinite(p) ? p : null, phase: data.phase, etaMs: data.metrics?.eta_ms ?? null, estimate: !!data.metrics?.estimate };
}

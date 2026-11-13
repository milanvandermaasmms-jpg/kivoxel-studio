// Viral-check in the database (migration 050): the dashboard reads scores and reference videos and can ask the worker
// for a new check or new reference videos. Writing scores is only for the worker.
import { friendlyError, supabase } from "../supabase";
import type { ReferenceVideo, ViralResult } from "./viral";
import type { CheckRow, PubRow, Snap } from "./viralInsights";

export type ViralCheck = { id: string; video_id: string; render_id: string | null; script_id: string | null; overall: number; result: ViralResult; source: "ai" | "rules" | "test"; created_at: string };
export type ViralJob = { id: string; status: string; error: string | null; created_at: string } | null;

const isMissing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || /could not find|does not exist/i.test(e.message);

export async function loadViral(videoId: string): Promise<{ check: ViralCheck | null; job: ViralJob } | "migration"> {
  const [check, job] = await Promise.all([
    supabase.from("yt_viral_checks").select("id, video_id, render_id, script_id, overall, result, source, created_at").eq("video_id", videoId).order("created_at", { ascending: false }).limit(1).maybeSingle<ViralCheck>(),
    supabase.from("yt_jobs").select("id, status, error, created_at").eq("video_id", videoId).eq("step", "viral").order("created_at", { ascending: false }).limit(1).maybeSingle<NonNullable<ViralJob>>(),
  ]);
  if (check.error) {
    if (isMissing(check.error)) return "migration";
    throw new Error(friendlyError(check.error.message));
  }
  return { check: check.data ? { ...check.data, overall: Number(check.data.overall) } : null, job: job.data ?? null };
}

export async function requestViral(studioId: string, videoId: string): Promise<void> {
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, video_id: videoId, step: "viral", idempotency_key: `viral:manual:${videoId}:${Date.now()}`, max_attempts: 2 });
  if (error) throw new Error(/check constraint/i.test(error.message) ? "De Viral-check komt er met migratie 050 (nog niet uitgevoerd)." : friendlyError(error.message));
}

export async function requestReference(studioId: string, channelId: string): Promise<void> {
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, step: "reference", idempotency_key: `reference:manual:${channelId}:${Date.now()}`, max_attempts: 2, payload: { channel_id: channelId } });
  if (error) throw new Error(/check constraint/i.test(error.message) ? "Referentievideo's komen er met migratie 050 (nog niet uitgevoerd)." : friendlyError(error.message));
}

export type InsightsData = { checks: CheckRow[]; pubs: PubRow[]; snaps: Snap[]; reference: (ReferenceVideo & { channel_id: string | null; query: string; youtube_video_id: string; fetched_at: string })[]; referenceJob: { status: string; error: string | null } | null };

export async function loadInsights(studioId: string): Promise<InsightsData | "migration"> {
  const [checks, pubs, snaps, reference, job] = await Promise.all([
    supabase.from("yt_viral_checks").select("video_id, overall, result, created_at").eq("studio_id", studioId).eq("is_test", false).order("created_at", { ascending: false }).limit(300).returns<{ video_id: string; overall: number; result: ViralResult; created_at: string }[]>(),
    supabase.from("yt_publications").select("video_id, youtube_video_id, title").eq("studio_id", studioId).not("youtube_video_id", "is", null).returns<PubRow[]>(),
    supabase.from("yt_video_snapshots").select("youtube_video_id, taken_at, published_at, views, avg_view_pct").eq("studio_id", studioId).order("taken_at", { ascending: false }).limit(3000).returns<Snap[]>(),
    supabase.from("yt_reference_videos").select("channel_id, query, youtube_video_id, title, tags, duration_s, is_short, published_at, views, ratio, hook, fetched_at").eq("studio_id", studioId).order("ratio", { ascending: false, nullsFirst: false }).limit(200).returns<InsightsData["reference"]>(),
    supabase.from("yt_jobs").select("status, error").eq("studio_id", studioId).eq("step", "reference").order("created_at", { ascending: false }).limit(1).maybeSingle<{ status: string; error: string | null }>(),
  ]);
  if (checks.error) {
    if (isMissing(checks.error)) return "migration";
    throw new Error(friendlyError(checks.error.message));
  }
  return {
    checks: (checks.data ?? []).map((c) => ({ video_id: c.video_id, overall: Number(c.overall), features: c.result.features, created_at: c.created_at })),
    pubs: pubs.data ?? [],
    snaps: snaps.data ?? [],
    reference: reference.data ?? [],
    referenceJob: job.data ?? null,
  };
}

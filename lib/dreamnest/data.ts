// Dreamnest fase 0.5: episodes and their steps from Supabase (migration 052), for the Studio. RLS: admins only.
import { friendlyError, supabase } from "../supabase";
import type { DnStep } from "./core";
import type { StepPayload } from "./steps";

export type Episode = { id: string; channel_id: string; title: string; status: string; duration_min: number; concept: Record<string, unknown>; spent_cents: number; is_test: boolean; created_at: string };
export type DnJobRow = { id: string; episode_id: string; step: DnStep; status: "queued" | "running" | "done" | "failed" | "cancelled"; payload: StepPayload; result: Record<string, unknown> | null; error: string | null; progress: number | null; created_at: string; started_at: string | null; finished_at: string | null };

const missing = (m: string) => /dn_episodes|dn_render_jobs|does not exist|schema cache/i.test(m);

/** null while migration 052 has not run. */
export async function loadEpisodes(studioId: string, channelId: string): Promise<Episode[] | null> {
  const { data, error } = await supabase.from("dn_episodes").select("id, channel_id, title, status, duration_min, concept, spent_cents, is_test, created_at").eq("studio_id", studioId).eq("channel_id", channelId).neq("status", "archived").order("created_at", { ascending: false }).returns<Episode[]>();
  if (error) {
    if (missing(error.message)) return null;
    throw new Error(friendlyError(error.message));
  }
  return data ?? [];
}

export async function loadJobs(episodeId: string): Promise<DnJobRow[]> {
  const { data, error } = await supabase.from("dn_render_jobs").select("id, episode_id, step, status, payload, result, error, progress, created_at, started_at, finished_at").eq("episode_id", episodeId).order("created_at", { ascending: false }).limit(100).returns<DnJobRow[]>();
  if (error) throw new Error(friendlyError(error.message));
  return data ?? [];
}

export async function createEpisode(studioId: string, channelId: string, title: string, durationMin: number): Promise<string> {
  if (!title.trim() || title.length > 200) throw new Error("Geef de aflevering een titel (hoogstens 200 tekens).");
  const { data, error } = await supabase.from("dn_episodes").insert({ studio_id: studioId, channel_id: channelId, title: title.trim(), duration_min: durationMin }).select("id").single<{ id: string }>();
  if (error) throw new Error(friendlyError(error.message));
  return data.id;
}

/** Milan's click: put one step in the Dreamnest queue (never KIVOXEL's). */
export async function queueStep(studioId: string, episodeId: string, step: DnStep, payload: StepPayload = {}): Promise<void> {
  const { error } = await supabase.from("dn_render_jobs").insert({ studio_id: studioId, episode_id: episodeId, step, payload, idempotency_key: `${episodeId}:${step}:${Date.now()}` });
  if (error) throw new Error(friendlyError(error.message));
}

export async function cancelStep(jobId: string): Promise<void> {
  const { error } = await supabase.from("dn_render_jobs").update({ status: "cancelled" }).eq("id", jobId).eq("status", "queued");
  if (error) throw new Error(friendlyError(error.message));
}

export async function archiveEpisode(episodeId: string): Promise<void> {
  const { error } = await supabase.from("dn_episodes").update({ status: "archived" }).eq("id", episodeId);
  if (error) throw new Error(friendlyError(error.message));
}

// ---------- Fase 5: publications (migration 053) ----------
export type PublicationRow = { id: string; episode_id: string; kind: "long" | "short"; short_id: string; file: string; thumbnail: string | null; title: string; description: string; tags: string[]; publish_at: string | null; status: "draft" | "queued" | "uploading" | "uploaded" | "scheduled" | "failed"; youtube_video_id: string | null; progress: number | null; error: string | null };
export type PublicationDraft = { kind: "long" | "short"; short_id: string; file: string; thumbnail: string | null; title: string; description: string; tags: string[]; publish_at: string | null };

/** null while migration 053 has not run. */
export async function loadPublications(episodeId: string): Promise<PublicationRow[] | null> {
  const { data, error } = await supabase.from("dn_publications").select("id, episode_id, kind, short_id, file, thumbnail, title, description, tags, publish_at, status, youtube_video_id, progress, error").eq("episode_id", episodeId).order("created_at").returns<PublicationRow[]>();
  if (error) {
    if (/dn_publications|does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(friendlyError(error.message));
  }
  return data ?? [];
}

/** Saves the form (draft), or with queue=true sets it ready and puts the publish step in the Dreamnest queue. */
export async function savePublication(studioId: string, episodeId: string, channelId: string, existing: PublicationRow | null, d: PublicationDraft, queue: boolean): Promise<void> {
  const fields = { thumbnail: d.thumbnail, title: d.title.trim(), description: d.description, tags: d.tags, publish_at: d.publish_at, status: queue ? "queued" : "draft" };
  let id = existing?.id ?? null;
  if (existing) {
    const { error } = await supabase.from("dn_publications").update(fields).eq("id", existing.id);
    if (error) throw new Error(friendlyError(error.message));
  } else {
    const { data, error } = await supabase.from("dn_publications").insert({ studio_id: studioId, episode_id: episodeId, channel_id: channelId, kind: d.kind, short_id: d.short_id, file: d.file, ...fields }).select("id").single<{ id: string }>();
    if (error) throw new Error(friendlyError(error.message));
    id = data.id;
  }
  if (queue && id) {
    const { error } = await supabase.from("dn_render_jobs").insert({ studio_id: studioId, episode_id: episodeId, step: "dn_publish", payload: { publication_id: id }, idempotency_key: `publish:${id}:${Date.now()}`, max_attempts: 1 });
    if (error) throw new Error(friendlyError(error.message));
  }
}

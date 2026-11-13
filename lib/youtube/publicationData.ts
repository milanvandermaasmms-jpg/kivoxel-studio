// Publications in the database (migration 037). Saving a draft only writes here; nothing goes to YouTube.
import { friendlyError, supabase } from "../supabase";
import { draftProblems, type PublicationDraft } from "./publication";

export type PublicationStatus = "draft" | "queued" | "uploading" | "processing" | "uploaded" | "scheduled" | "published" | "failed";
export const PUBLICATION_STATUS: Record<PublicationStatus, string> = {
  draft: "Concept",
  queued: "Wacht op upload",
  uploading: "Bezig met uploaden",
  processing: "YouTube verwerkt",
  uploaded: "Geüpload (privé)",
  scheduled: "Ingepland",
  published: "Gepubliceerd",
  failed: "Mislukt",
};

export type DbPublication = PublicationDraft & { id: string; video_id: string; render_id: string | null; status: PublicationStatus; youtube_video_id: string | null; error: string | null; is_test: boolean; updated_at: string } & Partial<Extras> & {
  /** Migration 040: what the worker reported for captions and thumbnail. */
  captions_status?: string | null;
  thumbnail_status?: string | null;
};

/** Fase D4b (migration 040): captions as a separate track, and the moment of the montage that becomes the thumbnail. */
export type Extras = { captions_enabled: boolean; thumbnail_ms: number | null };

// All columns, so the screen works before and after migration 040.
const COLS = "*";

/** null while migration 037 has not run; undefined entries mean: no draft yet for that video. */
export async function loadPublication(videoId: string): Promise<DbPublication | null | "migration"> {
  const { data, error } = await supabase.from("yt_publications").select(COLS).eq("video_id", videoId).maybeSingle<DbPublication>();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /could not find|does not exist/i.test(error.message)) return "migration";
    throw new Error(friendlyError(error.message));
  }
  return data;
}

export type PublishAction = "private" | "schedule" | "publish";

/**
 * The buttons "Privé uploaden", "Inplannen" and "Nu publiceren" (migration 039). The database checks everything again
 * and queues one step for the worker: an upload, or (when the video is already on YouTube) a visibility change.
 */
export async function requestPublish(publicationId: string, action: PublishAction, publishAt: string | null, visibility: "public" | "unlisted" | null): Promise<void> {
  const { error } = await supabase.rpc("request_yt_publish", { p_publication: publicationId, p_action: action, p_publish_at: publishAt, p_visibility: visibility });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) throw new Error("Inplannen en publiceren komen er met migratie 039 (nog niet uitgevoerd).");
    throw new Error(friendlyError(error.message));
  }
}

/** Saves the draft (new or existing). Returns the stored row. */
export async function savePublication(studioId: string, videoId: string, renderId: string | null, draft: PublicationDraft, existingId: string | null, extras?: Extras): Promise<DbPublication> {
  const problems = draftProblems(draft);
  if (problems.length) throw new Error(problems[0]);
  const fields = {
    render_id: renderId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    tags: draft.tags,
    category_id: draft.category_id,
    language: draft.language,
    made_for_kids: draft.made_for_kids,
    contains_synthetic_media: draft.contains_synthetic_media,
    visibility: draft.visibility,
    publish_at: draft.publish_at,
    ...(extras ?? {}),
  };
  const query = existingId
    ? supabase.from("yt_publications").update(fields).eq("id", existingId).select(COLS).maybeSingle<DbPublication>()
    : supabase.from("yt_publications").insert({ studio_id: studioId, video_id: videoId, ...fields }).select(COLS).maybeSingle<DbPublication>();
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error.message));
  if (!data) throw new Error("Dit concept kan niet meer worden gewijzigd: de upload is al begonnen.");
  return data;
}

/** "Ondertitels en thumbnail naar YouTube" for a video already on YouTube (migration 040). Visibility stays as it is. */
export async function requestExtras(publicationId: string, extras: Extras): Promise<void> {
  const { error } = await supabase.rpc("request_yt_extras", { p_publication: publicationId, p_captions: extras.captions_enabled, p_thumbnail_ms: extras.thumbnail_ms });
  if (error) {
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) throw new Error("Ondertitels en thumbnail komen er met migratie 040 (nog niet uitgevoerd).");
    throw new Error(friendlyError(error.message));
  }
}

export type PublicationItem = DbPublication & { channel_id: string; updated_at: string };

/** All publications of the studio (newest first), for the content calendar and the YouTube overview. */
export async function loadPublications(studioId: string): Promise<PublicationItem[] | "migration"> {
  const { data, error } = await supabase.from("yt_publications").select(COLS).eq("studio_id", studioId).order("updated_at", { ascending: false }).limit(200).returns<PublicationItem[]>();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /could not find|does not exist/i.test(error.message)) return "migration";
    throw new Error(friendlyError(error.message));
  }
  return data ?? [];
}

/** The moment that counts for the calendar: the planned time, or when it was published. */
export function calendarMoment(p: Pick<DbPublication, "status" | "publish_at"> & { updated_at: string }): string | null {
  if (p.status === "scheduled" && p.publish_at) return p.publish_at;
  if (p.status === "published") return p.updated_at;
  return p.publish_at;
}

/** Group by day in Amsterdam ("2026-11-14"), days in order. */
export function byDay<T>(items: T[], moment: (t: T) => string | null): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const t of items) {
    const m = moment(t);
    if (!m) continue;
    const day = new Date(m).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    map.set(day, [...(map.get(day) ?? []), t]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, items: list.sort((x, y) => (moment(x) ?? "").localeCompare(moment(y) ?? "")) }));
}

export type UploadProgress = { status: string; progress: number | null; phase: string | null; sentBytes: number | null; totalBytes: number | null };

/** Newest upload or visibility step of a video, for the progress bar while the worker talks to YouTube (migration 033). */
export async function loadUploadProgress(videoId: string): Promise<UploadProgress | null> {
  const { data, error } = await supabase.from("yt_jobs").select("*").eq("video_id", videoId).in("step", ["upload", "publish"]).order("created_at", { ascending: false }).limit(1).maybeSingle<{ status: string; progress?: number | string | null; phase?: string | null; metrics?: Record<string, number | null> | null }>();
  if (error || !data) return null;
  const p = data.progress == null ? null : Number(data.progress);
  return { status: data.status, progress: Number.isFinite(p) ? p : null, phase: data.phase ?? null, sentBytes: data.metrics?.sent_bytes ?? null, totalBytes: data.metrics?.total_bytes ?? null };
}

// YouTube Studio data in Supabase (migration 007). Until that migration has run, the studio works
// with the worker alone and shows that the database part is not ready yet.
import { friendlyError, supabase } from "../supabase";
import type { LocalRecording } from "./protocol";

export type DbRecording = { id: string; fingerprint: string; status: "uploading" | "received" | "ready" | "failed"; error: string | null };
export type DbJob = { id: string; step: string; status: "queued" | "running" | "done" | "failed" | "cancelled"; attempts: number; error: string | null; created_at: string; recording_id: string | null; video_id: string | null };

/** Supabase answers like this when a table does not exist (yet). */
const isMissingTable = (error: { code?: string; message: string }) => error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message);

export type DbState = { ready: true; recordings: DbRecording[]; jobs: DbJob[] } | { ready: false; reason: "migration" | "error"; message?: string };

export async function loadStudio(studioId: string): Promise<DbState> {
  const [rec, jobs] = await Promise.all([
    supabase.from("yt_recordings").select("id, fingerprint, status, error").eq("studio_id", studioId).order("created_at", { ascending: false }).returns<DbRecording[]>(),
    supabase.from("yt_jobs").select("id, step, status, attempts, error, created_at, recording_id, video_id").eq("studio_id", studioId).order("created_at", { ascending: false }).limit(20).returns<DbJob[]>(),
  ]);
  const error = rec.error ?? jobs.error;
  if (error) return isMissingTable(error) ? { ready: false, reason: "migration" } : { ready: false, reason: "error", message: friendlyError(error.message) };
  return { ready: true, recordings: rec.data ?? [], jobs: jobs.data ?? [] };
}

export async function isKnownRecording(studioId: string, fingerprint: string): Promise<boolean> {
  const { data, error } = await supabase.from("yt_recordings").select("id").eq("studio_id", studioId).eq("fingerprint", fingerprint).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return false;
    throw new Error(friendlyError(error.message));
  }
  return data !== null;
}

/** Records the received file and queues the intake step for the worker. Safe to repeat: nothing is added twice. */
export async function registerRecording(studioId: string, local: LocalRecording): Promise<void> {
  const insert = await supabase
    .from("yt_recordings")
    .insert({ studio_id: studioId, label: local.label, original_name: local.originalName, size_bytes: local.size, fingerprint: local.fingerprint, sha256: local.sha256, status: "received", is_test: local.isTest })
    .select("id")
    .single<{ id: string }>();
  let id = insert.data?.id;
  if (insert.error) {
    if (insert.error.code !== "23505") throw new Error(friendlyError(insert.error.message));
    const existing = await supabase.from("yt_recordings").select("id").eq("studio_id", studioId).eq("fingerprint", local.fingerprint).single<{ id: string }>();
    if (existing.error) throw new Error(friendlyError(existing.error.message));
    id = existing.data.id;
  }
  const job = await supabase.from("yt_jobs").insert({ studio_id: studioId, recording_id: id, step: "intake", idempotency_key: `intake:${id}` });
  if (job.error && job.error.code !== "23505") throw new Error(friendlyError(job.error.message));
}

export async function retryJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("retry_yt_job", { p_job: id });
  if (error) throw new Error(friendlyError(error.message));
}

export async function cancelJob(id: string): Promise<void> {
  const { error } = await supabase.from("yt_jobs").update({ status: "cancelled" }).eq("id", id).eq("status", "queued");
  if (error) throw new Error(friendlyError(error.message));
}

export const STEP_LABEL: Record<string, string> = {
  intake: "Intake (FFmpeg leest het bestand)",
  analyse: "Analyse",
  script: "Script",
  voiceover: "Voice-over",
  render: "Montage",
  upload: "Upload naar YouTube",
  publish: "Publiceren",
  suggest: "AI-suggesties",
};

export const JOB_STATUS_LABEL: Record<DbJob["status"], string> = { queued: "Wacht op de pc", running: "Bezig", done: "Klaar", failed: "Mislukt", cancelled: "Geannuleerd" };

/** Formats from docs/youtube-onderzoek.md, chapter 5. */
export const FORMATS = [
  { key: "A", name: "Bijna-dood-moment", kind: "Short, verticaal", length: "30-45 s", rhythm: "2 per week" },
  { key: "B", name: "Zeldzame vondst", kind: "Short, verticaal", length: "30-45 s", rhythm: "1 per week" },
  { key: "C", name: "Survival-verhaal", kind: "Lange video, horizontaal", length: "8-15 min", rhythm: "1 per week" },
] as const;

/** 1536 -> "1,5 kB"; Dutch number format. */
export function formatBytes(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("nl-NL", { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

/** 754000 -> "12:34"; 3_725_000 -> "1:02:05". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

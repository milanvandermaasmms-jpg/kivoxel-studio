// AI suggestions in the database (migration 048): the dashboard queues a "suggest" step, the worker writes the answer
// in yt_jobs.result. Every state is visible: waiting, busy, done, failed (with the reason), never silent.
import { friendlyError, supabase } from "../supabase";
import { readSuggestions, type Suggestions } from "./suggest";

export type SuggestState =
  | { state: "none" }
  | { state: "waiting" | "running"; jobId: string; since: string }
  | { state: "done"; jobId: string; suggestions: Suggestions; at: string }
  | { state: "failed"; jobId: string; error: string };

type Row = { id: string; status: string; error: string | null; result: unknown; created_at: string; finished_at: string | null };

const missingStep = (m: string) => /yt_jobs_step_check|violates check constraint/i.test(m);

export async function loadSuggestState(videoId: string): Promise<SuggestState> {
  const { data, error } = await supabase
    .from("yt_jobs")
    .select("id, status, error, result, created_at, finished_at")
    .eq("video_id", videoId)
    .eq("step", "suggest")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error(friendlyError(error.message));
  if (!data) return { state: "none" };
  if (data.status === "queued") return { state: "waiting", jobId: data.id, since: data.created_at };
  if (data.status === "running") return { state: "running", jobId: data.id, since: data.created_at };
  if (data.status === "done") {
    const s = readSuggestions(data.result);
    return s ? { state: "done", jobId: data.id, suggestions: s, at: data.finished_at ?? data.created_at } : { state: "failed", jobId: data.id, error: "De werker gaf een leeg antwoord." };
  }
  return { state: "failed", jobId: data.id, error: data.status === "cancelled" ? "Geannuleerd." : (data.error ?? "Onbekende fout.") };
}

/** Queues a new suggest step with the title and description as they are on screen now (also when not saved yet). */
export async function requestSuggestions(studioId: string, videoId: string, current: { title: string; description: string }): Promise<void> {
  const { error } = await supabase.from("yt_jobs").insert({
    studio_id: studioId,
    video_id: videoId,
    step: "suggest",
    idempotency_key: `suggest:${videoId}:${Date.now()}`,
    max_attempts: 2,
    payload: { title: current.title.slice(0, 100), description: current.description.slice(0, 2000) },
  });
  if (error) {
    if (missingStep(error.message)) throw new Error("AI-suggesties komen er met migratie 048 (nog niet uitgevoerd).");
    throw new Error(friendlyError(error.message));
  }
}

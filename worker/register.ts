// Registers a recording that arrived through the inbox folder, exactly like the web page does after an upload:
// a row in yt_recordings (never twice: the fingerprint is unique) and an intake step in the queue.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalRecording } from "../lib/youtube/protocol.ts";

export function createRegistrar(db: SupabaseClient) {
  let studioId: string | null = null;

  async function studio(): Promise<string> {
    if (studioId) return studioId;
    const { data, error } = await db.from("studios").select("id").limit(1).maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Er is nog geen studio: log eerst in op de studio-website en maak hem aan");
    studioId = data.id;
    return studioId;
  }

  return async function register(local: LocalRecording): Promise<void> {
    const sid = await studio();
    const insert = await db
      .from("yt_recordings")
      .insert({ studio_id: sid, label: local.label, original_name: local.originalName, size_bytes: local.size, fingerprint: local.fingerprint, sha256: local.sha256, status: "received", is_test: local.isTest })
      .select("id")
      .single<{ id: string }>();
    let id = insert.data?.id;
    if (insert.error) {
      if (insert.error.code !== "23505") throw new Error(insert.error.message);
      const existing = await db.from("yt_recordings").select("id").eq("studio_id", sid).eq("fingerprint", local.fingerprint).single<{ id: string }>();
      if (existing.error) throw new Error(existing.error.message);
      id = existing.data.id;
    }
    const job = await db.from("yt_jobs").insert({ studio_id: sid, recording_id: id, step: "intake", idempotency_key: `intake:${id}` });
    if (job.error && job.error.code !== "23505") throw new Error(job.error.message);
  };
}

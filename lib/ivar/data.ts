"use client";
// Ivar in the browser: conversations, messages, memory, ideas and concept changes through Supabase (RLS, migration 054).
// Sending goes through ivar_send (one step: message + queue step + answer slot). No keys here; the worker answers.
import { friendlyError, supabase } from "../supabase";
import { WORKER_URL } from "../youtube/protocol";
import type { JobRow } from "./tasks";
import type { Conversation, Idea, MemoryItem, Message, ProjectKind, Revision, Scope } from "./types";

const CONV_COLUMNS = "id, studio_id, channel_id, project_kind, project_id, project_label, title, created_at, last_message_at";
const MSG_COLUMNS = "id, conversation_id, role, content, cards, scope, status, note, job_id, reply_to, created_at, updated_at";
export const MISSING = "Ivar heeft migratie 054 nodig (nog niet uitgevoerd in Supabase).";
const isMissing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /does not exist|could not find/i.test(e.message);
const err = (e: { code?: string; message: string }) => new Error(isMissing(e) ? MISSING : friendlyError(e.message));

export async function listConversations(studioId: string, search = ""): Promise<Conversation[]> {
  let q = supabase.from("ivar_conversations").select(CONV_COLUMNS).eq("studio_id", studioId);
  const s = search.trim().replace(/[%_\\,()]/g, " ");
  if (s) q = q.ilike("title", `%${s}%`);
  const { data, error } = await q.order("last_message_at", { ascending: false }).limit(60).returns<Conversation[]>();
  if (error) throw err(error);
  return data ?? [];
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await supabase.from("ivar_conversations").select(CONV_COLUMNS).eq("id", id).maybeSingle<Conversation>();
  if (error) throw err(error);
  return data;
}

export async function createConversation(studioId: string, scope: Scope): Promise<Conversation> {
  const { data, error } = await supabase
    .from("ivar_conversations")
    .insert({ studio_id: studioId, channel_id: scope.channelId, project_kind: scope.channelId && scope.projectId ? scope.projectKind : null, project_id: scope.channelId ? (scope.projectId ?? null) : null, project_label: scope.channelId && scope.projectId ? (scope.projectLabel ?? null) : null })
    .select(CONV_COLUMNS)
    .single<Conversation>();
  if (error) throw err(error);
  return data;
}

/** Changing the scope of a conversation affects only new messages; running tasks keep their own project. */
export async function setConversationScope(id: string, scope: Scope): Promise<void> {
  const { error } = await supabase
    .from("ivar_conversations")
    .update({ channel_id: scope.channelId, project_kind: scope.channelId && scope.projectId ? (scope.projectKind ?? "video") : null, project_id: scope.channelId ? (scope.projectId ?? null) : null, project_label: scope.channelId && scope.projectId ? (scope.projectLabel ?? null) : null })
    .eq("id", id);
  if (error) throw err(error);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("ivar_conversations").update({ title: title.trim().slice(0, 120) || "Gesprek" }).eq("id", id);
  if (error) throw err(error);
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from("ivar_conversations").delete().eq("id", id);
  if (error) throw err(error);
}

export async function loadMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase.from("ivar_messages").select(MSG_COLUMNS).eq("conversation_id", conversationId).order("created_at").limit(200).returns<Message[]>();
  if (error) throw err(error);
  return data ?? [];
}

export async function send(conversationId: string, content: string, key: string, scope: Scope): Promise<{ reply_id: string; job_id: string; duplicate: boolean }> {
  const { data, error } = await supabase.rpc("ivar_send", { p_conversation: conversationId, p_content: content, p_client_key: key, p_scope: scope });
  if (error) throw err(error);
  void pokeWorker();
  return data as { reply_id: string; job_id: string; duplicate: boolean };
}

/** On Milan's pc the worker can start at once; elsewhere it finds the step within a few seconds. */
export async function pokeWorker(): Promise<void> {
  await fetch(`${WORKER_URL}/poke`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => undefined);
}

export async function stopReply(replyId: string): Promise<void> {
  const { error } = await supabase.rpc("ivar_stop", { p_reply: replyId });
  if (error) throw err(error);
}

export async function retryReply(replyId: string): Promise<void> {
  const { error } = await supabase.rpc("ivar_retry", { p_reply: replyId });
  if (error) throw err(error);
  void pokeWorker();
}

// ---------- tasks ----------

const JOB_COLUMNS = "id, step, status, error, attempts, max_attempts, phase, progress, cancel_requested, created_at, started_at, finished_at, video_id, recording_id";
export async function loadJobs(ids: string[]): Promise<JobRow[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("yt_jobs").select(JOB_COLUMNS).in("id", ids).returns<JobRow[]>();
  if (error) throw err(error);
  return data ?? [];
}
export async function loadDnJobs(ids: string[]): Promise<JobRow[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("dn_render_jobs").select("id, step, status, error, progress, created_at, started_at, finished_at, episode_id").in("id", ids).returns<JobRow[]>();
  if (error) return [];
  return data ?? [];
}
/** Steps that run for the project in scope (also ones Milan started himself), newest first. */
export async function activeJobsFor(studioId: string, scope: Scope): Promise<JobRow[]> {
  if (!scope.projectId || scope.projectKind === "episode") return [];
  const col = scope.projectKind === "recording" ? "recording_id" : "video_id";
  const { data } = await supabase.from("yt_jobs").select(JOB_COLUMNS).eq("studio_id", studioId).eq(col, scope.projectId).in("status", ["queued", "running"]).neq("step", "assistant").order("created_at", { ascending: false }).limit(5).returns<JobRow[]>();
  return data ?? [];
}
export async function cancelYtJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_yt_job", { p_job: id });
  if (error) throw err(error);
}
export async function retryYtJob(id: string): Promise<void> {
  const { error } = await supabase.rpc("retry_yt_job", { p_job: id });
  if (error) throw err(error);
  void pokeWorker();
}
export async function cancelDnJob(id: string): Promise<void> {
  const { error } = await supabase.from("dn_render_jobs").update({ status: "cancelled" }).eq("id", id).eq("status", "queued");
  if (error) throw err(error);
}

export type RenderInfo = { id: string; video_id: string; file_name: string; duration_ms: number; width: number; height: number; voice_name: string | null; created_at: string; qc: { items?: { label: string; level: string; value?: string }[] } | null };
export async function renderOfJob(jobId: string): Promise<RenderInfo | null> {
  const { data } = await supabase.from("yt_renders").select("id, video_id, file_name, duration_ms, width, height, voice_name, created_at, qc").eq("job_id", jobId).maybeSingle<RenderInfo>();
  return data ?? null;
}

// ---------- concept changes ----------

export async function loadRevisions(ids: string[]): Promise<Revision[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("ivar_revisions").select("id, video_id, target, field, before_value, after_value, status, group_id, note").in("id", ids).returns<Revision[]>();
  if (error) throw err(error);
  return data ?? [];
}
export async function applyRevision(id: string): Promise<void> {
  const { error } = await supabase.rpc("ivar_apply_revision", { p_revision: id });
  if (error) throw err(error);
}
export async function revertRevision(id: string): Promise<void> {
  const { error } = await supabase.rpc("ivar_revert_revision", { p_revision: id });
  if (error) throw err(error);
}

// ---------- memory and ideas ----------

export async function loadMemory(studioId: string): Promise<MemoryItem[]> {
  const { data, error } = await supabase.from("ivar_memory").select("id, channel_id, project_kind, project_id, scope, content, source, updated_at").eq("studio_id", studioId).order("updated_at", { ascending: false }).limit(200).returns<MemoryItem[]>();
  if (error) throw err(error);
  return data ?? [];
}
export async function addMemory(studioId: string, content: string, where: { channelId: string | null; projectKind?: ProjectKind | null; projectId?: string | null }): Promise<void> {
  const { error } = await supabase.from("ivar_memory").insert({ studio_id: studioId, content: content.trim().slice(0, 500), channel_id: where.channelId, project_kind: where.projectId ? (where.projectKind ?? null) : null, project_id: where.projectId ?? null });
  if (error) throw err(error);
}
export async function updateMemory(id: string, content: string): Promise<void> {
  const { error } = await supabase.from("ivar_memory").update({ content: content.trim().slice(0, 500) }).eq("id", id);
  if (error) throw err(error);
}
export async function deleteMemory(id: string): Promise<void> {
  const { error } = await supabase.from("ivar_memory").delete().eq("id", id);
  if (error) throw err(error);
}

export async function loadIdeas(ids: string[]): Promise<Idea[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("ivar_ideas").select("id, channel_id, title, premise, opening, source_material, shorts, status, episode_id, created_at").in("id", ids).returns<Idea[]>();
  if (error) throw err(error);
  return data ?? [];
}
export async function setIdea(id: string, fields: { status: Idea["status"]; episode_id?: string | null }): Promise<void> {
  const { error } = await supabase.from("ivar_ideas").update(fields).eq("id", id);
  if (error) throw err(error);
}

/** Milan's own clicks on Ivar's cards go into the same log. */
export async function logClick(studioId: string, conversationId: string | null, tool: string, summary: string, extra: { channelId?: string | null; jobId?: string | null } = {}): Promise<void> {
  await supabase.from("ivar_actions").insert({ studio_id: studioId, conversation_id: conversationId, actor: "milan", tool, ok: true, summary: summary.slice(0, 300), channel_id: extra.channelId ?? null, job_id: extra.jobId ?? null });
}

// ---------- scope picker ----------

export type ProjectOption = { kind: ProjectKind; id: string; label: string; sub: string };
export async function projectOptions(studioId: string, channelId: string, dreamnest: boolean): Promise<ProjectOption[]> {
  if (dreamnest) {
    const { data } = await supabase.from("dn_episodes").select("id, title, status").eq("studio_id", studioId).eq("channel_id", channelId).neq("status", "archived").order("created_at", { ascending: false }).limit(30).returns<{ id: string; title: string; status: string }[]>();
    return (data ?? []).map((e) => ({ kind: "episode", id: e.id, label: e.title || "Zonder titel", sub: "Aflevering" }));
  }
  const [recs, vids] = await Promise.all([
    supabase.from("yt_recordings").select("id, label").eq("studio_id", studioId).eq("channel_id", channelId).order("created_at", { ascending: false }).limit(15).returns<{ id: string; label: string }[]>(),
    supabase.from("yt_videos").select("id, title, promise, format, status").eq("studio_id", studioId).eq("channel_id", channelId).neq("status", "archived").order("created_at", { ascending: false }).limit(30).returns<{ id: string; title: string | null; promise: string | null; format: string; status: string }[]>(),
  ]);
  return [
    ...(recs.data ?? []).map((r) => ({ kind: "recording" as const, id: r.id, label: r.label, sub: "Opname" })),
    ...(vids.data ?? []).map((v) => ({ kind: "video" as const, id: v.id, label: (v.title || v.promise || (v.format === "C" ? "Lange video" : "Short")).slice(0, 80), sub: v.format === "C" ? "Lange video" : "Short" })),
  ];
}

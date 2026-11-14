// Ivar — Studio Assistant: shared types for the chat (browser) and the agent (worker). Pure, no I/O.

export type ProjectKind = "recording" | "video" | "episode";
export type ChannelKind = "kivoxel" | "dreamnest" | "other";

/** What Ivar works on. Shown at the top of the chat as "Kivoxel → The One Who Watches → Shorts". */
export type Scope = {
  channelId: string | null;
  channelName?: string | null;
  projectKind?: ProjectKind | null;
  projectId?: string | null;
  projectLabel?: string | null;
  /** The part of the studio Milan looks at ("Shorts", "Actie nodig", "Instellingen"). Context only, never a target. */
  page?: string | null;
};

export type Conversation = {
  id: string;
  studio_id: string;
  channel_id: string | null;
  project_kind: ProjectKind | null;
  project_id: string | null;
  project_label: string | null;
  title: string;
  created_at: string;
  last_message_at: string;
};

export type MessageStatus = "pending" | "running" | "done" | "error" | "stopped";
export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  cards: Card[];
  scope: Scope | Record<string, never>;
  status: MessageStatus;
  note: string | null;
  job_id: string | null;
  reply_to: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryItem = {
  id: string;
  channel_id: string | null;
  project_kind: ProjectKind | null;
  project_id: string | null;
  scope: "studio" | "channel" | "project";
  content: string;
  source: "milan" | "ivar";
  updated_at: string;
};

export type Idea = {
  id: string;
  channel_id: string;
  title: string;
  premise: string;
  opening: string;
  source_material: string;
  shorts: string[];
  status: "idea" | "project" | "dropped";
  episode_id: string | null;
  created_at: string;
};

export type Revision = {
  id: string;
  video_id: string;
  target: "publication" | "video";
  field: "title" | "description" | "tags";
  before_value: unknown;
  after_value: unknown;
  status: "proposed" | "applied" | "reverted" | "superseded";
  group_id: string | null;
  note: string | null;
};

/** Result cards. Buttons on them call real functions; the live state (applied, job status) is read from the database. */
export type Card =
  | { type: "titles"; videoId: string; groupId: string; target: "video" | "publication"; options: { revisionId: string; title: string; why: string }[] }
  | { type: "metadata"; videoId: string; changes: { revisionId: string; field: "title" | "description" | "tags"; before: unknown; after: unknown }[]; applied: boolean; note: string | null }
  | {
      type: "analysis";
      projectLabel: string;
      videoId: string | null;
      sources: { wholeVideo: boolean; audioAnalysed: boolean; data: string[] };
      observations: { atMs: number | null; text: string }[];
      priorities: { atMs: number | null; text: string }[];
      uncertain: string[];
    }
  | { type: "concept"; ideaId: string; channelId: string; channelKind: ChannelKind; title: string; premise: string; opening: string; sourceMaterial: string; shorts: string[] }
  | { type: "render"; videoId: string; renderId: string; fileName: string; durationMs: number; width: number; height: number; createdAt: string; checks: { label: string; ok: boolean | null }[]; voice: string | null }
  | { type: "task"; queue: "yt" | "dn"; jobId: string; label: string }
  | { type: "confirm"; action: "analyse" | "analyse_again" | "series" | "quality"; targetId: string; label: string; text: string; estimateCents: number | null; estimate: boolean }
  | { type: "edit"; videoId: string; scriptId: string; version: number; removedMs: number; cuts: [number, number][]; note: string }
  | { type: "script"; videoId: string; scriptId: string; version: number; changed: number; note: string }
  | { type: "memory"; content: string; channelId: string | null; projectKind: ProjectKind | null; projectId: string | null; question: string; saved: boolean }
  | { type: "publish"; videoId: string; channelName: string; fileName: string | null; visibility: string; publishAt: string | null; problems: string[] }
  | { type: "unavailable"; what: string; why: string };

export const CARD_TYPES = ["titles", "metadata", "analysis", "concept", "render", "task", "confirm", "edit", "script", "memory", "publish", "unavailable"] as const;

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = { recording: "Opname", video: "Video", episode: "Aflevering" };

/** The breadcrumb at the top of the chat. */
export function scopeTrail(s: Scope | null | undefined): string[] {
  if (!s?.channelId) return ["Hele studio", ...(s?.page ? [s.page] : [])];
  return [s.channelName || "Kanaal", ...(s.projectId ? [s.projectLabel || PROJECT_KIND_LABEL[s.projectKind ?? "video"]] : []), ...(s.page ? [s.page] : [])];
}

/** The same scope? Used to decide whether a new page context should start another conversation. Never changes an existing task. */
export const sameTarget = (a: Scope | null | undefined, b: Scope | null | undefined) =>
  (a?.channelId ?? null) === (b?.channelId ?? null) && (a?.projectId ?? null) === (b?.projectId ?? null);

/** A conversation row as a scope. */
export const scopeOf = (c: Pick<Conversation, "channel_id" | "project_kind" | "project_id" | "project_label">, channelName?: string | null): Scope => ({
  channelId: c.channel_id,
  channelName: channelName ?? null,
  projectKind: c.project_kind,
  projectId: c.project_id,
  projectLabel: c.project_label,
});

/** Client key against double sending (also after a reconnect): 8-64 of [A-Za-z0-9_-]. */
export function clientKey(random: () => number = Math.random): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 20 }, () => chars[Math.floor(random() * chars.length)]).join("");
}

export const euro = (cents: number) => `€ ${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

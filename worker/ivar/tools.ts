// Ivar's tools, server side on the pc (service key from worker/.env.local, never in the browser).
// Every tool: input validated (lib/ivar/schema.ts), allowed for this message (lib/ivar/intent.ts), every row filtered on
// the studio of the queued step and checked against the conversation's channel, a structured result with a clear Dutch
// error, and one line in ivar_actions. Jobs go into the existing queue (yt_jobs) with idempotency keys, never twice.
// No SQL, no shell, no network requests from here.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateAnalysisCents, formatTimecode, partLabel, SERIES_PART_MS, type ScriptLine, type Segment } from "../../lib/youtube/analysis.ts";
import { isDreamnestChannel } from "../../lib/studioRoutes.ts";
import { asksToRemember, toolAllowed, type Intent } from "../../lib/ivar/intent.ts";
import { validate } from "../../lib/ivar/schema.ts";
import { TOOL_BY_NAME } from "../../lib/ivar/tools.ts";
import { applyCuts, replaceLines } from "../../lib/ivar/edits.ts";
import { taskView, type JobRow } from "../../lib/ivar/tasks.ts";
import type { Card, ChannelKind, ProjectKind } from "../../lib/ivar/types.ts";

export type ChannelRow = { id: string; name: string; is_default: boolean; status: string; language: string; audience: string | null; slug: string | null; safety_profile: string | null; banned_words: string[] | null; voice_name: string | null; speaking_rate: number | null; made_for_kids: boolean | null; youtube_channel_id: string | null };
export const CHANNEL_COLUMNS = "id, name, is_default, status, language, audience, slug, safety_profile, banned_words, voice_name, speaking_rate, made_for_kids, youtube_channel_id";

export const channelKind = (c: Pick<ChannelRow, "id" | "is_default" | "slug" | "safety_profile">): ChannelKind => (isDreamnestChannel(c) ? "dreamnest" : c.is_default ? "kivoxel" : "other");

export type ToolEnv = {
  db: SupabaseClient;
  studioId: string;
  conversationId: string;
  replyId: string;
  channel: ChannelRow | null;
  project: { kind: ProjectKind; id: string; label: string } | null;
  intent: Intent;
  userText: string;
  cards: Card[];
  /** Wakes the queue in this worker, so a queued step starts at once. */
  poke?: () => void;
  dreamnest: boolean;
};

export type ToolOutcome = { ok: boolean; result: unknown; summary: string };

export class ToolError extends Error {}
const fail = (message: string): never => {
  throw new ToolError(message);
};

type VideoRow = { id: string; recording_id: string | null; format: "A" | "B" | "C"; kind: "short" | "long"; title: string | null; promise: string | null; status: string; plan_key: string | null; channel_id: string | null; youtube_video_id: string | null; is_test: boolean; created_at: string };
const VIDEO_COLUMNS = "id, recording_id, format, kind, title, promise, status, plan_key, channel_id, youtube_video_id, is_test, created_at";
type RecordingRow = { id: string; label: string; status: string; duration_ms: number | null; is_test: boolean; channel_id: string | null; created_at: string };
const RECORDING_COLUMNS = "id, label, status, duration_ms, is_test, channel_id, created_at";
type ScriptRow = { id: string; video_id: string; version: number; language: "en" | "nl"; top_line: string | null; hook: string; lines: ScriptLine[]; edit_plan: Segment[]; target_ms: number; status: string; source: string; is_test: boolean; titles?: string[] | null; hooks?: unknown; chosen_hook?: number | null; channel_id?: string | null };
type PublicationRow = { id: string; video_id: string; title: string; description: string; tags: string[]; visibility: string; publish_at: string | null; status: string; render_id: string | null; youtube_video_id: string | null };
type RenderRow = { id: string; video_id: string; script_id: string; file_name: string; duration_ms: number; width: number; height: number; voice_name: string | null; created_at: string; qc?: { items?: { label: string; level: string; value?: string; note?: string }[] } | null };
const JOB_COLUMNS = "id, step, status, error, attempts, max_attempts, phase, progress, cancel_requested, created_at, started_at, finished_at, video_id, recording_id";

export const FORMAT_LABEL: Record<string, string> = { A: "Short", B: "Short", C: "Lange video" };
export const videoLabel = (v: Pick<VideoRow, "title" | "promise" | "format" | "plan_key">, scriptTitle?: string | null) =>
  `${(v.title || scriptTitle || v.promise || FORMAT_LABEL[v.format]).slice(0, 100)}${partLabel(v.plan_key) ? ` (${partLabel(v.plan_key)})` : ""}`;

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) fail(`${what} kon niet worden gelezen: ${r.error.message}`);
  return r.data as T;
}

// ---------- scope ----------

function requireChannel(env: ToolEnv): ChannelRow {
  return env.channel ?? fail("Kies eerst een kanaal bovenin Ivar; deze opdracht hoort bij één kanaal.");
}
function inScope(env: ToolEnv, channelId: string | null, what: string) {
  if (env.channel && channelId && channelId !== env.channel.id) fail(`Deze ${what} hoort bij een ander kanaal dan "${env.channel.name}". Wissel de scope bovenin Ivar als je dat kanaal bedoelt.`);
}
async function video(env: ToolEnv, id: string): Promise<VideoRow> {
  const v = must(await env.db.from("yt_videos").select(VIDEO_COLUMNS).eq("id", id).eq("studio_id", env.studioId).maybeSingle<VideoRow>(), "De video");
  if (!v) fail("Deze video bestaat niet (meer) in deze studio.");
  inScope(env, v!.channel_id, "video");
  return v!;
}
async function recording(env: ToolEnv, id: string): Promise<RecordingRow> {
  const r = must(await env.db.from("yt_recordings").select(RECORDING_COLUMNS).eq("id", id).eq("studio_id", env.studioId).maybeSingle<RecordingRow>(), "De opname");
  if (!r) fail("Deze opname bestaat niet (meer) in deze studio.");
  inScope(env, r!.channel_id, "opname");
  return r!;
}
async function latestScript(env: ToolEnv, videoId: string, approvedOnly = false): Promise<ScriptRow | null> {
  let q = env.db.from("yt_scripts").select("*").eq("video_id", videoId).eq("studio_id", env.studioId);
  if (approvedOnly) q = q.eq("status", "approved");
  return must(await q.order("version", { ascending: false }).limit(1).maybeSingle<ScriptRow>(), "Het script");
}
async function publication(env: ToolEnv, videoId: string): Promise<PublicationRow | null> {
  return must(await env.db.from("yt_publications").select("id, video_id, title, description, tags, visibility, publish_at, status, render_id, youtube_video_id").eq("video_id", videoId).eq("studio_id", env.studioId).maybeSingle<PublicationRow>(), "Het publicatieconcept");
}
async function latestRender(env: ToolEnv, videoId: string): Promise<RenderRow | null> {
  return must(await env.db.from("yt_renders").select("*").eq("video_id", videoId).eq("studio_id", env.studioId).order("created_at", { ascending: false }).limit(1).maybeSingle<RenderRow>(), "De montage");
}
async function paidEnabled(env: ToolEnv): Promise<boolean> {
  const { data } = await env.db.from("yt_settings").select("paid_processing_enabled").eq("studio_id", env.studioId).maybeSingle<{ paid_processing_enabled: boolean }>();
  return data?.paid_processing_enabled === true;
}
async function queueJob(env: ToolEnv, fields: Record<string, unknown>): Promise<{ id: string; existed: boolean }> {
  const ins = await env.db.from("yt_jobs").insert({ studio_id: env.studioId, channel_id: env.channel?.id ?? null, ...fields }).select("id").maybeSingle<{ id: string }>();
  if (ins.error && ins.error.code !== "23505") fail(`De stap kon niet in de wachtrij: ${ins.error.message}`);
  if (ins.data) {
    env.poke?.();
    return { id: ins.data.id, existed: false };
  }
  const found = must(await env.db.from("yt_jobs").select("id").eq("studio_id", env.studioId).eq("idempotency_key", String(fields.idempotency_key)).single<{ id: string }>(), "De stap");
  return { id: found.id, existed: true };
}
async function activeJob(env: ToolEnv, column: "video_id" | "recording_id", id: string, step: string): Promise<{ id: string; status: string } | null> {
  const rows = must(await env.db.from("yt_jobs").select("id, status").eq("studio_id", env.studioId).eq(column, id).eq("step", step).in("status", ["queued", "running"]).limit(1).returns<{ id: string; status: string }[]>(), "De wachtrij");
  return rows?.[0] ?? null;
}
const taskCard = (env: ToolEnv, jobId: string, label: string, queue: "yt" | "dn" = "yt") => env.cards.push({ type: "task", queue, jobId, label });

// ---------- read ----------

async function listChannels(env: ToolEnv) {
  const rows = must(await env.db.from("yt_channels").select(CHANNEL_COLUMNS).eq("studio_id", env.studioId).order("is_default", { ascending: false }).returns<ChannelRow[]>(), "De kanalen");
  return (rows ?? []).map((c) => ({ id: c.id, name: c.name, kind: channelKind(c), status: c.status, language: c.language, linked_to_youtube: !!c.youtube_channel_id }));
}

async function listProjects(env: ToolEnv, a: { query?: string; limit?: number }) {
  const ch = requireChannel(env);
  const limit = a.limit ?? 12;
  const like = a.query ? `%${a.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  if (channelKind(ch) === "dreamnest") {
    if (!env.dreamnest) return { channel: ch.name, episodes: [], note: "Dreamnest staat uit op deze pc (FEATURE_DREAMNEST)." };
    let q = env.db.from("dn_episodes").select("id, title, status, duration_min, created_at").eq("studio_id", env.studioId).eq("channel_id", ch.id).neq("status", "archived");
    if (like) q = q.ilike("title", like);
    const eps = must(await q.order("created_at", { ascending: false }).limit(limit).returns<{ id: string; title: string; status: string; duration_min: number; created_at: string }[]>(), "De afleveringen");
    return { channel: ch.name, episodes: (eps ?? []).map((e) => ({ kind: "episode", id: e.id, title: e.title || "Zonder titel", status: e.status, minutes: e.duration_min, created: e.created_at.slice(0, 10) })) };
  }
  let rq = env.db.from("yt_recordings").select(RECORDING_COLUMNS).eq("studio_id", env.studioId).eq("channel_id", ch.id);
  if (like) rq = rq.ilike("label", like);
  // Videos are found by the title the studio shows (working title, publication, script title, top line), not only the working title.
  const vq = env.db.from("yt_videos").select(VIDEO_COLUMNS).eq("studio_id", env.studioId).eq("channel_id", ch.id).neq("status", "archived");
  const [recs, all] = await Promise.all([rq.order("created_at", { ascending: false }).limit(limit).returns<RecordingRow[]>(), vq.order("created_at", { ascending: false }).limit(200).returns<VideoRow[]>()]);
  const allVids = must(all, "De video's") ?? [];
  const ids = allVids.map((v) => v.id);
  const [scripts, pubs] = ids.length
    ? await Promise.all([
        env.db.from("yt_scripts").select("video_id, version, titles, top_line, status").in("video_id", ids).neq("status", "rejected").order("version", { ascending: false }).returns<{ video_id: string; titles: string[] | null; top_line: string | null }[]>(),
        env.db.from("yt_publications").select("video_id, title").in("video_id", ids).returns<{ video_id: string; title: string }[]>(),
      ])
    : [{ data: [] }, { data: [] }];
  const named = new Map<string, string>();
  for (const p of pubs.data ?? []) if (p.title) named.set(p.video_id, p.title);
  for (const s of scripts.data ?? []) if (!named.has(s.video_id) && (s.titles?.[0] || s.top_line)) named.set(s.video_id, (s.titles?.[0] ?? s.top_line)!);
  const words = (a.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hit = (v: VideoRow) => !words.length || words.every((w) => `${v.title ?? ""} ${named.get(v.id) ?? ""} ${v.promise ?? ""} ${partLabel(v.plan_key) ?? ""}`.toLowerCase().includes(w));
  const vids = { data: allVids.filter(hit).slice(0, limit * 2), error: null };
  return {
    channel: ch.name,
    recordings: (must(recs, "De opnames") ?? []).map((r) => ({ kind: "recording", id: r.id, label: r.label, status: r.status, length: r.duration_ms ? formatTimecode(r.duration_ms) : null, test: r.is_test })),
    videos: vids.data.map((v) => ({ kind: "video", id: v.id, label: videoLabel(v, named.get(v.id)), type: FORMAT_LABEL[v.format], status: v.status, recording_id: v.recording_id, on_youtube: !!v.youtube_video_id })),
  };
}

async function recentJobs(env: ToolEnv, column: "video_id" | "recording_id", id: string, limit = 5) {
  const rows = must(await env.db.from("yt_jobs").select(JOB_COLUMNS).eq("studio_id", env.studioId).eq(column, id).neq("step", "assistant").order("created_at", { ascending: false }).limit(limit).returns<JobRow[]>(), "De stappen");
  return (rows ?? []).map((j) => {
    const t = taskView(j, "yt");
    return { id: j.id, name: t.name, status: t.status, now: t.statusLabel, percent: t.percent, error: t.error };
  });
}

async function getProject(env: ToolEnv, a: { kind: ProjectKind; id: string }) {
  if (a.kind === "recording") {
    const r = await recording(env, a.id);
    const [moments, vids, jobs] = await Promise.all([
      env.db.from("yt_moments").select("id, kind, start_ms, end_ms, reason, score, suggested_format").eq("recording_id", r.id).eq("studio_id", env.studioId).order("start_ms").limit(40).returns<{ id: string; kind: string; start_ms: number; end_ms: number; reason: string; score: number; suggested_format: string | null }[]>(),
      env.db.from("yt_videos").select(VIDEO_COLUMNS).eq("recording_id", r.id).eq("studio_id", env.studioId).neq("status", "archived").order("created_at").returns<VideoRow[]>(),
      recentJobs(env, "recording_id", r.id),
    ]);
    return {
      kind: "recording",
      id: r.id,
      label: r.label,
      status: r.status,
      length: r.duration_ms ? formatTimecode(r.duration_ms) : null,
      test_data: r.is_test,
      analysed: (must(moments, "De momenten") ?? []).length > 0,
      moments: (moments.data ?? []).map((m) => ({ at: `${formatTimecode(m.start_ms)}-${formatTimecode(m.end_ms)}`, kind: m.kind, score: m.score, reason: m.reason.slice(0, 160), format: m.suggested_format })),
      videos: (must(vids, "De video's") ?? []).map((v) => ({ id: v.id, label: videoLabel(v), type: FORMAT_LABEL[v.format], status: v.status })),
      steps: jobs,
    };
  }
  if (a.kind === "episode") {
    if (!env.dreamnest) fail("Dreamnest staat uit op deze pc.");
    const e = must(await env.db.from("dn_episodes").select("id, channel_id, title, status, duration_min, concept, budget_cents, spent_cents, video_id").eq("id", a.id).eq("studio_id", env.studioId).maybeSingle<{ id: string; channel_id: string; title: string; status: string; duration_min: number; concept: unknown; budget_cents: number; spent_cents: number; video_id: string | null }>(), "De aflevering");
    if (!e) fail("Deze aflevering bestaat niet (meer).");
    inScope(env, e!.channel_id, "aflevering");
    const jobs = must(await env.db.from("dn_render_jobs").select("id, step, status, error, progress, created_at, started_at, finished_at").eq("episode_id", e!.id).eq("studio_id", env.studioId).order("created_at", { ascending: false }).limit(8).returns<JobRow[]>(), "De Dreamnest-stappen");
    return {
      kind: "episode",
      id: e!.id,
      title: e!.title,
      status: e!.status,
      minutes: e!.duration_min,
      budget: `${e!.spent_cents} van ${e!.budget_cents} cent gebruikt`,
      concept: JSON.stringify(e!.concept).slice(0, 1500),
      steps: (jobs ?? []).map((j) => ({ id: j.id, ...pick(taskView(j, "dn"), ["name", "status", "statusLabel", "percent", "error"]) })),
    };
  }
  const v = await video(env, a.id);
  const [script, approved, pub, render, viral, jobs, rec] = await Promise.all([
    latestScript(env, v.id),
    latestScript(env, v.id, true),
    publication(env, v.id),
    latestRender(env, v.id),
    env.db.from("yt_viral_checks").select("overall, created_at").eq("video_id", v.id).eq("studio_id", env.studioId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ overall: number; created_at: string }>(),
    recentJobs(env, "video_id", v.id),
    v.recording_id ? env.db.from("yt_recordings").select("label").eq("id", v.recording_id).maybeSingle<{ label: string }>() : Promise.resolve({ data: null }),
  ]);
  return {
    kind: "video",
    id: v.id,
    label: videoLabel(v, script?.titles?.[0]),
    type: FORMAT_LABEL[v.format],
    part: partLabel(v.plan_key),
    status: v.status,
    on_youtube: !!v.youtube_video_id,
    recording: rec.data?.label ?? null,
    recording_id: v.recording_id,
    script: script && { version: script.version, status: script.status, hook: script.hook, top_line: script.top_line, title_ideas: script.titles ?? [], lines: script.lines.length, target: formatTimecode(script.target_ms), approved_version: approved?.version ?? null },
    montage: render && { file: render.file_name, length: formatTimecode(render.duration_ms), size: `${render.width}×${render.height}`, voice: render.voice_name, made: render.created_at, checks: (render.qc?.items ?? []).map((i) => `${i.label}: ${i.level}${i.value ? ` (${i.value})` : ""}`) },
    publication: pub && { status: pub.status, title: pub.title, description: pub.description.slice(0, 400), tags: pub.tags, visibility: pub.visibility, publish_at: pub.publish_at },
    viral_score: viral.data ? Number(viral.data.overall) : null,
    steps: jobs,
  };
}
const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

async function memoryFor(env: ToolEnv) {
  let q = env.db.from("ivar_memory").select("scope, content, channel_id, project_id").eq("studio_id", env.studioId);
  q = env.channel ? q.or(`channel_id.is.null,channel_id.eq.${env.channel.id}`) : q.is("channel_id", null);
  const rows = must(await q.order("updated_at", { ascending: false }).limit(40).returns<{ scope: string; content: string; channel_id: string | null; project_id: string | null }[]>(), "Het geheugen");
  return (rows ?? []).filter((m) => !m.project_id || m.project_id === env.project?.id).map((m) => ({ scope: m.scope, content: m.content }));
}

async function guidelines(env: ToolEnv) {
  const ch = requireChannel(env);
  return {
    channel: ch.name,
    kind: channelKind(ch),
    status: ch.status,
    language: ch.language,
    audience: ch.audience,
    banned_words: ch.banned_words ?? [],
    voice: ch.voice_name,
    speaking_rate: ch.speaking_rate,
    made_for_kids: ch.made_for_kids,
    linked_to_youtube: !!ch.youtube_channel_id,
    memory: await memoryFor(env),
  };
}

async function transcript(env: ToolEnv, a: { video_id: string }) {
  const v = await video(env, a.video_id);
  const s = await latestScript(env, v.id);
  if (!s) return { video: videoLabel(v), note: "Er is nog geen script voor deze video." };
  return {
    video: videoLabel(v, s.titles?.[0]),
    version: s.version,
    status: s.status,
    language: s.language,
    top_line: s.top_line,
    hook: s.hook,
    lines: s.lines.map((l, index) => ({ index, at: formatTimecode(l.at_ms), text: l.text })),
    note: "Dit is de voice-overtekst van het script, geen transcriptie van de gameplay zelf.",
  };
}

async function qualityReport(env: ToolEnv, a: { video_id: string }) {
  const v = await video(env, a.video_id);
  const [render, viral, script] = await Promise.all([
    latestRender(env, v.id),
    env.db.from("yt_viral_checks").select("overall, result, source, created_at, render_id").eq("video_id", v.id).eq("studio_id", env.studioId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ overall: number; result: Record<string, unknown>; source: string; created_at: string; render_id: string | null }>(),
    latestScript(env, v.id, true),
  ]);
  const plan = script?.edit_plan ?? [];
  return {
    video: videoLabel(v),
    montage: render ? { file: render.file_name, length: formatTimecode(render.duration_ms), size: `${render.width}×${render.height}`, voice: render.voice_name ?? "zonder stem", made: render.created_at, checks: render.qc?.items ?? "nog niet gemeten" } : "Er is nog geen montage.",
    viral_check: viral.data ? { score: Number(viral.data.overall), source: viral.data.source === "ai" ? "regels plus AI-luisterbeurt (audio)" : viral.data.source === "rules" ? "alleen regels op meetwaarden (audio niet beluisterd)" : "testdata", about_latest_montage: !!render && viral.data.render_id === render.id, made: viral.data.created_at, result: JSON.stringify(viral.data.result).slice(0, 3500) } : "Nog geen viral-check.",
    montage_plan: plan.slice(0, 30).map((s) => ({ part: s.part, out: formatTimecode(s.out_start_ms), source: `${formatTimecode(s.src_start_ms)}-${formatTimecode(s.src_end_ms)}`, speed: s.speed, note: s.note.slice(0, 80) })),
    limits: "Ivar ziet meetwaarden, het montageplan en de viral-check; niet de beelden zelf. Zeg dat erbij.",
  };
}

async function analytics(env: ToolEnv, a: { video_id?: string }) {
  if (a.video_id) {
    const v = await video(env, a.video_id);
    if (!v.youtube_video_id) return { video: videoLabel(v), note: "Deze video staat nog niet op YouTube: er zijn geen cijfers." };
    const snaps = must(await env.db.from("yt_video_snapshots").select("taken_at, published_at, views, likes, comments, watch_minutes, avg_view_duration_s, avg_view_pct, subscribers_gained, analytics_until, retention").eq("studio_id", env.studioId).eq("youtube_video_id", v.youtube_video_id).order("taken_at", { ascending: false }).limit(2).returns<Record<string, unknown>[]>(), "De statistieken");
    const latest = snaps?.[0];
    if (!latest) return { video: videoLabel(v), note: "Nog geen cijfers opgehaald (YouTube koppelen of even wachten)." };
    const ageH = latest.published_at ? (Date.now() - Date.parse(String(latest.published_at))) / 3_600_000 : null;
    return { video: videoLabel(v), latest: { ...latest, retention: Array.isArray(latest.retention) ? `${(latest.retention as unknown[]).length} meetpunten` : null }, previous: snaps?.[1] ?? null, reliability: ageH !== null && ageH < 48 ? "Minder dan 48 uur online: te vroeg voor conclusies." : Number(latest.views) < 100 ? "Minder dan 100 weergaven: te weinig voor betrouwbare conclusies." : "Genoeg data voor een voorzichtige conclusie." };
  }
  const ch = requireChannel(env);
  const [snap, vids] = await Promise.all([
    env.db.from("yt_channel_snapshots").select("taken_at, subscribers, views_total, videos_total, views_7d, views_28d, watch_minutes_28d, subscribers_gained_28d, analytics_until, analytics_error").eq("studio_id", env.studioId).eq("channel_id", ch.id).order("taken_at", { ascending: false }).limit(1).maybeSingle<Record<string, unknown>>(),
    env.db.from("yt_video_snapshots").select("youtube_video_id, title, published_at, views, avg_view_pct, taken_at").eq("studio_id", env.studioId).eq("channel_id", ch.id).order("taken_at", { ascending: false }).limit(60).returns<{ youtube_video_id: string; title: string | null; published_at: string | null; views: number; avg_view_pct: number | null }[]>(),
  ]);
  const seen = new Set<string>();
  const latestPerVideo = (vids.data ?? []).filter((v) => !seen.has(v.youtube_video_id) && seen.add(v.youtube_video_id)).slice(0, 15);
  if (!snap.data && !latestPerVideo.length) return { channel: ch.name, note: "Nog geen cijfers voor dit kanaal (YouTube niet gekoppeld of nog niet opgehaald)." };
  return { channel: ch.name, channel_numbers: snap.data, videos: latestPerVideo, reliability: latestPerVideo.length < 5 ? "Weinig video's: patronen zijn nog niet betrouwbaar." : "Vergelijk alleen video's van dezelfde soort (Short met Short)." };
}

async function listTasks(env: ToolEnv, a: { active_only?: boolean }) {
  let q = env.db.from("yt_jobs").select(JOB_COLUMNS).eq("studio_id", env.studioId).neq("step", "assistant");
  if (env.project?.kind === "video") q = q.eq("video_id", env.project.id);
  else if (env.project?.kind === "recording") q = q.eq("recording_id", env.project.id);
  else if (env.channel) q = q.or(`channel_id.eq.${env.channel.id},channel_id.is.null`);
  if (a.active_only) q = q.in("status", ["queued", "running"]);
  const yt = env.project?.kind === "episode" ? [] : (must(await q.order("created_at", { ascending: false }).limit(12).returns<JobRow[]>(), "De wachtrij") ?? []);
  let dn: JobRow[] = [];
  if (env.dreamnest && (env.project?.kind === "episode" || (env.channel && channelKind(env.channel) === "dreamnest"))) {
    let d = env.db.from("dn_render_jobs").select("id, step, status, error, progress, created_at, started_at, finished_at, episode_id").eq("studio_id", env.studioId);
    if (env.project?.kind === "episode") d = d.eq("episode_id", env.project.id);
    if (a.active_only) d = d.in("status", ["queued", "running"]);
    dn = must(await d.order("created_at", { ascending: false }).limit(12).returns<JobRow[]>(), "De Dreamnest-wachtrij") ?? [];
  }
  const all = [...yt.map((j) => ({ j, queue: "yt" as const })), ...dn.map((j) => ({ j, queue: "dn" as const }))];
  for (const { j, queue } of all.filter((x) => x.j.status === "queued" || x.j.status === "running").slice(0, 4)) taskCard(env, j.id, taskView(j, queue).name, queue);
  return all.map(({ j, queue }) => {
    const t = taskView(j, queue);
    return { id: j.id, queue, name: t.name, status: t.status, now: t.statusLabel, percent: t.percent, started: j.started_at ?? null, finished: j.finished_at ?? null, error: t.error };
  });
}

// ---------- drafts ----------

async function saveIdea(env: ToolEnv, a: { title: string; premise: string; opening?: string; source_material?: string; shorts?: string[] }) {
  const ch = requireChannel(env);
  const row = must(
    await env.db.from("ivar_ideas").insert({ studio_id: env.studioId, channel_id: ch.id, conversation_id: env.conversationId, title: a.title, premise: a.premise, opening: a.opening ?? "", source_material: a.source_material ?? "", shorts: a.shorts ?? [] }).select("id").single<{ id: string }>(),
    "Het idee",
  );
  env.cards.push({ type: "concept", ideaId: row.id, channelId: ch.id, channelKind: channelKind(ch), title: a.title, premise: a.premise, opening: a.opening ?? "", sourceMaterial: a.source_material ?? "", shorts: a.shorts ?? [] });
  return { saved: true, idea_id: row.id, note: "Opgeslagen als idee (geen opdracht)." };
}

/** Where a title change lands: the publication draft if there is one, else the working title of the video. */
async function titleTarget(env: ToolEnv, v: VideoRow): Promise<{ target: "publication" | "video"; id: string; current: string }> {
  if (v.youtube_video_id) fail("Deze video staat al op YouTube; Ivar wijzigt daar niets aan.");
  const pub = await publication(env, v.id);
  if (pub && pub.status !== "draft") fail("De publicatie van deze video is al onderweg; het concept kan niet meer worden gewijzigd.");
  if (pub) return { target: "publication", id: pub.id, current: pub.title };
  return { target: "video", id: v.id, current: v.title ?? "" };
}

async function proposeTitles(env: ToolEnv, a: { video_id: string; options: { title: string; why: string }[] }) {
  const v = await video(env, a.video_id);
  const t = await titleTarget(env, v);
  const groupId = randomUUID();
  const rows = a.options.map((o) => ({ studio_id: env.studioId, channel_id: v.channel_id, video_id: v.id, target: t.target, target_id: t.id, field: "title", before_value: t.current, after_value: o.title.replace(/[<>]/g, ""), note: o.why, group_id: groupId, status: "proposed", conversation_id: env.conversationId }));
  const saved = must(await env.db.from("ivar_revisions").insert(rows).select("id, after_value, note").returns<{ id: string; after_value: string; note: string }[]>(), "De titelvoorstellen");
  env.cards.push({ type: "titles", videoId: v.id, groupId, target: t.target, options: (saved ?? []).map((r) => ({ revisionId: r.id, title: r.after_value, why: r.note })) });
  return { proposed: saved?.length ?? 0, current_title: t.current, applied: false, note: "Nog niets gewijzigd: Milan kiest met 'Als concept toepassen'." };
}

/** Applies a revision as the worker (the RPC needs a logged-in admin): only on the version Ivar read. */
async function applyAsWorker(env: ToolEnv, r: { id: string; target: "publication" | "video"; target_id: string; field: "title" | "description" | "tags"; before_value: unknown; after_value: unknown }) {
  const table = r.target === "publication" ? "yt_publications" : "yt_videos";
  const now = must(await env.db.from(table).select(r.field).eq("id", r.target_id).eq("studio_id", env.studioId).maybeSingle<Record<string, unknown>>(), "Het concept");
  const current = r.target === "video" ? (now?.title ?? "") : now?.[r.field];
  if (!now || JSON.stringify(current) !== JSON.stringify(r.before_value)) fail("Het concept is intussen gewijzigd; er is niets overschreven. Vraag een nieuw voorstel op de huidige versie.");
  let q = env.db.from(table).update({ [r.field]: r.target === "video" && r.after_value === "" ? null : r.after_value }).eq("id", r.target_id).eq("studio_id", env.studioId);
  q = r.target === "publication" ? q.eq("status", "draft") : q.is("youtube_video_id", null);
  const res = await q.select("id").returns<{ id: string }[]>();
  if (res.error) fail(`Wijziging niet opgeslagen: ${res.error.message}`);
  if (!res.data?.length) fail("Het concept is intussen gewijzigd of kan niet meer worden aangepast; er is niets overschreven.");
  must(await env.db.from("ivar_revisions").update({ status: "applied", applied_at: new Date().toISOString() }).eq("id", r.id), "Het voorstel");
}

async function updateMetadata(env: ToolEnv, a: { video_id: string; title?: string; description?: string; tags?: string[]; apply: boolean; note?: string }) {
  const v = await video(env, a.video_id);
  if (v.youtube_video_id) fail("Deze video staat al op YouTube; Ivar wijzigt daar niets aan.");
  if (a.title === undefined && a.description === undefined && a.tags === undefined) fail("Geef een nieuwe titel, beschrijving of tags.");
  let pub = await publication(env, v.id);
  if (!pub && (a.description !== undefined || a.tags !== undefined)) {
    if (!["approved", "scheduled"].includes(v.status)) fail("Een beschrijving en tags horen bij het publicatieconcept, en dat bestaat pas als de video is goedgekeurd (Klaar voor YouTube). Een werktitel kan wel.");
    const script = await latestScript(env, v.id, true);
    must(await env.db.from("yt_publications").insert({ studio_id: env.studioId, channel_id: v.channel_id, video_id: v.id, title: (v.title || script?.titles?.[0] || "").slice(0, 100), language: script?.language ?? "en" }).select("id").single(), "Het publicatieconcept");
    pub = await publication(env, v.id);
  }
  if (pub && pub.status !== "draft") fail("De publicatie van deze video is al onderweg; het concept kan niet meer worden gewijzigd.");
  const clean = (s: string) => s.replace(/[<>]/g, "");
  const changes: { field: "title" | "description" | "tags"; before: unknown; after: unknown; target: "publication" | "video"; id: string }[] = [];
  if (a.title !== undefined) changes.push(pub ? { field: "title", before: pub.title, after: clean(a.title), target: "publication", id: pub.id } : { field: "title", before: v.title ?? "", after: clean(a.title), target: "video", id: v.id });
  if (a.description !== undefined && pub) changes.push({ field: "description", before: pub.description, after: clean(a.description), target: "publication", id: pub.id });
  if (a.tags !== undefined && pub) changes.push({ field: "tags", before: pub.tags, after: [...new Set(a.tags.map((t) => clean(t).trim()).filter(Boolean))], target: "publication", id: pub.id });
  const real = changes.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
  if (!real.length) return { changed: 0, note: "Het concept is al zo." };
  const saved = must(
    await env.db.from("ivar_revisions").insert(real.map((c) => ({ studio_id: env.studioId, channel_id: v.channel_id, video_id: v.id, target: c.target, target_id: c.id, field: c.field, before_value: c.before, after_value: c.after, note: a.note ?? null, status: "proposed", conversation_id: env.conversationId }))).select("id, target, target_id, field, before_value, after_value").returns<{ id: string; target: "publication" | "video"; target_id: string; field: "title" | "description" | "tags"; before_value: unknown; after_value: unknown }[]>(),
    "Het voorstel",
  ) ?? [];
  if (a.apply) for (const r of saved) await applyAsWorker(env, r);
  env.cards.push({ type: "metadata", videoId: v.id, changes: saved.map((r) => ({ revisionId: r.id, field: r.field, before: r.before_value, after: r.after_value })), applied: a.apply, note: a.note ?? null });
  return { changed: saved.length, applied: a.apply, fields: saved.map((r) => r.field), note: a.apply ? "Toegepast als concept (terug te draaien). Niet gepubliceerd." : "Voorstel klaargezet; nog niets gewijzigd." };
}

async function newScriptVersion(env: ToolEnv, base: ScriptRow, changes: Partial<Pick<ScriptRow, "lines" | "edit_plan" | "target_ms">>): Promise<{ id: string; version: number }> {
  const max = must(await env.db.from("yt_scripts").select("version").eq("video_id", base.video_id).order("version", { ascending: false }).limit(1).single<{ version: number }>(), "De scriptversie");
  const lines = changes.lines ?? base.lines;
  const row: Record<string, unknown> = {
    studio_id: env.studioId,
    video_id: base.video_id,
    channel_id: base.channel_id ?? env.channel?.id ?? null,
    version: max.version + 1,
    language: base.language,
    top_line: base.top_line,
    hook: (lines[0]?.text || base.hook).slice(0, 300),
    lines,
    edit_plan: changes.edit_plan ?? base.edit_plan,
    target_ms: Math.max(1, Math.round(changes.target_ms ?? base.target_ms)),
    source: "ai",
    model: "ivar",
    status: "draft",
    is_test: base.is_test,
    ...(Array.isArray(base.titles) ? { titles: base.titles } : {}),
    ...(Array.isArray(base.hooks) ? { hooks: base.hooks, chosen_hook: base.chosen_hook ?? null } : {}),
  };
  return must(await env.db.from("yt_scripts").insert(row).select("id, version").single<{ id: string; version: number }>(), "De nieuwe scriptversie");
}

async function saveVoiceover(env: ToolEnv, a: { video_id: string; lines: { index: number; text: string }[]; note: string }) {
  const v = await video(env, a.video_id);
  const base = (await latestScript(env, v.id)) ?? fail("Er is nog geen script voor deze video.");
  const r = replaceLines(base!.lines, a.lines);
  if ("error" in r) fail(r.error);
  const ok = r as { lines: ScriptLine[]; changed: number };
  if (!ok.changed) return { changed: 0, note: "De tekst was al zo; geen nieuwe versie gemaakt." };
  // Opening lines may have been chosen as hook; a changed text gets a new version that Milan approves.
  const made = await newScriptVersion(env, base!, { lines: ok.lines });
  env.cards.push({ type: "script", videoId: v.id, scriptId: made.id, version: made.version, changed: ok.changed, note: a.note });
  return { new_version: made.version, previous_version: base!.version, changed_lines: ok.changed, status: "concept (Milan keurt goed bij Actie nodig)" };
}

async function proposeEdit(env: ToolEnv, a: { video_id: string; cuts: { from_ms: number; to_ms: number }[]; note: string }) {
  const v = await video(env, a.video_id);
  const base = (await latestScript(env, v.id, true)) ?? (await latestScript(env, v.id)) ?? fail("Er is nog geen script met montageplan voor deze video.");
  const r = applyCuts(base!.edit_plan, base!.lines, a.cuts);
  if ("error" in r) fail(r.error);
  const ok = r as Exclude<typeof r, { error: string }>;
  const made = await newScriptVersion(env, base!, { edit_plan: ok.segments, lines: ok.lines, target_ms: base!.target_ms - ok.removedMs });
  env.cards.push({ type: "edit", videoId: v.id, scriptId: made.id, version: made.version, removedMs: ok.removedMs, cuts: a.cuts.map((c) => [c.from_ms, c.to_ms]), note: a.note });
  return { new_version: made.version, based_on_version: base!.version, removed: formatTimecode(ok.removedMs), status: "concept: Milan keurt goed, daarna de montage. Bron en vorige versies blijven." };
}

async function showAnalysis(env: ToolEnv, a: { video_id?: string; project_label: string; whole_video: boolean; audio_analysed: boolean; sources: string[]; observations: { at_ms?: number; text: string }[]; priorities?: { at_ms?: number; text: string }[]; uncertain?: string[] }) {
  if (a.video_id) await video(env, a.video_id);
  env.cards.push({
    type: "analysis",
    projectLabel: a.project_label,
    videoId: a.video_id ?? null,
    sources: { wholeVideo: a.whole_video, audioAnalysed: a.audio_analysed, data: a.sources },
    observations: a.observations.map((o) => ({ atMs: o.at_ms ?? null, text: o.text })),
    priorities: (a.priorities ?? []).map((o) => ({ atMs: o.at_ms ?? null, text: o.text })),
    uncertain: a.uncertain ?? [],
  });
  return { shown: true };
}

async function saveMemory(env: ToolEnv, a: { content: string; scope: "studio" | "channel" | "project"; confirmed: boolean }) {
  if (a.scope !== "studio") requireChannel(env);
  if (a.scope === "project" && !env.project) fail("Er is geen project geopend; kies studio of kanaal.");
  const where = { channel_id: a.scope === "studio" ? null : env.channel!.id, project_kind: a.scope === "project" ? env.project!.kind : null, project_id: a.scope === "project" ? env.project!.id : null };
  if (a.confirmed && asksToRemember(env.userText)) {
    must(await env.db.from("ivar_memory").insert({ studio_id: env.studioId, ...where, content: a.content, source: "ivar" }).select("id").single(), "Het geheugen");
    env.cards.push({ type: "memory", content: a.content, channelId: where.channel_id, projectKind: where.project_kind, projectId: where.project_id, question: "", saved: true });
    return { saved: true, scope: a.scope };
  }
  const where2 = a.scope === "studio" ? "de hele studio" : a.scope === "channel" ? `het hele kanaal ${env.channel!.name}` : "dit project";
  env.cards.push({ type: "memory", content: a.content, channelId: where.channel_id, projectKind: where.project_kind, projectId: where.project_id, question: `Onthouden voor ${where2}?`, saved: false });
  return { saved: false, note: "Gevraagd aan Milan; pas na zijn klik opgeslagen." };
}

// ---------- jobs ----------

async function startAnalysis(env: ToolEnv, a: { recording_id: string; mode: "first" | "again" | "series" }) {
  const r = await recording(env, a.recording_id);
  if (r.status !== "ready") fail(`Deze opname is nog niet klaar voor analyse (status: ${r.status}).`);
  const running = await activeJob(env, "recording_id", r.id, "analyse");
  if (running) {
    taskCard(env, running.id, "Media analyseren");
    return { started: false, already_running: true, job_id: running.id };
  }
  const minute = new Date().toISOString().slice(0, 16);
  const key = a.mode === "first" ? `analyse:${r.id}` : a.mode === "again" ? `analyse:${r.id}:again:${minute}` : `analyse:${r.id}:parts:${minute}`;
  if (a.mode === "first") {
    const done = must(await env.db.from("yt_jobs").select("id, status").eq("studio_id", env.studioId).eq("idempotency_key", key).maybeSingle<{ id: string; status: string }>(), "De analyse");
    if (done?.status === "done") return { started: false, note: "Deze opname is al geanalyseerd. Gebruik mode 'again' voor een nieuwe analyse (kost opnieuw)." };
  }
  if (a.mode === "series" && (r.duration_ms ?? 0) < 15 * 60_000) fail("In delen vertellen kan vanaf een opname van 15 minuten.");
  if (r.is_test) {
    const job = await queueJob(env, { recording_id: r.id, step: "analyse", idempotency_key: key, ...(a.mode === "series" ? { payload: { replan: true } } : {}) });
    taskCard(env, job.id, "Media analyseren (testdata, gratis)");
    return { started: !job.existed, job_id: job.id, cost: "gratis (testdata)" };
  }
  if (!(await paidEnabled(env))) return { started: false, blocked: "Betaalde verwerking staat uit (Instellingen > Analyse). Zet die eerst aan met een maandplafond." };
  const cents = a.mode === "series" ? Math.max(1, Math.ceil((r.duration_ms ?? 0) / SERIES_PART_MS)) : estimateAnalysisCents(r.duration_ms ?? 0);
  const label = a.mode === "series" ? `Vertel "${r.label}" in delen` : a.mode === "again" ? `Analyseer "${r.label}" opnieuw` : `Analyseer "${r.label}"`;
  env.cards.push({ type: "confirm", action: a.mode === "series" ? "series" : a.mode === "again" ? "analyse_again" : "analyse", targetId: r.id, label, text: a.mode === "series" ? "Plant de delen uit de opgeslagen momenten en schrijft per deel een script (Gemini)." : `Gemini bekijkt de hele opname (${r.duration_ms ? formatTimecode(r.duration_ms) : "?"}) en zoekt de momenten.`, estimateCents: cents, estimate: true });
  return { started: false, needs_confirmation: true, estimate_cents: cents, note: "Kostenkaart getoond; de stap start pas na Milans klik (binnen het maandplafond)." };
}

async function startRender(env: ToolEnv, a: { video_id: string }) {
  const v = await video(env, a.video_id);
  if (v.youtube_video_id) fail("Deze video staat al op YouTube.");
  const running = await activeJob(env, "video_id", v.id, "render");
  if (running) {
    taskCard(env, running.id, "Montage renderen");
    return { started: false, already_running: true, job_id: running.id };
  }
  const script = await latestScript(env, v.id, true);
  if (!script) fail("Er is nog geen goedgekeurd script. Keur eerst een script goed bij Actie nodig.");
  // One montage per answer of Ivar: a retried answer finds the same step instead of rendering twice.
  const job = await queueJob(env, { video_id: v.id, step: "render", idempotency_key: `render:${script!.id}:ivar-${env.replyId}`, payload: { script_id: script!.id } });
  const status = await env.db.from("yt_videos").update({ status: "rendering" }).eq("id", v.id).in("status", ["idea", "scripted", "review", "approved"]);
  if (status.error) fail(`Montage staat in de wachtrij, maar de videostatus is niet bijgewerkt: ${status.error.message}`);
  taskCard(env, job.id, `Montage renderen: ${videoLabel(v, script!.titles?.[0])}`);
  return { started: !job.existed, job_id: job.id, script_version: script!.version, cost: "gratis (FFmpeg op de pc; stem binnen het gratis deel)" };
}

async function startQuality(env: ToolEnv, a: { video_id: string }) {
  const v = await video(env, a.video_id);
  const render = await latestRender(env, v.id);
  if (!render) fail("Er is nog geen montage om te controleren.");
  const running = await activeJob(env, "video_id", v.id, "viral");
  if (running) {
    taskCard(env, running.id, "Kwaliteit controleren");
    return { started: false, already_running: true, job_id: running.id };
  }
  if (v.is_test || !(await paidEnabled(env))) {
    const job = await queueJob(env, { video_id: v.id, step: "viral", idempotency_key: `viral:ivar:${v.id}:${env.replyId}`, max_attempts: 2 });
    taskCard(env, job.id, "Kwaliteit controleren");
    return { started: !job.existed, job_id: job.id, cost: "gratis (alleen regels op meetwaarden; audio wordt niet beluisterd)" };
  }
  env.cards.push({ type: "confirm", action: "quality", targetId: v.id, label: `Controleer "${videoLabel(v)}"`, text: "Regels op meetwaarden (gratis) plus een korte luisterbeurt van de voice-over door Gemini.", estimateCents: 1, estimate: true });
  return { started: false, needs_confirmation: true, estimate_cents: 1 };
}

async function shortsFrom(env: ToolEnv, a: { recording_id: string; count?: number }) {
  const r = await recording(env, a.recording_id);
  const shorts = must(await env.db.from("yt_videos").select(VIDEO_COLUMNS).eq("recording_id", r.id).eq("studio_id", env.studioId).in("format", ["A", "B"]).neq("status", "archived").order("created_at").returns<VideoRow[]>(), "De Shorts") ?? [];
  if (!shorts.length) {
    const analysed = must(await env.db.from("yt_moments").select("id").eq("recording_id", r.id).eq("studio_id", env.studioId).limit(1).returns<{ id: string }[]>(), "De momenten");
    if (analysed?.length) return { shorts: [], note: "De analyse vond geen momenten die sterk genoeg zijn voor een Short (context en afloop nodig). Ivar maakt geen Shorts van zwakke stukken." };
    const r2 = await startAnalysis(env, { recording_id: r.id, mode: "first" });
    return { shorts: [], note: "Nog niet geanalyseerd: de analyse zoekt de momenten en plant de Shorts automatisch.", analysis: r2 };
  }
  const want = a.count ?? shorts.length;
  return {
    shorts: shorts.slice(0, want).map((s) => ({ id: s.id, label: videoLabel(s), status: s.status })),
    available: shorts.length,
    note: shorts.length < want ? `Er zijn maar ${shorts.length} geschikte Shortmomenten gevonden, niet ${want}.` : "Deze Shorts zijn gepland uit de sterkste momenten. Scripts worden automatisch geschreven; keur ze goed en start de montage per Short.",
  };
}

async function cancelTask(env: ToolEnv, a: { job_id: string; queue: "yt" | "dn" }) {
  if (a.queue === "dn") {
    if (!env.dreamnest) fail("Dreamnest staat uit op deze pc.");
    const j = must(await env.db.from("dn_render_jobs").select("id, status, step, episode_id").eq("id", a.job_id).eq("studio_id", env.studioId).maybeSingle<{ id: string; status: string; step: string; episode_id: string }>(), "De stap");
    if (!j) fail("Deze stap bestaat niet in deze studio.");
    if (j!.status === "running") fail("Een lopende Dreamnest-stap kan niet halverwege stoppen; hij rondt eerst af.");
    if (j!.status !== "queued") return { cancelled: false, status: j!.status };
    must(await env.db.from("dn_render_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", j!.id).eq("status", "queued"), "Annuleren");
    return { cancelled: true };
  }
  const j = must(await env.db.from("yt_jobs").select("id, status, step, video_id, recording_id, channel_id").eq("id", a.job_id).eq("studio_id", env.studioId).maybeSingle<{ id: string; status: string; step: string; video_id: string | null; recording_id: string | null; channel_id: string | null }>(), "De stap");
  if (!j) fail("Deze stap bestaat niet in deze studio.");
  if (j!.step === "assistant") fail("Een antwoord van Ivar stop je met de stopknop in de chat.");
  if (j!.video_id) await video(env, j!.video_id);
  else if (j!.recording_id) await recording(env, j!.recording_id);
  if (j!.status === "queued") {
    must(await env.db.from("yt_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", j!.id).eq("status", "queued"), "Annuleren");
    taskCard(env, j!.id, "Geannuleerd");
    return { cancelled: true };
  }
  if (j!.status === "running") {
    must(await env.db.from("yt_jobs").update({ cancel_requested: true }).eq("id", j!.id).eq("status", "running"), "Annuleren");
    taskCard(env, j!.id, "Wordt geannuleerd");
    return { cancel_requested: true, note: "De werker stopt de stap zo snel mogelijk." };
  }
  return { cancelled: false, status: j!.status, note: "Deze stap loopt niet meer." };
}

async function retryTask(env: ToolEnv, a: { job_id: string }) {
  const j = must(await env.db.from("yt_jobs").select("id, status, step, video_id, recording_id").eq("id", a.job_id).eq("studio_id", env.studioId).maybeSingle<{ id: string; status: string; step: string; video_id: string | null; recording_id: string | null }>(), "De stap");
  if (!j) fail("Deze stap bestaat niet in deze studio.");
  if (["assistant", "upload", "publish"].includes(j!.step)) fail("Deze stap kan Ivar niet opnieuw starten (uploaden en publiceren blijven jouw klik).");
  if (j!.video_id) await video(env, j!.video_id);
  else if (j!.recording_id) await recording(env, j!.recording_id);
  if (!["failed", "cancelled"].includes(j!.status)) return { retried: false, status: j!.status, note: "Alleen een mislukte of geannuleerde stap kan opnieuw." };
  must(await env.db.from("yt_jobs").update({ status: "queued", attempts: 0, error: null, locked_by: null, locked_at: null, started_at: null, finished_at: null, cancel_requested: false }).eq("id", j!.id).in("status", ["failed", "cancelled"]), "Opnieuw proberen");
  env.poke?.();
  taskCard(env, j!.id, "Opnieuw geprobeerd");
  return { retried: true, note: "Dezelfde stap opnieuw: geen tweede kostenreservering." };
}

async function preparePublish(env: ToolEnv, a: { video_id: string }) {
  const v = await video(env, a.video_id);
  const ch = env.channel ?? must(await env.db.from("yt_channels").select(CHANNEL_COLUMNS).eq("id", v.channel_id ?? "").maybeSingle<ChannelRow>(), "Het kanaal");
  const [pub, render] = await Promise.all([publication(env, v.id), latestRender(env, v.id)]);
  const problems: string[] = [];
  if (v.youtube_video_id) problems.push("Deze video staat al op YouTube.");
  if (!["approved", "scheduled"].includes(v.status)) problems.push("De video is nog niet goedgekeurd in de controle.");
  if (!render) problems.push("Er is nog geen montage.");
  if (!pub) problems.push("Er is nog geen publicatieconcept (titel, beschrijving).");
  else if (!pub.title.trim()) problems.push("De titel is leeg.");
  if (ch && !ch.youtube_channel_id) problems.push(`Kanaal ${ch.name} is nog niet aan YouTube gekoppeld.`);
  env.cards.push({ type: "publish", videoId: v.id, channelName: ch?.name ?? "?", fileName: render?.file_name ?? null, visibility: pub?.visibility ?? "private", publishAt: pub?.publish_at ?? null, problems });
  return { ready: problems.length === 0, problems, note: "Ivar publiceert niet zelf. Milan controleert en klikt in het publicatiescherm." };
}

// ---------- wider view ----------

async function overview(env: ToolEnv) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const [chans, vids, recs, failed, pubs, moments] = await Promise.all([
    env.db.from("yt_channels").select(CHANNEL_COLUMNS).eq("studio_id", env.studioId).returns<ChannelRow[]>(),
    env.db.from("yt_videos").select("id, channel_id, status, youtube_video_id").eq("studio_id", env.studioId).neq("status", "archived").limit(2000).returns<{ id: string; channel_id: string | null; status: string; youtube_video_id: string | null }[]>(),
    env.db.from("yt_recordings").select("id, channel_id, status, label").eq("studio_id", env.studioId).eq("status", "ready").limit(500).returns<{ id: string; channel_id: string | null; status: string; label: string }[]>(),
    env.db.from("yt_jobs").select("id, step, error").eq("studio_id", env.studioId).eq("status", "failed").neq("step", "assistant").gte("created_at", since).limit(20).returns<{ id: string; step: string; error: string | null }[]>(),
    env.db.from("yt_publications").select("title, status, publish_at, channel_id").eq("studio_id", env.studioId).in("status", ["queued", "uploading", "processing", "uploaded", "scheduled"]).lte("publish_at", soon).limit(30).returns<{ title: string; status: string; publish_at: string | null; channel_id: string }[]>(),
    env.db.from("yt_moments").select("recording_id").eq("studio_id", env.studioId).limit(5000).returns<{ recording_id: string }[]>(),
  ]);
  const analysed = new Set((moments.data ?? []).map((m) => m.recording_id));
  const list = (must(chans, "De kanalen") ?? []).filter((c) => !env.channel || c.id === env.channel.id);
  const per = list.map((c) => {
    const mine = (vids.data ?? []).filter((v) => v.channel_id === c.id);
    const count = (s: string[]) => mine.filter((v) => s.includes(v.status)).length;
    return {
      channel: c.is_default ? "KIVOXEL" : c.name,
      te_keuren: count(["scripted", "review"]),
      montage_bezig: count(["rendering"]),
      klaar_voor_youtube: count(["approved"]),
      ingepland: count(["scheduled"]),
      live: mine.filter((v) => v.youtube_video_id).length,
      mislukt: count(["failed"]),
      opnames_zonder_analyse: (recs.data ?? []).filter((r) => r.channel_id === c.id && !analysed.has(r.id)).map((r) => r.label).slice(0, 10),
      komende_week: (pubs.data ?? []).filter((p) => p.channel_id === c.id).map((p) => ({ title: p.title, status: p.status, at: p.publish_at })),
    };
  });
  return { channels: per, failed_steps_last_week: (failed.data ?? []).map((j) => ({ id: j.id, step: j.step, error: j.error })) };
}

async function costs(env: ToolEnv) {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [settings, rows] = await Promise.all([
    env.db.from("yt_settings").select("paid_processing_enabled, monthly_cap_cents").eq("studio_id", env.studioId).maybeSingle<{ paid_processing_enabled: boolean; monthly_cap_cents: number }>(),
    env.db.from("yt_costs").select("amount_cents, category, service, is_estimate, currency").eq("studio_id", env.studioId).gte("incurred_on", month).limit(5000).returns<{ amount_cents: number; category: string; service: string; is_estimate: boolean; currency: string }[]>(),
  ]);
  const eur = (rows.data ?? []).filter((r) => r.currency === "EUR");
  const sum = (f: (r: (typeof eur)[number]) => boolean) => eur.filter(f).reduce((s, r) => s + r.amount_cents, 0);
  const total = sum(() => true);
  const cap = settings.data?.monthly_cap_cents ?? 0;
  return {
    month,
    paid_processing: settings.data?.paid_processing_enabled === true,
    cap_cents: cap,
    spent_cents: total,
    left_cents: Math.max(0, cap - total),
    ivar_cents: sum((r) => /Ivar/.test(r.service)),
    analysis_other_cents: sum((r) => r.category === "analysis" && !/Ivar/.test(r.service)),
    other_cents: sum((r) => r.category !== "analysis"),
    still_estimates: eur.filter((r) => r.is_estimate).length,
    note: "Bedragen in eurocenten. Schattingen worden na de stap vervangen door het echte bedrag.",
  };
}

async function schedule(env: ToolEnv, a: { days?: number }) {
  const until = new Date(Date.now() + (a.days ?? 14) * 86_400_000).toISOString();
  let q = env.db.from("yt_publications").select("title, status, visibility, publish_at, channel_id").eq("studio_id", env.studioId).not("publish_at", "is", null).lte("publish_at", until).neq("status", "draft");
  if (env.channel) q = q.eq("channel_id", env.channel.id);
  const pubs = must(await q.order("publish_at").limit(40).returns<{ title: string; status: string; visibility: string; publish_at: string; channel_id: string }[]>(), "De planning") ?? [];
  let dn: unknown[] = [];
  if (env.dreamnest) {
    let d = env.db.from("dn_publications").select("title, status, kind, publish_at, channel_id").eq("studio_id", env.studioId).not("publish_at", "is", null).lte("publish_at", until);
    if (env.channel) d = d.eq("channel_id", env.channel.id);
    dn = (await d.order("publish_at").limit(40).returns<unknown[]>()).data ?? [];
  }
  const slots = env.channel ? ((await env.db.from("yt_channels").select("publish_slots").eq("id", env.channel.id).maybeSingle<{ publish_slots: string[] | null }>()).data?.publish_slots ?? []) : [];
  return { kivoxel: pubs, dreamnest: dn, fixed_times: slots, note: pubs.length + dn.length ? null : "Er staat in deze periode niets gepland." };
}

async function listIdeas(env: ToolEnv, a: { status?: string }) {
  const ch = requireChannel(env);
  let q = env.db.from("ivar_ideas").select("id, title, premise, status, created_at").eq("studio_id", env.studioId).eq("channel_id", ch.id);
  if (a.status) q = q.eq("status", a.status);
  return (must(await q.order("created_at", { ascending: false }).limit(25).returns<{ id: string; title: string; premise: string; status: string; created_at: string }[]>(), "De ideeën") ?? []).map((i) => ({ ...i, premise: i.premise.slice(0, 200) }));
}

async function getInsights(env: ToolEnv, a: { kind?: string }) {
  const ch = requireChannel(env);
  let q = env.db.from("ivar_insights").select("id, kind, title, body, suggestion, evidence, confidence, status, week").eq("studio_id", env.studioId).eq("channel_id", ch.id).neq("status", "dismissed");
  if (a.kind) q = q.eq("kind", a.kind);
  const rows = must(await q.order("created_at", { ascending: false }).limit(12).returns<Record<string, unknown>[]>(), "De inzichten") ?? [];
  const last = await env.db.from("yt_jobs").select("status, finished_at, result, error").eq("studio_id", env.studioId).eq("step", "insight").eq("channel_id", ch.id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ status: string; finished_at: string | null; result: unknown; error: string | null }>();
  return { channel: ch.name, insights: rows, last_run: last.data ?? "Nog nooit gedraaid (gebeurt wekelijks vanzelf zodra betaalde verwerking aan staat)." };
}

async function refreshInsights(env: ToolEnv) {
  const ch = requireChannel(env);
  if (!(await paidEnabled(env))) return { started: false, blocked: "Betaalde verwerking staat uit (Instellingen > Analyse)." };
  const running = must(await env.db.from("yt_jobs").select("id").eq("studio_id", env.studioId).eq("step", "insight").eq("channel_id", ch.id).in("status", ["queued", "running"]).limit(1).returns<{ id: string }[]>(), "De wachtrij");
  if (running?.length) {
    taskCard(env, running[0].id, "Trends en leren");
    return { started: false, already_running: true };
  }
  env.cards.push({ type: "confirm", action: "insights", targetId: ch.id, label: `Trends en lessen voor ${ch.name}`, text: "Ivar bekijkt de referentievideo's in de niche, onze cijfers en jouw keuzes, en schrijft een paar inzichten met bewijs.", estimateCents: 2, estimate: true });
  return { started: false, needs_confirmation: true, estimate_cents: 2 };
}

async function regenerateScript(env: ToolEnv, a: { video_id: string; note: string }) {
  const v = await video(env, a.video_id);
  if (v.youtube_video_id) fail("Deze video staat al op YouTube.");
  const running = await activeJob(env, "video_id", v.id, "script");
  if (running) {
    taskCard(env, running.id, "Script schrijven");
    return { started: false, already_running: true };
  }
  const max = must(await env.db.from("yt_scripts").select("version").eq("video_id", v.id).order("version", { ascending: false }).limit(1).maybeSingle<{ version: number }>(), "De scriptversie");
  const version = (max?.version ?? 0) + 1;
  if (v.is_test) {
    const job = await queueJob(env, { video_id: v.id, step: "script", idempotency_key: `script:${v.id}:v${version}`, payload: { version, note: a.note } });
    taskCard(env, job.id, "Script schrijven (testdata, gratis)");
    return { started: !job.existed, version };
  }
  env.cards.push({ type: "confirm", action: "script", targetId: v.id, label: `Nieuw script (versie ${version}) voor "${videoLabel(v)}"`, text: `Aanwijzing: ${a.note}`, estimateCents: 1, estimate: true, note: a.note, version });
  return { started: false, needs_confirmation: true, version, estimate_cents: 1 };
}

async function approveScript(env: ToolEnv, a: { video_id: string; version?: number }) {
  const v = await video(env, a.video_id);
  if (v.youtube_video_id) fail("Deze video staat al op YouTube.");
  let q = env.db.from("yt_scripts").select("id, version, status").eq("video_id", v.id).eq("studio_id", env.studioId);
  q = a.version ? q.eq("version", a.version) : q.order("version", { ascending: false }).limit(1);
  const s = must(await q.maybeSingle<{ id: string; version: number; status: string }>(), "Het script");
  if (!s) fail(a.version ? `Versie ${a.version} bestaat niet.` : "Er is nog geen script.");
  if (s!.status === "approved") return { approved: true, version: s!.version, note: "Was al goedgekeurd." };
  must(await env.db.from("yt_scripts").update({ status: "draft" }).eq("video_id", v.id).eq("status", "approved"), "Vorige goedkeuring");
  must(await env.db.from("yt_scripts").update({ status: "approved" }).eq("id", s!.id), "Goedkeuren");
  await env.db.from("yt_videos").update({ status: "scripted" }).eq("id", v.id).in("status", ["review", "approved"]);
  return { approved: true, version: s!.version, note: "Goedgekeurd. Een bestaande montage moet opnieuw; vraag 'start de montage' als je die nu wilt." };
}

type Handler = (env: ToolEnv, args: never) => Promise<unknown>;
const HANDLERS: Record<string, Handler> = {
  list_channels: listChannels,
  list_projects: listProjects as Handler,
  get_project: getProject as Handler,
  get_channel_guidelines: guidelines,
  get_transcript: transcript as Handler,
  get_quality_report: qualityReport as Handler,
  get_analytics: analytics as Handler,
  list_tasks: listTasks as Handler,
  save_idea: saveIdea as Handler,
  propose_titles: proposeTitles as Handler,
  update_metadata_draft: updateMetadata as Handler,
  save_voiceover_text: saveVoiceover as Handler,
  propose_edit: proposeEdit as Handler,
  show_analysis: showAnalysis as Handler,
  save_memory: saveMemory as Handler,
  start_analysis: startAnalysis as Handler,
  start_render: startRender as Handler,
  start_quality_check: startQuality as Handler,
  shorts_from_recording: shortsFrom as Handler,
  cancel_task: cancelTask as Handler,
  retry_task: retryTask as Handler,
  prepare_publish: preparePublish as Handler,
  get_studio_overview: overview,
  get_costs: costs,
  get_schedule: schedule as Handler,
  list_ideas: listIdeas as Handler,
  get_insights: getInsights as Handler,
  refresh_insights: refreshInsights,
  regenerate_script: regenerateScript as Handler,
  approve_script: approveScript as Handler,
};
export const HANDLER_NAMES = Object.keys(HANDLERS);

const SUMMARY: Record<string, string> = {
  list_channels: "Kanalen bekeken",
  list_projects: "Projecten opgezocht",
  get_project: "Project bekeken",
  get_channel_guidelines: "Kanaalrichtlijnen gelezen",
  get_transcript: "Voice-overtekst gelezen",
  get_quality_report: "Kwaliteitsgegevens gelezen",
  get_analytics: "Cijfers gelezen",
  list_tasks: "Taken bekeken",
  save_idea: "Idee opgeslagen",
  propose_titles: "Titelvoorstellen klaargezet",
  update_metadata_draft: "Publicatieconcept bijgewerkt",
  save_voiceover_text: "Nieuwe versie voice-overtekst",
  propose_edit: "Editvoorstel als nieuwe versie",
  show_analysis: "Analyse getoond",
  save_memory: "Geheugen",
  start_analysis: "Analyse",
  start_render: "Montage gestart",
  start_quality_check: "Kwaliteitscontrole",
  shorts_from_recording: "Shorts uit opname",
  cancel_task: "Stap annuleren",
  retry_task: "Stap opnieuw",
  prepare_publish: "Publicatie gecontroleerd",
  get_studio_overview: "Studio-overzicht bekeken",
  get_costs: "Kosten bekeken",
  get_schedule: "Planning bekeken",
  list_ideas: "Ideeën bekeken",
  get_insights: "Inzichten gelezen",
  refresh_insights: "Trends en lessen",
  regenerate_script: "Nieuw script",
  approve_script: "Script goedgekeurd",
};
export const STATUS_NOTE: Record<string, string> = {
  list_channels: "Bekijkt de kanalen",
  list_projects: "Zoekt de projecten op",
  get_project: "Bekijkt het project",
  get_channel_guidelines: "Leest de kanaalrichtlijnen",
  get_transcript: "Leest de voice-over",
  get_quality_report: "Bekijkt de meetwaarden",
  get_analytics: "Leest de cijfers",
  list_tasks: "Kijkt naar de taken",
  start_render: "Zet de montage klaar",
  start_analysis: "Bekijkt de analyse",
  propose_edit: "Maakt een editvoorstel",
  get_studio_overview: "Bekijkt de studio",
  get_insights: "Leest de trends",
  get_costs: "Bekijkt de kosten",
  get_schedule: "Bekijkt de planning",
};

/** Runs one tool call from the model. Never throws: the model always gets a structured answer. */
export async function runTool(env: ToolEnv, name: string, rawArgs: unknown): Promise<ToolOutcome & { jobId?: string }> {
  const def = TOOL_BY_NAME[name];
  const handler = HANDLERS[name];
  let outcome: ToolOutcome & { jobId?: string };
  if (!def || !handler) {
    outcome = { ok: false, result: { error: `Ivar heeft geen functie "${name}". Zeg eerlijk dat dit niet beschikbaar is.` }, summary: `Onbekende functie ${name}` };
  } else {
    const input = validate(def.input, rawArgs);
    const allowed = toolAllowed(def.kind, env.intent);
    if (!input.ok) outcome = { ok: false, result: { error: `Ongeldige invoer: ${input.error}` }, summary: `${SUMMARY[name]}: ongeldige invoer` };
    else if (!allowed.ok) outcome = { ok: false, result: { error: allowed.why }, summary: `${SUMMARY[name]}: niet gestart (geen opdracht)` };
    else {
      const cardsBefore = env.cards.length;
      try {
        const result = await handler(env, input.value as never);
        const job = env.cards.slice(cardsBefore).find((c): c is Extract<Card, { type: "task" }> => c.type === "task");
        outcome = { ok: true, result, summary: SUMMARY[name], jobId: job?.queue === "yt" ? job.jobId : undefined };
      } catch (e) {
        env.cards.length = cardsBefore;
        const message = e instanceof ToolError ? e.message : `Er ging iets mis: ${e instanceof Error ? e.message : String(e)}`;
        outcome = { ok: false, result: { error: message }, summary: `${SUMMARY[name]}: ${message}`.slice(0, 300) };
      }
    }
  }
  const log = await env.db.from("ivar_actions").insert({
    studio_id: env.studioId,
    conversation_id: env.conversationId,
    message_id: env.replyId,
    actor: "ivar",
    tool: /^[a-z_]{2,60}$/.test(name) ? name : "unknown",
    ok: outcome.ok,
    summary: outcome.summary.slice(0, 300),
    input: JSON.stringify(rawArgs ?? {}).length <= 4000 ? (rawArgs ?? {}) : { truncated: true },
    channel_id: env.channel?.id ?? null,
    project_kind: env.project?.kind ?? null,
    project_id: env.project?.id ?? null,
    job_id: outcome.jobId ?? null,
  });
  if (log.error) outcome.summary += " (niet in het logboek gezet)";
  return outcome;
}

/** For the context of an answer: the opened project and the memory, read without a log line. */
export { getProject as readProject, memoryFor };

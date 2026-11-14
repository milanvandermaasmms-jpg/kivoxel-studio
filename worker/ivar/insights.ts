// Ivar learns and advises on his own, on this pc, also when nobody is chatting: once a week per active channel the
// worker queues the step 'insight' (yt_jobs, idempotent per ISO week). The step reads the niche (reference videos),
// our own numbers and Milan's choices, asks Gemini for a few insights with evidence and stores them in ivar_insights.
// Paid processing off or monthly cap reached: nothing is spent and the step says why. Too little data: free skip.
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents, type Usage } from "../gemini.ts";
import { insightPrompt, isoWeek, ownSignals, parseInsights, trendSignals, type Behaviour, type OwnVideo, type RefVideo } from "../../lib/ivar/insights.ts";
import { CHANNEL_COLUMNS, channelKind, type ChannelRow } from "./tools.ts";

export type JsonModel = { model: string; generateText: (prompt: string) => Promise<{ json: unknown; usage: Usage }> };
type Job = { id: string; studio_id: string; payload: Record<string, unknown> | null };

const DAY = 86_400_000;

export async function runInsight(db: SupabaseClient, model: JsonModel | null, job: Job, now = Date.now()): Promise<Record<string, unknown>> {
  const channelId = typeof job.payload?.channel_id === "string" ? job.payload.channel_id : "";
  const ch = await db.from("yt_channels").select(CHANNEL_COLUMNS).eq("id", channelId).eq("studio_id", job.studio_id).maybeSingle<ChannelRow>();
  if (!ch.data) throw new Error("Kanaal niet gevonden in deze studio");
  const channel = { ...ch.data, name: ch.data.is_default ? "KIVOXEL" : ch.data.name };
  const kind = channelKind(channel);
  const week = isoWeek(new Date(now));
  const since = new Date(now - 60 * DAY).toISOString();

  const [refs, snaps, revs, ideas, notes, memory, previous] = await Promise.all([
    db.from("yt_reference_videos").select("title, tags, duration_s, is_short, published_at, views, ratio, query").eq("studio_id", job.studio_id).eq("channel_id", channelId).limit(120).returns<RefVideo[]>(),
    db.from("yt_video_snapshots").select("youtube_video_id, title, duration_s, views, avg_view_pct, published_at, taken_at").eq("studio_id", job.studio_id).eq("channel_id", channelId).order("taken_at", { ascending: false }).limit(200).returns<{ youtube_video_id: string; title: string | null; duration_s: number | null; views: number; avg_view_pct: number | null; published_at: string | null }[]>(),
    db.from("ivar_revisions").select("after_value, status, field").eq("studio_id", job.studio_id).eq("channel_id", channelId).eq("field", "title").gte("created_at", since).in("status", ["applied", "reverted"]).limit(60).returns<{ after_value: unknown; status: string }[]>(),
    db.from("ivar_ideas").select("title, status").eq("studio_id", job.studio_id).eq("channel_id", channelId).in("status", ["project", "dropped"]).gte("updated_at", since).limit(40).returns<{ title: string; status: string }[]>(),
    db.from("yt_videos").select("review_note").eq("studio_id", job.studio_id).eq("channel_id", channelId).not("review_note", "is", null).gte("updated_at", since).limit(20).returns<{ review_note: string }[]>(),
    db.from("ivar_memory").select("content").eq("studio_id", job.studio_id).eq("channel_id", channelId).limit(40).returns<{ content: string }[]>(),
    db.from("ivar_insights").select("title").eq("studio_id", job.studio_id).eq("channel_id", channelId).gte("created_at", new Date(now - 56 * DAY).toISOString()).limit(60).returns<{ title: string }[]>(),
  ]);

  const seen = new Set<string>();
  const own: OwnVideo[] = (snaps.data ?? [])
    .filter((s) => !seen.has(s.youtube_video_id) && seen.add(s.youtube_video_id))
    .map((s) => ({ title: s.title ?? "", is_short: (s.duration_s ?? 999) <= 180, views: Number(s.views), avg_view_pct: s.avg_view_pct === null ? null : Number(s.avg_view_pct), published_at: s.published_at }));
  const behaviour: Behaviour = {
    appliedTitles: (revs.data ?? []).filter((r) => r.status === "applied").map((r) => String(r.after_value)).slice(0, 15),
    revertedTitles: (revs.data ?? []).filter((r) => r.status === "reverted").map((r) => String(r.after_value)).slice(0, 15),
    madeProjects: (ideas.data ?? []).filter((i) => i.status === "project").map((i) => i.title),
    droppedIdeas: (ideas.data ?? []).filter((i) => i.status === "dropped").map((i) => i.title),
    reviewNotes: (notes.data ?? []).map((n) => n.review_note.slice(0, 200)),
    memory: (memory.data ?? []).map((m) => m.content),
  };
  const trend = trendSignals((refs.data ?? []).map((r) => ({ ...r, views: Number(r.views), ratio: r.ratio === null ? null : Number(r.ratio), tags: r.tags ?? [] })), now);
  const ownS = ownSignals(own, now);
  const choices = behaviour.appliedTitles.length + behaviour.revertedTitles.length + behaviour.droppedIdeas.length + behaviour.madeProjects.length + behaviour.reviewNotes.length;
  if (trend.count < 5 && ownS.count < 2 && choices < 2) return { week, skipped: "Te weinig data voor inzichten (geen referentievideo's, cijfers of keuzes). Gratis overgeslagen." };
  if (!model) throw new Error("GEMINI_API_KEY ontbreekt in worker/.env.local");

  const reserved = await db.rpc("reserve_yt_cost", { p_studio: job.studio_id, p_job: job.id, p_category: "analysis", p_service: `Gemini ${model.model} (Ivar inzichten)`, p_estimate_cents: 2 });
  if (reserved.error) throw new Error(reserved.error.message);
  const previousTitles = (previous.data ?? []).map((p) => p.title);
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let list;
  try {
    const r = await model.generateText(insightPrompt({ channel: channel.name, kind, language: channel.language, trend, own: ownS, behaviour, previous: previousTitles }));
    usage = r.usage;
    list = parseInsights(r.json, previousTitles);
  } finally {
    const cents = costCents(usage);
    const cost = await db.from("yt_costs").select("id, amount_cents, is_estimate").eq("job_id", job.id).eq("category", "analysis").maybeSingle<{ id: string; amount_cents: number; is_estimate: boolean }>();
    if (cost.data) await db.from("yt_costs").update({ amount_cents: cost.data.is_estimate ? cents : cost.data.amount_cents + cents, is_estimate: false, description: `Ivar inzichten: ${usage.inputTokens} invoer- en ${usage.outputTokens} uitvoertokens` }).eq("id", cost.data.id);
  }
  if (!list.length) return { week, saved: 0, note: "Geen bruikbare inzichten met bewijs gevonden." };
  const rows = list.map((i) => ({ studio_id: job.studio_id, channel_id: channelId, kind: i.kind, title: i.title, body: i.body, suggestion: i.suggestion, evidence: i.evidence, confidence: i.confidence, week, job_id: job.id }));
  const ins = await db.from("ivar_insights").upsert(rows, { onConflict: "studio_id,channel_id,week,kind,title", ignoreDuplicates: true });
  if (ins.error) throw new Error(ins.error.message);
  return { week, saved: rows.length, kinds: rows.map((r) => r.kind) };
}

/** Once a week per active channel, only with paid processing on: one 'insight' step (the key makes it once per week). */
export async function scheduleInsights(db: SupabaseClient, log: (m: string) => void, now = Date.now()): Promise<number> {
  const week = isoWeek(new Date(now));
  const chans = await db.from("yt_channels").select("id, studio_id, status").eq("status", "active").returns<{ id: string; studio_id: string }[]>();
  if (chans.error) return 0;
  let queued = 0;
  const paid = new Map<string, boolean>();
  for (const c of chans.data ?? []) {
    if (!paid.has(c.studio_id)) {
      const s = await db.from("yt_settings").select("paid_processing_enabled").eq("studio_id", c.studio_id).maybeSingle<{ paid_processing_enabled: boolean }>();
      paid.set(c.studio_id, s.data?.paid_processing_enabled === true);
    }
    if (!paid.get(c.studio_id)) continue;
    const ins = await db.from("yt_jobs").insert({ studio_id: c.studio_id, channel_id: c.id, step: "insight", idempotency_key: `insight:${c.id}:${week}`, payload: { channel_id: c.id, week }, max_attempts: 2 }).select("id").maybeSingle();
    if (ins.error && ins.error.code !== "23505") {
      if (/check constraint|violates/i.test(ins.error.message)) return queued; // before migration 055
      log(`Ivar: inzichten niet klaargezet: ${ins.error.message}`);
    } else if (ins.data) queued++;
  }
  return queued;
}

// Statistics in the dashboard (fase E, migration 041). The worker writes snapshots; here we read the newest one and
// one from about a day earlier, so "views in the last 24 hours" comes from our own measurements (Data API, near-live)
// and not from Analytics (which lags 1-2 days).
import { friendlyError, supabase } from "../supabase";
import type { Segment } from "./analysis";
import { parseHooks } from "./hooks";
import type { Production } from "./signals";

export type ChannelSnap = {
  taken_at: string;
  subscribers: number | null;
  views_total: number;
  videos_total: number;
  views_7d: number | null;
  views_28d: number | null;
  engaged_views_28d: number | null;
  watch_minutes_28d: number | null;
  subscribers_gained_28d: number | null;
  analytics_until: string | null;
  analytics_error: string | null;
};
export type RetentionPoint = { at: number; ratio: number; relative?: number | null };
export type VideoSnap = {
  youtube_video_id: string;
  video_id: string | null;
  taken_at: string;
  title: string | null;
  published_at: string | null;
  duration_s: number | null;
  views: number;
  likes: number | null;
  comments: number | null;
  a_views: number | null;
  engaged_views: number | null;
  watch_minutes: number | null;
  avg_view_duration_s: number | null;
  avg_view_pct: number | null;
  subscribers_gained: number | null;
  retention: RetentionPoint[] | null;
  analytics_until: string | null;
};
export type VideoRow = VideoSnap & { views24h: number | null; isShort: boolean };
/** Manual numbers from YouTube Studio (migration 042); null before that migration. */
export type Manual = { youtube_video_id: string; metric: "viewed_pct"; value: number; measured_on: string };
export type StatsView = { channel: ChannelSnap | null; views24h: number | null; videos: VideoRow[]; production: Record<string, Production>; manual: Manual[] | null } | "migration";

const DAY = 86_400_000;

/** The snapshot closest to 24 hours before `at` (at least 20 hours older); null when we do not have one yet. */
export function dayEarlier<T extends { taken_at: string }>(snaps: T[], at: string): T | null {
  const target = Date.parse(at) - DAY;
  const older = snaps.filter((s) => Date.parse(s.taken_at) <= Date.parse(at) - 20 * 3_600_000);
  if (!older.length) return null;
  return older.reduce((best, s) => (Math.abs(Date.parse(s.taken_at) - target) < Math.abs(Date.parse(best.taken_at) - target) ? s : best));
}

/** Newest snapshot per video plus its growth over about a day. Shorts: up to 3 minutes (YouTube has no API flag). */
export function videoRows(snaps: VideoSnap[]): VideoRow[] {
  const byVideo = new Map<string, VideoSnap[]>();
  for (const s of snaps) byVideo.set(s.youtube_video_id, [...(byVideo.get(s.youtube_video_id) ?? []), s]);
  return [...byVideo.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
      const latest = sorted[0];
      // Analytics come with a delay and not every run asks them: take the newest snapshot that has them.
      const withAnalytics = sorted.find((s) => s.a_views !== null);
      const withCurve = sorted.find((s) => s.retention?.length);
      const before = dayEarlier(sorted, latest.taken_at);
      return {
        ...latest,
        ...(withAnalytics ? { a_views: withAnalytics.a_views, engaged_views: withAnalytics.engaged_views, watch_minutes: withAnalytics.watch_minutes, avg_view_duration_s: withAnalytics.avg_view_duration_s, avg_view_pct: withAnalytics.avg_view_pct, subscribers_gained: withAnalytics.subscribers_gained, analytics_until: withAnalytics.analytics_until } : {}),
        retention: withCurve?.retention ?? null,
        views24h: before ? Math.max(0, latest.views - before.views) : null,
        isShort: latest.duration_s !== null && latest.duration_s <= 180,
      };
    })
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

/** Engaged views as a share of views: a rough measure of how strong the opening is (2.2, 24.7). */
export const engagedShare = (v: Pick<VideoSnap, "a_views" | "engaged_views">) => (v.a_views && v.engaged_views !== null ? v.engaged_views / v.a_views : null);

/** The moment most viewers leave: the biggest drop between two points of the retention curve. */
export function biggestDrop(curve: RetentionPoint[] | null): { at: number; drop: number } | null {
  if (!curve || curve.length < 2) return null;
  let best: { at: number; drop: number } | null = null;
  for (let i = 1; i < curve.length; i++) {
    const drop = curve[i - 1].ratio - curve[i].ratio;
    if (drop > 0 && (!best || drop > best.drop)) best = { at: curve[i].at, drop };
  }
  return best;
}

/** Points for a small SVG line (width × height), the ratio clipped at 0-1.2 (rewatches can go above 1). */
export function curvePath(curve: RetentionPoint[], width: number, height: number): string {
  const max = 1.2;
  return curve.map((p, i) => `${i ? "L" : "M"}${(p.at * width).toFixed(1)},${(height - (Math.min(max, Math.max(0, p.ratio)) / max) * height).toFixed(1)}`).join(" ");
}

const isMissing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || /could not find|does not exist/i.test(e.message);

export async function loadStats(studioId: string): Promise<StatsView> {
  const since = new Date(Date.now() - 3 * DAY).toISOString();
  const [ch, vids] = await Promise.all([
    supabase.from("yt_channel_snapshots").select("*").eq("studio_id", studioId).gte("taken_at", since).order("taken_at", { ascending: false }).limit(100).returns<ChannelSnap[]>(),
    supabase.from("yt_video_snapshots").select("*").eq("studio_id", studioId).gte("taken_at", since).order("taken_at", { ascending: false }).limit(2000).returns<VideoSnap[]>(),
  ]);
  if (ch.error) return isMissing(ch.error) ? "migration" : Promise.reject(new Error(friendlyError(ch.error.message)));
  if (vids.error) throw new Error(friendlyError(vids.error.message));
  const channels = ch.data ?? [];
  const latest = channels[0] ?? null;
  // The 7- and 28-day numbers come from the newest snapshot that has them (not every run asks Analytics).
  const withAnalytics = channels.find((c) => c.views_28d !== null || c.analytics_error);
  const before = latest ? dayEarlier(channels, latest.taken_at) : null;
  const videos = videoRows(vids.data ?? []);
  return {
    production: await loadProduction(studioId, videos.map((v) => v.video_id).filter((x): x is string => !!x)),
    manual: await loadManual(studioId),
    channel: latest ? { ...latest, ...(withAnalytics ? { views_7d: withAnalytics.views_7d, views_28d: withAnalytics.views_28d, engaged_views_28d: withAnalytics.engaged_views_28d, watch_minutes_28d: withAnalytics.watch_minutes_28d, subscribers_gained_28d: withAnalytics.subscribers_gained_28d, analytics_until: withAnalytics.analytics_until, analytics_error: withAnalytics.analytics_error } : {}) } : null,
    views24h: latest && before ? Math.max(0, latest.views_total - before.views_total) : null,
    videos,
  };
}

/** Our own production of the videos on YouTube: format, chosen hook and montage plan of the approved script. */
async function loadProduction(studioId: string, videoIds: string[]): Promise<Record<string, Production>> {
  if (!videoIds.length) return {};
  const [v, s] = await Promise.all([
    supabase.from("yt_videos").select("id, format").eq("studio_id", studioId).in("id", videoIds).returns<{ id: string; format: "A" | "B" | "C" }[]>(),
    supabase.from("yt_scripts").select("*").eq("studio_id", studioId).in("video_id", videoIds).eq("status", "approved").returns<{ video_id: string; version: number; hooks?: unknown; chosen_hook?: number | null; edit_plan: Segment[] }[]>(),
  ]);
  const out: Record<string, Production> = {};
  for (const row of v.data ?? []) {
    const script = (s.data ?? []).filter((x) => x.video_id === row.id).sort((a, b) => b.version - a.version)[0];
    const hooks = parseHooks(script?.hooks);
    const chosen = typeof script?.chosen_hook === "number" ? hooks[script.chosen_hook] : undefined;
    out[row.id] = { format: row.format, hookType: chosen?.type ?? null, segments: Array.isArray(script?.edit_plan) ? script.edit_plan : [] };
  }
  return out;
}

async function loadManual(studioId: string): Promise<Manual[] | null> {
  const { data, error } = await supabase.from("yt_manual_metrics").select("youtube_video_id, metric, value, measured_on").eq("studio_id", studioId).returns<Manual[]>();
  if (error) return isMissing(error) ? null : Promise.reject(new Error(friendlyError(error.message)));
  return (data ?? []).map((m) => ({ ...m, value: Number(m.value) }));
}

/** Saves (or replaces) the "Viewed" percentage that Milan reads in YouTube Studio. Empty removes it. */
export async function saveViewedPct(studioId: string, youtubeVideoId: string, value: number | null): Promise<void> {
  if (value === null) {
    const { error } = await supabase.from("yt_manual_metrics").delete().eq("studio_id", studioId).eq("youtube_video_id", youtubeVideoId).eq("metric", "viewed_pct");
    if (error) throw new Error(friendlyError(error.message));
    return;
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Vul een percentage tussen 0 en 100 in.");
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("yt_manual_metrics")
    .upsert({ studio_id: studioId, youtube_video_id: youtubeVideoId, metric: "viewed_pct", value: Math.round(value * 10) / 10, measured_on: new Date().toISOString().slice(0, 10), entered_by: auth.user?.id }, { onConflict: "studio_id,youtube_video_id,metric" });
  if (error) throw new Error(friendlyError(error.message));
}

// Statistics sync (fase E): snapshots in Supabase, so growth ("after 24 hours", "after 7 days") can be compared
// without asking YouTube again. Schedule (2.2 chapter 7): Data API counts every hour (about 4 units, ~100 a day of
// the 10,000), Analytics every 6 hours (own quota), retention curves for the 10 newest videos with each Analytics run.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isoDay, windowTotals, type Stats, type UploadItem, type VideoStatus } from "./youtubeStats.ts";
import { linkState } from "./manualLink.ts";

export const DATA_EVERY_MS = 60 * 60_000;
export const ANALYTICS_EVERY_MS = 6 * 60 * 60_000;
const RETENTION_VIDEOS = 10;

export type ChannelSnapshot = {
  /** The YouTube channel of the sign-in (not stored; picks the right Studio channel). */
  id?: string | null;
  subscribers: number | null;
  views_total: number;
  videos_total: number;
  views_7d: number | null;
  views_28d: number | null;
  engaged_views_28d: number | null;
  watch_minutes_28d: number | null;
  subscribers_gained_28d: number | null;
  daily: { day: string; views: number; engagedViews: number | null; minutes: number; subscribersGained: number }[] | null;
  analytics_until: string | null;
  analytics_error: string | null;
};
export type VideoSnapshot = {
  youtube_video_id: string;
  title: string;
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
  retention: { at: number; ratio: number; relative: number | null }[] | null;
  analytics_until: string | null;
};

/** Collects one snapshot of the channel and its videos. Analytics errors (no permission yet) never stop the counts. */
export async function collect(stats: Stats, o: { analytics: boolean; now: number }): Promise<{ channel: ChannelSnapshot; videos: VideoSnapshot[] }> {
  const counts = await stats.channel();
  const uploads: UploadItem[] = await stats.uploads();
  const perVideo = await stats.videos(uploads.map((u) => u.videoId));
  const channel: ChannelSnapshot = { id: counts.id, subscribers: counts.subscribers, views_total: counts.views, videos_total: counts.videos, views_7d: null, views_28d: null, engaged_views_28d: null, watch_minutes_28d: null, subscribers_gained_28d: null, daily: null, analytics_until: null, analytics_error: null };
  const videos: VideoSnapshot[] = uploads.map((u) => {
    const c = perVideo.find((v) => v.videoId === u.videoId);
    return { youtube_video_id: u.videoId, title: u.title, published_at: u.publishedAt || null, duration_s: c?.durationS ?? null, views: c?.views ?? 0, likes: c?.likes ?? null, comments: c?.comments ?? null, a_views: null, engaged_views: null, watch_minutes: null, avg_view_duration_s: null, avg_view_pct: null, subscribers_gained: null, retention: null, analytics_until: null };
  });
  if (!o.analytics) return { channel, videos };

  try {
    const daily = await stats.daily(isoDay(o.now, 35));
    const w7 = windowTotals(daily, 7);
    const w28 = windowTotals(daily, 28);
    Object.assign(channel, { views_7d: w7.views, views_28d: w28.views, engaged_views_28d: w28.engagedViews, watch_minutes_28d: Math.round(w28.minutes), subscribers_gained_28d: w28.subscribersGained, daily, analytics_until: w28.until });
    if (uploads.length) {
      const first = uploads.map((u) => u.publishedAt.slice(0, 10)).filter(Boolean).sort()[0] ?? isoDay(o.now, 365);
      const per = await stats.videoAnalytics(uploads.map((u) => u.videoId), first);
      for (const v of videos) {
        const a = per.find((p) => p.videoId === v.youtube_video_id);
        if (a) Object.assign(v, { a_views: a.views, engaged_views: a.engagedViews, watch_minutes: Math.round(a.minutes * 10) / 10, avg_view_duration_s: a.avgViewDurationS, avg_view_pct: Math.round(a.avgViewPct * 10) / 10, subscribers_gained: a.subscribersGained, analytics_until: w28.until });
      }
      const newest = [...videos].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, RETENTION_VIDEOS);
      for (const v of newest) {
        if (!v.views) continue; // no viewers yet: no curve
        try {
          const curve = await stats.retention(v.youtube_video_id, (v.published_at ?? first).slice(0, 10));
          v.retention = curve.length ? curve : null;
        } catch {
          /* a single curve may be missing; the other numbers stay */
        }
      }
    }
  } catch (e) {
    channel.analytics_error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  return { channel, videos };
}

type StudioVideo = { id: string; youtube_video_id: string; status: string; privacy_status: string | null; scheduled_at: string | null };
type StudioPublication = { id: string; video_id: string; status: string; visibility: string; publish_at: string | null };

/**
 * What to change so the Studio says what YouTube says (pure). Only videos on the signed-in channel, only rows that are
 * already on YouTube (a draft or an upload in progress is never touched). Only changed fields count as a fix.
 */
export function statusFixes(videos: StudioVideo[], pubs: StudioPublication[], statuses: VideoStatus[], youtubeId: string | null, nowMs: number) {
  const out: { video?: { id: string; set: Record<string, unknown> }; pub?: { id: string; set: Record<string, unknown> } }[] = [];
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
  for (const v of videos) {
    const st = statuses.find((s) => s.videoId === v.youtube_video_id);
    if (!st || (youtubeId && st.channelId && st.channelId !== youtubeId)) continue;
    const want = linkState({ id: st.videoId, channelId: st.channelId, title: "", privacyStatus: st.privacyStatus, publishAt: st.publishAt, publishedAt: st.publishedAt, madeForKids: false, containsSyntheticMedia: false }, nowMs);
    const fix: (typeof out)[number] = {};
    if (v.status !== want.video.status || v.privacy_status !== want.video.privacy_status || !same(v.scheduled_at, want.video.scheduled_at)) {
      const set: Record<string, unknown> = { status: want.video.status, privacy_status: want.video.privacy_status, scheduled_at: want.video.scheduled_at };
      // published_at only when it becomes live; an already live video keeps its own moment.
      if ("published_at" in want.video && v.status !== "published") set.published_at = want.video.published_at;
      fix.video = { id: v.id, set };
    }
    const p = pubs.find((x) => x.video_id === v.id);
    if (p && ["uploaded", "scheduled", "published"].includes(p.status) && (p.status !== want.pub.status || p.visibility !== want.pub.visibility || !same(p.publish_at, want.pub.publish_at)))
      fix.pub = { id: p.id, set: { status: want.pub.status, visibility: want.pub.visibility, publish_at: want.pub.publish_at } };
    if (fix.video || fix.pub) out.push(fix);
  }
  return out;
}

/** Runs the schedule inside the worker and writes the snapshots. Only for the linked channel. */
export function createStatsSync(o: { db: SupabaseClient; stats: Stats; log: (m: string) => void; now?: () => number }) {
  const now = o.now ?? Date.now;
  let lastData = 0;
  let lastAnalytics = 0;
  let lastPrune = 0;
  let running: Promise<string | null> | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function run(analytics: boolean): Promise<string | null> {
    const snap = await collect(o.stats, { analytics, now: now() });
    const ch = await pickChannel(snap.channel.id ?? null);
    if (!ch) return null;
    const takenAt = new Date(now()).toISOString();
    const ids = snap.videos.map((v) => v.youtube_video_id);
    const ours = ids.length ? await o.db.from("yt_videos").select("id, youtube_video_id").in("youtube_video_id", ids).eq("studio_id", ch.studio_id) : { data: [], error: null };
    const byYt = new Map(((ours.data ?? []) as { id: string; youtube_video_id: string }[]).map((r) => [r.youtube_video_id, r.id]));
    const { id: _youtubeId, ...channelRow } = snap.channel;
    const c = await o.db.from("yt_channel_snapshots").insert({ studio_id: ch.studio_id, channel_id: ch.id, taken_at: takenAt, ...channelRow });
    if (c.error) throw new Error(/does not exist|could not find/i.test(c.error.message) ? "Migratie 041 is nog niet uitgevoerd" : c.error.message);
    if (snap.videos.length) {
      const v = await o.db.from("yt_video_snapshots").insert(snap.videos.map((x) => ({ studio_id: ch.studio_id, channel_id: ch.id, taken_at: takenAt, video_id: byYt.get(x.youtube_video_id) ?? null, ...x })));
      if (v.error) throw new Error(v.error.message);
    }
    let fixed = 0;
    try {
      fixed = await settleStatuses(ch.studio_id, snap.channel.id ?? null);
    } catch (e) {
      o.log(`Live/privé niet nagekeken: ${e instanceof Error ? e.message : String(e)}`);
    }
    lastData = now();
    if (analytics) lastAnalytics = now();
    return `${snap.videos.length} video's${fixed ? `; ${fixed} status(sen) gelijkgezet met YouTube` : ""}${analytics ? (snap.channel.analytics_error ? `; statistieken: ${snap.channel.analytics_error}` : `; statistieken t/m ${snap.channel.analytics_until ?? "?"}`) : ""}`;
  }

  /**
   * 18-11-2026: the snapshots went to whichever channel row happened to come first (SpawnNado, Dreamnest) instead of
   * KIVOXEL. Now: the row whose YouTube id is the sign-in's channel, else the default channel, else the first linked one.
   */
  async function pickChannel(youtubeId: string | null): Promise<{ id: string; studio_id: string } | null> {
    if (youtubeId) {
      const byId = await o.db.from("yt_channels").select("id, studio_id").eq("youtube_channel_id", youtubeId).limit(1).maybeSingle<{ id: string; studio_id: string }>();
      if (byId.data) return byId.data;
    }
    const def = await o.db.from("yt_channels").select("id, studio_id").eq("is_default", true).limit(1).maybeSingle<{ id: string; studio_id: string }>();
    if (def.data) return def.data;
    const { data, error } = await o.db.from("yt_channels").select("id, studio_id").not("youtube_connected_at", "is", null).limit(1).maybeSingle<{ id: string; studio_id: string }>();
    if (error) throw new Error(error.message);
    return data;
  }

  /** 18-11-2026: Live, Privé and Ingepland in the Studio follow YouTube itself (also changes made in YouTube Studio). */
  async function settleStatuses(studioId: string, youtubeId: string | null): Promise<number> {
    const vids = await o.db.from("yt_videos").select("id, youtube_video_id, status, privacy_status, scheduled_at").eq("studio_id", studioId).not("youtube_video_id", "is", null).in("status", ["published", "scheduled"]).limit(2000).returns<StudioVideo[]>();
    if (vids.error) throw new Error(vids.error.message);
    const rows = vids.data ?? [];
    if (!rows.length) return 0;
    const pubs = await o.db.from("yt_publications").select("id, video_id, status, visibility, publish_at").in("video_id", rows.map((r) => r.id)).returns<StudioPublication[]>();
    if (pubs.error) throw new Error(pubs.error.message);
    const statuses = await o.stats.statuses(rows.map((r) => r.youtube_video_id));
    let n = 0;
    for (const fix of statusFixes(rows, pubs.data ?? [], statuses, youtubeId, now())) {
      if (fix.pub) {
        const r = await o.db.from("yt_publications").update(fix.pub.set).eq("id", fix.pub.id);
        if (r.error) o.log(`Publicatie ${fix.pub.id} niet bijgewerkt: ${r.error.message}`);
      }
      if (fix.video) {
        const r = await o.db.from("yt_videos").update(fix.video.set).eq("id", fix.video.id);
        if (r.error) o.log(`Video ${fix.video.id} niet bijgewerkt: ${r.error.message}`);
      }
      n++;
    }
    return n;
  }

  /** One sync at a time; a manual request while one runs waits for that one. */
  function sync(analytics: boolean): Promise<string | null> {
    if (!running) running = run(analytics).finally(() => (running = null));
    return running;
  }

  async function tick() {
    const due = now() - lastData >= DATA_EVERY_MS;
    const analytics = now() - lastAnalytics >= ANALYTICS_EVERY_MS;
    if (!due && !analytics) return;
    try {
      const m = await sync(analytics);
      if (m) o.log(`Cijfers bijgewerkt: ${m}`);
      // Once a day: old hourly snapshots go, one per day and the report points stay (migration 043).
      if (now() - lastPrune >= 24 * 60 * 60_000) {
        lastPrune = now();
        const { data, error } = await o.db.rpc("yt_prune_snapshots");
        if (!error && typeof data === "number" && data > 0) o.log(`Oude momentopnames opgeruimd: ${data}`);
      }
    } catch (e) {
      o.log(`Cijfers ophalen mislukt: ${e instanceof Error ? e.message : String(e)}`);
      lastData = now(); // try again at the next interval, not every minute
    }
  }

  return {
    sync,
    tick,
    start(intervalMs = 5 * 60_000) {
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop: () => timer && clearInterval(timer),
    /** For the dashboard: when the last syncs ran. */
    state: () => ({ lastData: lastData ? new Date(lastData).toISOString() : null, lastAnalytics: lastAnalytics ? new Date(lastAnalytics).toISOString() : null }),
  };
}

// Statistics from YouTube (fase E). Two sources, shown separately in the dashboard:
// - Data API (videos.list, channels.list): counts that are close to live (views, likes, comments, subscribers);
// - Analytics API (reports.query): engaged views, watch time, average view percentage, new subscribers, retention.
//   These come with a delay; the API says up to which day the data is complete.
// Docs read 12-11-2026: developers.google.com/youtube/analytics/metrics and /channel_reports. Impressions and CTR are
// not available through the API; revenue only for channels in the Partner Program (separate scope, not requested).
import type { YouTube } from "./youtube.ts";

const API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

export type ChannelCounts = { subscribers: number | null; views: number; videos: number; hiddenSubscribers: boolean };
export type UploadItem = { videoId: string; title: string; publishedAt: string };
export type VideoCounts = { videoId: string; views: number; likes: number | null; comments: number | null; durationS: number | null };
export type VideoAnalytics = { videoId: string; views: number; engagedViews: number | null; minutes: number; avgViewDurationS: number; avgViewPct: number; subscribersGained: number; likes: number; comments: number };
export type DailyRow = { day: string; views: number; engagedViews: number | null; minutes: number; subscribersGained: number };
export type RetentionPoint = { at: number; ratio: number; relative: number | null };

/** "PT1M5S" -> 65. */
export function isoDurationS(d: string | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** YYYY-MM-DD in UTC, `days` before `now`. */
export const isoDay = (now: number, days = 0) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/** Rows of a reports.query answer as objects, by column name. */
export function reportRows(json: { columnHeaders?: { name: string }[]; rows?: (string | number)[][] }): Record<string, string | number>[] {
  const names = (json.columnHeaders ?? []).map((c) => c.name);
  return (json.rows ?? []).map((r) => Object.fromEntries(r.map((v, i) => [names[i], v])));
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function createStats(o: { yt: YouTube; fetch?: typeof fetch; now?: () => number }) {
  const http = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const auth = async () => ({ authorization: `Bearer ${await o.yt.accessToken()}` });

  async function get<T>(url: string, what: string): Promise<T> {
    const res = await http(url, { headers: await auth() });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
    if (res.status === 403 && url.startsWith(ANALYTICS)) throw new Error("Geen toestemming voor statistieken: koppel YouTube opnieuw en vink 'statistieken bekijken' aan.");
    if (!res.ok) throw new Error(`${what}: ${json.error?.message ?? res.status}`);
    return json;
  }
  /** Analytics reports do not use the 10,000-unit Data API quota. */
  const report = (params: Record<string, string>, what: string) =>
    get<{ columnHeaders?: { name: string }[]; rows?: (string | number)[][] }>(`${ANALYTICS}?${new URLSearchParams({ ids: "channel==MINE", ...params })}`, what);

  return {
    /** Subscribers, total views and number of videos (channels.list, 1 unit). */
    async channel(): Promise<ChannelCounts> {
      await o.yt.spend("channels.list");
      const json = await get<{ items?: { statistics?: Record<string, string | boolean> }[] }>(`${API}/channels?part=statistics&mine=true`, "Kanaalcijfers");
      const s = json.items?.[0]?.statistics ?? {};
      return { subscribers: s.hiddenSubscriberCount ? null : num(s.subscriberCount), views: num(s.viewCount) ?? 0, videos: num(s.videoCount) ?? 0, hiddenSubscribers: s.hiddenSubscriberCount === true };
    },

    /** The newest uploads of the channel, also videos uploaded by hand (2 units). */
    async uploads(max = 50): Promise<UploadItem[]> {
      await o.yt.spend("channels.list");
      const ch = await get<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(`${API}/channels?part=contentDetails&mine=true`, "Uploadlijst");
      const list = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!list) return [];
      await o.yt.spend("playlistItems.list");
      const items = await get<{ items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[] }>(
        `${API}/playlistItems?part=snippet,contentDetails&maxResults=${Math.min(50, max)}&playlistId=${encodeURIComponent(list)}`,
        "Uploadlijst",
      );
      return (items.items ?? [])
        .map((i) => ({ videoId: i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId ?? "", title: i.snippet?.title ?? "", publishedAt: i.contentDetails?.videoPublishedAt ?? i.snippet?.publishedAt ?? "" }))
        .filter((i) => i.videoId);
    },

    /** Near-live counts per video (videos.list, 1 unit per 50 videos). Likes/comments can be hidden: then null. */
    async videos(ids: string[]): Promise<VideoCounts[]> {
      const out: VideoCounts[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        await o.yt.spend("videos.list");
        const part = ids.slice(i, i + 50);
        const json = await get<{ items?: { id: string; statistics?: Record<string, string>; contentDetails?: { duration?: string } }[] }>(`${API}/videos?part=statistics,contentDetails&id=${part.map(encodeURIComponent).join(",")}`, "Videocijfers");
        for (const v of json.items ?? []) out.push({ videoId: v.id, views: num(v.statistics?.viewCount) ?? 0, likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount), durationS: isoDurationS(v.contentDetails?.duration) });
      }
      return out;
    },

    /** Analytics per video over a period (top videos report: dimension video, filter on our IDs). */
    async videoAnalytics(ids: string[], startDate: string, endDate = isoDay(now())): Promise<VideoAnalytics[]> {
      if (!ids.length) return [];
      const out: VideoAnalytics[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const json = await report(
          { startDate, endDate, dimensions: "video", filters: `video==${ids.slice(i, i + 200).join(",")}`, metrics: "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments", sort: "-views", maxResults: "200" },
          "Statistieken per video",
        );
        for (const r of reportRows(json))
          out.push({ videoId: String(r.video), views: num(r.views) ?? 0, engagedViews: num(r.engagedViews), minutes: num(r.estimatedMinutesWatched) ?? 0, avgViewDurationS: num(r.averageViewDuration) ?? 0, avgViewPct: num(r.averageViewPercentage) ?? 0, subscribersGained: num(r.subscribersGained) ?? 0, likes: num(r.likes) ?? 0, comments: num(r.comments) ?? 0 });
      }
      return out;
    },

    /** The channel per day: rows only up to the last complete day (that is where the delay shows). */
    async daily(startDate: string, endDate = isoDay(now())): Promise<DailyRow[]> {
      const json = await report({ startDate, endDate, dimensions: "day", metrics: "views,engagedViews,estimatedMinutesWatched,subscribersGained", sort: "day" }, "Kanaal per dag");
      return reportRows(json).map((r) => ({ day: String(r.day), views: num(r.views) ?? 0, engagedViews: num(r.engagedViews), minutes: num(r.estimatedMinutesWatched) ?? 0, subscribersGained: num(r.subscribersGained) ?? 0 }));
    },

    /** Retention curve of one video: share of viewers still watching per point of the video (0-1). */
    async retention(videoId: string, startDate: string, endDate = isoDay(now())): Promise<RetentionPoint[]> {
      const json = await report({ startDate, endDate, dimensions: "elapsedVideoTimeRatio", filters: `video==${videoId}`, metrics: "audienceWatchRatio,relativeRetentionPerformance", sort: "elapsedVideoTimeRatio" }, "Kijkcurve");
      return reportRows(json).map((r) => ({ at: num(r.elapsedVideoTimeRatio) ?? 0, ratio: num(r.audienceWatchRatio) ?? 0, relative: num(r.relativeRetentionPerformance) }));
    },
  };
}
export type Stats = ReturnType<typeof createStats>;

/** Sums of the last `days` complete days, and up to which day the data runs. */
export function windowTotals(rows: DailyRow[], days: number): { views: number; engagedViews: number | null; minutes: number; subscribersGained: number; until: string | null } {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const until = sorted.at(-1)?.day ?? null;
  const part = sorted.slice(-days);
  const engaged = part.every((r) => r.engagedViews !== null) ? part.reduce((s, r) => s + (r.engagedViews ?? 0), 0) : null;
  return { views: part.reduce((s, r) => s + r.views, 0), engagedViews: engaged, minutes: part.reduce((s, r) => s + r.minutes, 0), subscribersGained: part.reduce((s, r) => s + r.subscribersGained, 0), until };
}

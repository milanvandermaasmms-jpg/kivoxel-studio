// Reference videos (fase 3.1): the best performing recent videos in the niche, through the YouTube Data API with the
// linked account. Costs only quota (search.list 100 units, videos.list and channels.list 1 unit), never money.
import { firstSentence, isoSeconds, type ReferenceVideo } from "../lib/youtube/viral.ts";
import type { YouTube } from "./youtube.ts";

const API = "https://www.googleapis.com/youtube/v3";
type Fetch = typeof fetch;

export type FoundVideo = ReferenceVideo & { youtube_video_id: string; subscribers: number | null };
export type Research = { search: (query: string, language: "en" | "nl", now?: number) => Promise<FoundVideo[]> };

export function createResearch(o: { yt: Pick<YouTube, "accessToken" | "spend">; fetch?: Fetch }): Research {
  const http = o.fetch ?? fetch;
  async function get<T>(call: string, path: string): Promise<T> {
    const token = await o.yt.accessToken();
    await o.yt.spend(call);
    const res = await http(`${API}/${path}`, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`YouTube gaf een fout bij ${call}: ${json.error?.message ?? res.status}`);
    return json;
  }
  return {
    async search(query, language, now = Date.now()) {
      const after = new Date(now - 30 * 86_400_000).toISOString();
      const q = new URLSearchParams({ part: "snippet", type: "video", order: "viewCount", maxResults: "25", q: query, publishedAfter: after, relevanceLanguage: language, safeSearch: "strict" });
      const found = await get<{ items?: { id?: { videoId?: string } }[] }>("search.list", `search?${q}`);
      const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
      if (!ids.length) return [];
      type V = { id: string; snippet?: { title?: string; description?: string; tags?: string[]; publishedAt?: string; channelId?: string }; statistics?: { viewCount?: string }; contentDetails?: { duration?: string } };
      const videos = await get<{ items?: V[] }>("videos.list", `videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`);
      const channelIds = [...new Set((videos.items ?? []).map((v) => v.snippet?.channelId).filter((x): x is string => !!x))];
      const channels = channelIds.length ? await get<{ items?: { id: string; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[] }>("channels.list", `channels?part=statistics&id=${channelIds.slice(0, 50).join(",")}`) : { items: [] };
      const subs = new Map((channels.items ?? []).map((c) => [c.id, c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount ?? 0)]));
      return (videos.items ?? []).map((v) => {
        const views = Number(v.statistics?.viewCount ?? 0);
        const subscribers = subs.get(v.snippet?.channelId ?? "") ?? null;
        const duration = isoSeconds(v.contentDetails?.duration);
        return {
          youtube_video_id: v.id,
          title: (v.snippet?.title ?? "").slice(0, 200),
          tags: (v.snippet?.tags ?? []).slice(0, 60).map((t) => t.slice(0, 100)),
          duration_s: duration,
          // Shorts can be up to 3 minutes; the API does not say whether a video is a Short.
          is_short: duration !== null && duration <= 180,
          published_at: v.snippet?.publishedAt ?? null,
          views,
          subscribers,
          ratio: subscribers ? Math.round((views / Math.max(subscribers, 100)) * 100) / 100 : null,
          hook: firstSentence(v.snippet?.description ?? ""),
        };
      });
    },
  };
}

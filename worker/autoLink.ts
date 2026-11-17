// Zelf geüpload, automatisch (18-11-2026): Milan uploads a video by hand in YouTube Studio and the Studio finds it
// by itself, without pasting a link. Every 10 minutes, and only while a video is waiting under "Klaar voor YouTube",
// the worker reads the newest uploads of the channel (2 quota units) and links an upload whose title is the same as
// the title of exactly one waiting video (its draft, its working title or one of its suggested titles). Hashtags,
// capitals, emoji and punctuation do not count. Two possible matches: nothing is linked (no guessing).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { YouTube } from "./youtube.ts";
import { createStats, type UploadItem } from "./youtubeStats.ts";

/** "Hidden TNT Trap Goes Off Instantly!  #minecraft #gaming" -> "hidden tnt trap goes off instantly". */
export function normalizeTitle(t: string): string {
  return t
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type Waiting = { videoId: string; titles: string[] };

/** Which uploads belong to which waiting video: only exact title matches that point at one video, and one upload per video. */
export function matchUploads(uploads: UploadItem[], waiting: Waiting[], linked: Set<string>): { videoId: string; youtubeId: string; title: string }[] {
  const byTitle = new Map<string, Set<string>>();
  for (const w of waiting) for (const t of w.titles) {
    const k = normalizeTitle(t);
    if (k.length < 8) continue; // too short to be sure ("Part 2", "Wow")
    if (!byTitle.has(k)) byTitle.set(k, new Set());
    byTitle.get(k)!.add(w.videoId);
  }
  const out: { videoId: string; youtubeId: string; title: string }[] = [];
  const usedVideos = new Set<string>();
  const perVideo = new Map<string, number>();
  const hits = uploads
    .filter((u) => !linked.has(u.videoId))
    .map((u) => ({ u, videos: byTitle.get(normalizeTitle(u.title)) }))
    .filter((h): h is { u: UploadItem; videos: Set<string> } => !!h.videos && h.videos.size === 1);
  for (const h of hits) {
    const v = [...h.videos][0];
    perVideo.set(v, (perVideo.get(v) ?? 0) + 1);
  }
  for (const h of hits) {
    const v = [...h.videos][0];
    if (perVideo.get(v)! > 1 || usedVideos.has(v)) continue; // the same title uploaded twice: let Milan choose
    usedVideos.add(v);
    out.push({ videoId: v, youtubeId: h.u.videoId, title: h.u.title });
  }
  return out;
}

export function createAutoLink(o: { db: SupabaseClient; youtubeFor: (channelRowId: string) => Promise<YouTube>; link: (videoId: string, youtubeId: string) => Promise<unknown>; log: (m: string) => void }) {
  let running = false;
  async function run(): Promise<number> {
    if (running) return 0;
    running = true;
    try {
      const v = await o.db.from("yt_videos").select("id, channel_id, studio_id, title").eq("status", "approved").is("youtube_video_id", null).eq("is_test", false).returns<{ id: string; channel_id: string | null; studio_id: string; title: string | null }[]>();
      if (v.error || !v.data.length) return 0;
      const ids = v.data.map((x) => x.id);
      const [pubs, scripts, channels] = await Promise.all([
        o.db.from("yt_publications").select("video_id, title, status").in("video_id", ids).returns<{ video_id: string; title: string; status: string }[]>(),
        o.db.from("yt_scripts").select("video_id, titles").in("video_id", ids).returns<{ video_id: string; titles: string[] | null }[]>(),
        o.db.from("yt_channels").select("id, studio_id, is_default").not("youtube_connected_at", "is", null).returns<{ id: string; studio_id: string; is_default: boolean }[]>(),
      ]);
      if (pubs.error || scripts.error || channels.error) return 0;
      // A video that is already on its way to YouTube through the Studio is not waiting for a hand upload.
      const busy = new Set(pubs.data.filter((p) => !["draft", "failed"].includes(p.status)).map((p) => p.video_id));
      let linkedNow = 0;
      for (const ch of channels.data) {
        const mine = v.data.filter((x) => !busy.has(x.id) && (x.channel_id ? x.channel_id === ch.id : ch.is_default && x.studio_id === ch.studio_id));
        if (!mine.length) continue;
        const waiting: Waiting[] = mine.map((x) => ({
          videoId: x.id,
          titles: [x.title ?? "", ...pubs.data.filter((p) => p.video_id === x.id).map((p) => p.title), ...scripts.data.filter((s) => s.video_id === x.id).flatMap((s) => s.titles ?? [])].filter(Boolean),
        }));
        let uploads: UploadItem[];
        try {
          uploads = await createStats({ yt: await o.youtubeFor(ch.id) }).uploads(25);
        } catch (e) {
          o.log(`Zelf geüploade video's niet nagekeken: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const ytIds = uploads.map((u) => u.videoId);
        const known = ytIds.length ? await o.db.from("yt_publications").select("youtube_video_id").in("youtube_video_id", ytIds).returns<{ youtube_video_id: string }[]>() : { data: [], error: null };
        const known2 = ytIds.length ? await o.db.from("yt_videos").select("youtube_video_id").in("youtube_video_id", ytIds).returns<{ youtube_video_id: string }[]>() : { data: [], error: null };
        const linked = new Set([...(known.data ?? []), ...(known2.data ?? [])].map((r) => r.youtube_video_id));
        for (const m of matchUploads(uploads, waiting, linked)) {
          try {
            await o.link(m.videoId, m.youtubeId);
            linkedNow++;
            o.log(`Zelf geüpload automatisch gevonden: "${m.title}"`);
          } catch (e) {
            o.log(`Zelf geüploade video "${m.title}" niet gekoppeld: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      return linkedNow;
    } finally {
      running = false;
    }
  }
  return {
    run,
    start(everyMs = 10 * 60_000) {
      void run().catch(() => undefined);
      setInterval(() => void run().catch(() => undefined), everyMs);
    },
  };
}

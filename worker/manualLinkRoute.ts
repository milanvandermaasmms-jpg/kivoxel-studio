// Zelf geüpload (17-11-2026): links a video Milan uploaded by hand to its video in the Studio. Checks with YouTube that
// the video exists and belongs to the channel of this Studio video, then writes the publication and the video status the
// same way an upload by the worker does, and closes open upload steps so the video is never uploaded twice.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { YouTube } from "./youtube.ts";
import { linkState, lookupVideo, parseYouTubeId, safeTitle } from "./manualLink.ts";

export type ManualLinkResult = { youtubeVideoId: string; title: string; status: "scheduled" | "uploaded" | "published"; publishAt: string | null };

export function createManualLink(o: { db: SupabaseClient; youtubeFor: (channelRowId: string) => Promise<YouTube>; log: (m: string) => void; now?: () => number; http?: typeof fetch }) {
  const now = o.now ?? Date.now;
  return async function link(videoId: string, input: string): Promise<ManualLinkResult> {
    const ytId = parseYouTubeId(input);
    if (!ytId) throw new Error("Dit is geen YouTube-link. Plak de link van de video, bijvoorbeeld https://youtu.be/… of https://youtube.com/shorts/…");
    const v = await o.db.from("yt_videos").select("id, studio_id, channel_id, status, youtube_video_id").eq("id", videoId).maybeSingle<{ id: string; studio_id: string; channel_id: string | null; status: string; youtube_video_id: string | null }>();
    if (v.error) throw new Error(v.error.message);
    if (!v.data) throw new Error("Deze video bestaat niet (meer) in de Studio");
    if (v.data.youtube_video_id && v.data.youtube_video_id !== ytId) throw new Error("Deze video is al aan een andere YouTube-video gekoppeld");
    if (!["approved", "scheduled", "published"].includes(v.data.status)) throw new Error("Keur de video eerst goed; daarna kun je hem koppelen");
    const other = await o.db.from("yt_publications").select("video_id").eq("youtube_video_id", ytId).neq("video_id", videoId).limit(1).returns<{ video_id: string }[]>();
    if (other.error) throw new Error(other.error.message);
    if (other.data.length) throw new Error("Deze YouTube-video is al aan een andere video in de Studio gekoppeld");

    const ch = v.data.channel_id
      ? await o.db.from("yt_channels").select("id, name, youtube_channel_id").eq("id", v.data.channel_id).maybeSingle<{ id: string; name: string; youtube_channel_id: string | null }>()
      : await o.db.from("yt_channels").select("id, name, youtube_channel_id").eq("studio_id", v.data.studio_id).eq("is_default", true).maybeSingle<{ id: string; name: string; youtube_channel_id: string | null }>();
    if (ch.error || !ch.data) throw new Error("Het kanaal van deze video is niet gevonden");
    const yt = await o.youtubeFor(ch.data.id);
    await yt.spend("videos.list");
    const info = await lookupVideo(await yt.accessToken(), ytId, o.http);
    if (!info) throw new Error("YouTube vindt deze video niet. Klopt de link, en is hij geüpload met het account van dit kanaal?");
    if (ch.data.youtube_channel_id && info.channelId !== ch.data.youtube_channel_id) throw new Error(`Deze video staat op een ander YouTube-kanaal dan ${ch.data.name}`);

    const state = linkState(info, now());
    const pub = await o.db.from("yt_publications").select("id").eq("video_id", videoId).maybeSingle<{ id: string }>();
    if (pub.error) throw new Error(pub.error.message);
    const fields = { youtube_video_id: ytId, error: null, ...state.pub };
    const written = pub.data
      ? await o.db.from("yt_publications").update(fields).eq("id", pub.data.id)
      : await o.db.from("yt_publications").insert({ studio_id: v.data.studio_id, video_id: videoId, title: safeTitle(info.title), made_for_kids: info.madeForKids, contains_synthetic_media: info.containsSyntheticMedia, ...fields });
    if (written.error) throw new Error(`Publicatie niet opgeslagen: ${written.error.message}`);
    const video = await o.db.from("yt_videos").update({ youtube_video_id: ytId, ...state.video }).eq("id", videoId);
    if (video.error) throw new Error(`Videostatus niet bijgewerkt: ${video.error.message}`);
    // Nothing of this video waits any more: a queued upload would put it on YouTube a second time.
    const closed = await o.db.from("yt_jobs").update({ status: "cancelled", error: "Niet meer nodig: zelf geüpload naar YouTube" }).eq("video_id", videoId).eq("status", "queued").in("step", ["upload", "publish", "script", "render", "suggest", "viral"]);
    if (closed.error) o.log(`Open stappen niet gesloten: ${closed.error.message}`);
    o.log(`Zelf geüpload gekoppeld: https://youtu.be/${ytId} (${state.pub.status})`);
    return { youtubeVideoId: ytId, title: info.title, status: state.pub.status, publishAt: state.pub.publish_at };
  };
}

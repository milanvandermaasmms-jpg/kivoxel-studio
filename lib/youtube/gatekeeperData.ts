// Data for the Poortwachter (migration 046): the private word list and what a video's checks need.
import { friendlyError, supabase } from "../supabase";
import type { PrivacyFlag } from "./analysis";
import type { Channel } from "./channels";
import type { GateScript } from "./gatekeeper";
import type { StoredThumb } from "./thumbnails";

const isMissing = (error: { code?: string; message: string }) => error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find/i.test(error.message);

/** null while migration 046 has not run. */
export async function loadPrivateTerms(studioId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from("yt_settings").select("private_terms").eq("studio_id", studioId).maybeSingle<{ private_terms: string[] }>();
  if (error) {
    if (isMissing(error)) return null;
    throw new Error(friendlyError(error.message));
  }
  return data?.private_terms ?? [];
}

export async function savePrivateTerms(studioId: string, terms: string[]): Promise<void> {
  if (terms.length > 200) throw new Error("Hoogstens 200 privé-woorden.");
  if (terms.join("|").length > 4000) throw new Error("De privé-woorden zijn samen te lang.");
  const { error } = await supabase.from("yt_settings").upsert({ studio_id: studioId, private_terms: terms }, { onConflict: "studio_id" });
  if (error) throw new Error(friendlyError(error.message));
}

export type GateContext = { channel: Channel | null; privateTerms: string[]; script: (GateScript & { titles?: string[] }) | null; flags: PrivacyFlag[] };

/** Everything the checklist of one video needs; privateTerms is empty before migration 046. */
export async function loadGateContext(studioId: string, videoId: string): Promise<GateContext> {
  const [video, scripts, terms] = await Promise.all([
    supabase.from("yt_videos").select("channel_id, yt_video_moments(moment_id)").eq("id", videoId).maybeSingle<{ channel_id: string; yt_video_moments: { moment_id: string }[] }>(),
    supabase.from("yt_scripts").select("*").eq("video_id", videoId).eq("status", "approved").order("version", { ascending: false }).limit(1).returns<(GateScript & { titles?: string[] })[]>(),
    loadPrivateTerms(studioId).catch(() => null),
  ]);
  if (video.error) throw new Error(friendlyError(video.error.message));
  const momentIds = (video.data?.yt_video_moments ?? []).map((m) => m.moment_id);
  const [channel, moments] = await Promise.all([
    video.data ? supabase.from("yt_channels").select("*").eq("id", video.data.channel_id).maybeSingle<Channel>() : null,
    momentIds.length ? supabase.from("yt_moments").select("privacy_flags").in("id", momentIds).returns<{ privacy_flags: PrivacyFlag[] }[]>() : null,
  ]);
  return {
    channel: channel?.data ?? null,
    privateTerms: terms ?? [],
    script: scripts.data?.[0] ?? null,
    flags: [...new Set((moments?.data ?? []).flatMap((m) => m.privacy_flags))],
  };
}

/** Fase C: the thumbnails the worker made for a montage (migration 047); empty before that or when none were made. */
export async function loadThumbs(renderId: string): Promise<StoredThumb[]> {
  const { data, error } = await supabase.from("yt_renders").select("*").eq("id", renderId).maybeSingle<{ thumbnails?: StoredThumb[] }>();
  if (error) return [];
  return Array.isArray(data?.thumbnails) ? data.thumbnails : [];
}

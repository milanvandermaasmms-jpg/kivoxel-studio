// 23-11-2026 (superprompt V6, fase 30): Milan's own judgement of the parts of the Viral Quality Score that the pc cannot
// measure (originality, build-up, how the voice sounds). Stored as his own studio events (migration 049, no new table),
// one per part; the newest counts. The worker's measured parts are never changed by this.

import { friendlyError, supabase } from "../supabase";
import type { PartKey } from "../kivoxel/viralScore";

export async function loadJudgements(studioId: string, videoId: string): Promise<Partial<Record<PartKey, number>>> {
  const { data, error } = await supabase.from("studio_events").select("metadata, at").eq("studio_id", studioId).eq("action", "viral_oordeel").eq("metadata->>video_id", videoId).order("at", { ascending: true }).limit(200).returns<{ metadata: { part?: PartKey; score?: number } }[]>();
  if (error) throw new Error(friendlyError(error.message));
  const out: Partial<Record<PartKey, number>> = {};
  for (const r of data ?? []) if (r.metadata.part && typeof r.metadata.score === "number") out[r.metadata.part] = r.metadata.score;
  return out;
}

export async function saveJudgement(studioId: string, channelId: string | null, videoId: string, renderId: string | null, part: PartKey, score: number): Promise<void> {
  const { error } = await supabase.from("studio_events").insert({ studio_id: studioId, channel_id: channelId, action: "viral_oordeel", screen: "keuren", metadata: { video_id: videoId, render_id: renderId, part, score: Math.max(0, Math.min(10, Math.round(score * 2) / 2)) } });
  if (error) throw new Error(friendlyError(error.message));
}

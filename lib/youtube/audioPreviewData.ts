// 23-11-2026 (Milan, superprompt V6, fase 31): audio previews in the studio. A preview is a render job with
// payload.preview (the worker saves only the file: no new version, no status change). Choosing an option makes the real
// version with that audio (a normal montage) and records the choice as a preference (Milan's own studio event).

import { friendlyError, supabase } from "../supabase";
import { audioPayload, type AudioChoice, type AudioSet, type Variant } from "../kivoxel/audioOptions";
import type { DbScript } from "./analysisData";
import { renderKey, setVideoStatus } from "./analysisData";

export type PreviewJob = { id: string; status: string; error: string | null; created_at: string; payload: { preview?: string; audio_choice?: AudioChoice } | null; result: { preview?: { variant: string; file: string; voice: string | null; music: string | null; sfx: number } } | null };

/** True for a render job that is only an audio preview (it never counts as "the montage" of a video). */
export const isPreviewJob = (j: { step?: string; payload?: unknown }) => j.step === "render" && !!(j.payload as { preview?: unknown } | null)?.preview;

/** The same combination twice is the same preview (no second render). */
const key = (c: AudioChoice) => `${c.voice}-${c.music}-${c.sfx}`;

export async function queuePreview(studioId: string, script: DbScript, set: AudioSet, variant: Variant, choice: AudioChoice): Promise<"queued" | "exists"> {
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, video_id: script.video_id, step: "render", idempotency_key: `render:${script.id}:preview:${variant}:${key(choice)}`, payload: { script_id: script.id, ...audioPayload(set, choice, variant) } });
  if (error?.code === "23505") return "exists";
  if (error) throw new Error(friendlyError(error.message));
  return "queued";
}

/** The real version with this audio: a normal montage (one at a time per video), and the choice as a preference. */
export async function chooseAudio(studioId: string, channelId: string | null, script: DbScript, set: AudioSet, choice: AudioChoice, attempt: number, context: { game?: string | null; variant: Variant }): Promise<void> {
  const open = await supabase.from("yt_jobs").select("id, payload").eq("video_id", script.video_id).eq("step", "render").in("status", ["queued", "running"]).returns<{ id: string; payload: unknown }[]>();
  if (open.error) throw new Error(friendlyError(open.error.message));
  if ((open.data ?? []).some((j) => !isPreviewJob({ step: "render", payload: j.payload }))) throw new Error("Er staat al een montage van deze video in de rij.");
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: studioId, video_id: script.video_id, step: "render", idempotency_key: renderKey(script.id, attempt), payload: { script_id: script.id, ...audioPayload(set, choice, null) } });
  if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
  await setVideoStatus(script.video_id, "rendering", ["idea", "scripted", "review", "approved"]);
  // Fase 31.4: remembered as a signal for comparable productions, never as a rule.
  await supabase.from("studio_events").insert({ studio_id: studioId, channel_id: channelId, action: "audio_keuze", screen: "keuren", metadata: { video_id: script.video_id, variant: context.variant, game: context.game ?? null, ...choice } });
}

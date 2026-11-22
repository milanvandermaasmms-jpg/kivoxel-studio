// 23-11-2026 (Milan): the three review actions and "Opnieuw monteren" for videos that were rejected earlier.
// - Afkeuren: the version stays (render, script, feedback), the video goes to Afgekeurd; no render starts.
// - Afkeuren en opnieuw monteren / Opnieuw monteren: exactly one new montage from Milan's feedback, gericht or volledig.
// One key per feedback (reviewFeedback.feedbackKey / the script version), so a double click, a refresh or a worker retry
// never makes a second job. The new version comes back under Te keuren; an old approval never counts for it.
import { friendlyError, supabase } from "../supabase";
import { setVideoStatus, type DbScript } from "./analysisData";
import { feedbackKey, feedbackNote, fixesFrom, needsNewMoment, plannedChanges, type FeedbackItem, type RemountMode } from "./reviewFeedback";

const saveNote = async (videoId: string, note: string) => {
  const { error } = await supabase.from("yt_videos").update({ review_note: note || null }).eq("id", videoId);
  if (error) throw new Error(friendlyError(error.message));
};

/** Afkeuren: keep this version and its feedback; the video moves to Afgekeurd. Nothing is rendered. */
export async function rejectWithFeedback(videoId: string, items: FeedbackItem[], version: number | null, freeText = ""): Promise<void> {
  const note = items.length ? feedbackNote(items, version) : freeText.trim().slice(0, 500);
  if (!note) throw new Error("Geef aan wat er misgaat: een moment met feedback of een korte reden.");
  await saveNote(videoId, note);
  await setVideoStatus(videoId, "archived", ["review", "approved", "scripted", "rendering"]);
}

export type RemountInput = { studioId: string; videoId: string; script: Pick<DbScript, "id" | "version">; scriptsOfVideo: Pick<DbScript, "version">[]; previousRenderId: string | null; items: FeedbackItem[]; mode: RemountMode };

/** What a targeted correction will change, or why it needs a full montage (shown before Milan confirms). */
export function remountPreview(items: FeedbackItem[], mode: RemountMode): { changes: string[]; unsupported: string[]; newMoment: boolean } {
  if (mode === "volledig") return { changes: [needsNewMoment(items) ? "Ander moment uit de opname, nieuw script en nieuwe montage" : "Nieuw script en nieuwe montage met jouw feedback"], unsupported: [], newMoment: needsNewMoment(items) };
  const { changes, unsupported } = plannedChanges(items, fixesFrom(items));
  return { changes, unsupported, newMoment: false };
}

/**
 * Starts one new montage from Milan's feedback. gericht: the same script, a render with the fixes (refused when nothing
 * in the feedback can be fixed that way: an identical re-render is no new montage). volledig: a new script version
 * (another moment for "verkeerde clip" / "zwakke opening"), which the worker montages itself.
 */
export async function remountWithFeedback(i: RemountInput): Promise<{ mode: RemountMode; changes: string[] }> {
  if (!i.items.length) throw new Error("Geef eerst feedback op een moment.");
  const note = feedbackNote(i.items, i.script.version);
  if (i.mode === "gericht") {
    const fixes = fixesFrom(i.items);
    const { changes, unsupported } = plannedChanges(i.items, fixes);
    if (!changes.length) throw new Error(`Hier helpt geen gerichte correctie (${unsupported.join("; ") || "geen aanwijsbare wijziging"}). Kies "Volledig nieuwe montage".`);
    const { error } = await supabase.from("yt_jobs").insert({ studio_id: i.studioId, video_id: i.videoId, step: "render", idempotency_key: feedbackKey(i.script.id, i.items, "gericht"), payload: { script_id: i.script.id, fixes, feedback: i.items, previous_render: i.previousRenderId, mode: "gericht" } });
    // 23505: the same feedback was already sent (double click, refresh): that one job is enough.
    if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
    await saveNote(i.videoId, note);
    await setVideoStatus(i.videoId, "rendering", ["archived", "review", "approved", "scripted"]);
    return { mode: "gericht", changes };
  }
  const next = Math.max(0, ...i.scriptsOfVideo.map((s) => s.version)) + 1;
  const newMoment = needsNewMoment(i.items);
  const { error } = await supabase.from("yt_jobs").insert({ studio_id: i.studioId, video_id: i.videoId, step: "script", idempotency_key: `script:${i.videoId}:v${next}`, payload: { version: next, remontage: true, note, feedback: i.items, previous_render: i.previousRenderId, new_moment: newMoment, mode: "volledig" } });
  if (error && error.code !== "23505") throw new Error(friendlyError(error.message));
  await saveNote(i.videoId, note);
  await setVideoStatus(i.videoId, "scripted", ["archived", "review", "approved"]);
  return { mode: "volledig", changes: remountPreview(i.items, "volledig").changes };
}

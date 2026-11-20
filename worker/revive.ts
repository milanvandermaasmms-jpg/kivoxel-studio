// 20-11-2026 (Milan: "dit moet standaard gebeuren"): montages that stopped without anyone choosing that are started again
// by the worker itself, once per montage, so nothing hangs in Productie or Mislukt waiting for a person:
// - a montage that failed or was cancelled (and was not stopped because it is no longer needed);
// - a video that says "montage" while no montage is in the queue (a lost job).
// One automatic attempt only: a second failure stays under Mislukt with its reason. Pure function, tested.

export type ReviveVideo = { id: string; studio_id: string; status: string; review_note?: string | null };
export type ReviveJob = { id: string; step: string; status: string; payload: Record<string, unknown> | null; created_at: string; finished_at: string | null; error: string | null };
export type ReviveScript = { id: string; version: number; status: string };
export type Revive = { idempotency_key: string; payload: Record<string, unknown>; why: string };

/** Wait this long after a montage ended before acting: the video status is updated right after the job. */
export const REVIVE_GRACE_MS = 2 * 60_000;
const OPEN = ["queued", "running"];

export function reviveMontage(video: ReviveVideo, jobs: ReviveJob[], scripts: ReviveScript[], now = Date.now()): Revive | null {
  if (video.status !== "rendering" && video.status !== "scripted") return null;
  // Sent back by Milan after the preview: that is his choice, not a stuck montage.
  if (video.status === "scripted" && video.review_note) return null;
  // Something is already happening for this video (a montage, or a new script being written).
  if (jobs.some((j) => (j.step === "render" || j.step === "script") && OPEN.includes(j.status))) return null;
  const current = [...scripts].sort((a, b) => b.version - a.version)[0];
  if (!current || current.status !== "approved") return null;
  const renders = jobs.filter((j) => j.step === "render").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const last = renders[0];
  const ended = last ? Date.parse(last.finished_at ?? last.created_at) : 0;
  if (last && now - ended < REVIVE_GRACE_MS) return null;
  // Already started again by the worker once: leave it to Milan.
  if (last?.payload?.auto_retry) return null;
  // A newer script was approved after this montage: its own montage will be queued by the approval.
  if (last && typeof last.payload?.script_id === "string" && last.payload.script_id !== current.id) return null;
  const payload = { ...(last?.payload ?? {}), script_id: current.id, auto_retry: 1 };
  delete (payload as Record<string, unknown>).qc_retry;
  const key = `render:${current.id}:auto:${last?.id ?? "none"}`;

  if (last && (last.status === "failed" || last.status === "cancelled")) {
    // Stopped on purpose because the video is already on YouTube (or uploaded by hand): never start it again.
    if (/niet meer nodig/i.test(last.error ?? "")) return null;
    return { idempotency_key: key, payload, why: `montage ${last.status === "failed" ? "mislukt" : "geannuleerd"}` };
  }
  // Status says "montage" but nothing is queued: the job got lost.
  if (video.status === "rendering") return { idempotency_key: key, payload, why: "montage stond niet in de rij" };
  return null;
}

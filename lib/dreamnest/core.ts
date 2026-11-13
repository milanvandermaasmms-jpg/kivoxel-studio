// Dreamnest core rules (fase 0). Pure functions, tested; shared by the app and the worker.
// Dreamnest is switched on with FEATURE_DREAMNEST=true. Off (or missing) = the Studio is exactly KIVOXEL as before.

/** Only the exact value "true" switches Dreamnest on, so a typo never turns it on by accident. */
export function dreamnestEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.FEATURE_DREAMNEST?.trim().toLowerCase() === "true";
}

/** Every step of the Dreamnest queue (migration 052). All start with dn_, so they can never match a KIVOXEL step. */
export const DN_STEPS = ["dn_concept", "dn_storyboard", "dn_keyframes", "dn_animate", "dn_music", "dn_timeline", "dn_preview", "dn_render", "dn_qc", "dn_package", "dn_ping"] as const;
export type DnStep = (typeof DN_STEPS)[number];

export const DURATIONS_MIN = [60, 90, 120, 180, 600] as const;

/**
 * KIVOXEL goes first: the Dreamnest lane only starts a new step (or the next chunk of a render) while the KIVOXEL main
 * lane is idle and nothing KIVOXEL is waiting. A running chunk is never interrupted; it is short on purpose.
 */
export function dreamnestMayStart(kivoxel: { mainBusy: boolean; waiting?: number }): boolean {
  return !kivoxel.mainBusy && (kivoxel.waiting ?? 0) === 0;
}

/** A long render is cut into chunks of at most chunkSec (default 120 s), so it can resume and never blocks KIVOXEL long. */
export function planChunks(totalSec: number, chunkSec = 120): { index: number; startSec: number; lengthSec: number }[] {
  if (!(totalSec > 0) || !(chunkSec > 0)) return [];
  const chunks: { index: number; startSec: number; lengthSec: number }[] = [];
  for (let start = 0, i = 0; start < totalSec; start += chunkSec, i++) chunks.push({ index: i, startSec: start, lengthSec: Math.min(chunkSec, totalSec - start) });
  return chunks;
}

/** Budget ceiling per episode: a paid call that would go over it pauses the episode instead of spending. */
export function withinBudget(episode: { budget_cents: number; spent_cents: number }, estimateCents: number): boolean {
  return estimateCents >= 0 && episode.spent_cents + estimateCents <= episode.budget_cents;
}

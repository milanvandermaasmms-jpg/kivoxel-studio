// 22-11-2026 (Milan): "Wachtrij YouTube", the step between Klaar voor YouTube and Live. A video that YouTube does not take
// now (the channel's daily upload limit, or the day quota) is not sent back to "concept": it waits in line, and the worker
// uploads it by itself as soon as it can, in the order the videos came in, per channel. No migration: the publication
// keeps status "queued" (waiting for an upload) and its note (error column) says since when and from when it is tried
// again. Pure functions, used by the worker and the app, tested.

export const WAIT_PREFIX = "Wachtrij YouTube";
const DAY = 24 * 3_600_000;

export type Wait = { since: string; retryAt: string; reason: string };

/** The note on a waiting publication (the error column holds at most 500 characters). */
export function waitNote(w: Wait): string {
  return `${WAIT_PREFIX} (sinds ${w.since}, opnieuw na ${w.retryAt}): ${w.reason}`.slice(0, 500);
}

const NOTE = /^Wachtrij YouTube \(sinds (\S+), opnieuw na (\S+)\): ?([\s\S]*)$/;

/** The wait in a note, or null when the publication does not wait in line. */
export function parseWait(error: string | null | undefined): Wait | null {
  const m = error ? NOTE.exec(error) : null;
  if (!m || Number.isNaN(Date.parse(m[1])) || Number.isNaN(Date.parse(m[2]))) return null;
  return { since: m[1], retryAt: m[2], reason: m[3] };
}

/** A refusal from before the queue existed ("terug naar Klaar voor YouTube"): those videos join the line too. */
export const oldRefusal = (error: string | null | undefined) => !!error && !error.startsWith(WAIT_PREFIX) && /uploadlimiet|YouTube-quotum (van vandaag|voor vandaag|van het Google-project) is op/i.test(error);

/**
 * 24-11-2026 (storing): the old refusals that still have to join the line, oldest first. An archived video stays out:
 * it was skipped, but still counted as "joins the line next round", so the worker stopped every round and nothing of
 * that channel went to YouTube any more (SpawnNado, 23-11-2026 until 24-11-2026).
 */
export function refusalsToQueue<T extends { error: string | null; updated_at: string; yt_videos: { status: string } | null }>(rows: T[]): T[] {
  return rows.filter((x) => oldRefusal(x.error) && x.yt_videos?.status !== "archived").sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

/** The day key of YouTube's quota (midnight Pacific time). */
const pacificDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/**
 * When to try again. The channel's daily upload limit (uploadLimitExceeded): YouTube says "try again in 24 hours".
 * The day quota (of the Google project or of the studio's own counter): just after the next midnight Pacific time.
 */
export function retryAfter(reason: string, now: number): number {
  if (/uploadLimitExceeded|uploadlimiet/i.test(reason)) return now + DAY;
  const today = pacificDay(now);
  let t = now;
  while (pacificDay(t) === today && t - now < DAY + 3_600_000) t += 15 * 60_000;
  return t + 5 * 60_000;
}

/** Short Dutch reason for the page. */
export function waitReason(reason: string): string {
  if (/uploadLimitExceeded|uploadlimiet/i.test(reason)) return "YouTube-daglimiet van dit kanaal bereikt";
  if (/Google-project/i.test(reason)) return "Dagquotum van YouTube (Google-project) op";
  if (/quotum/i.test(reason)) return "Dagquotum van de studio op";
  return reason.slice(0, 120) || "Wacht op YouTube";
}

export type WaitingPub = { id: string; channelId: string; wait: Wait };

/**
 * Who goes next, per channel: only the first in line (oldest "since"), and only when its retry time has passed and the
 * channel has no upload running. The first blocks the rest of its channel, so the order always stays the same.
 */
export function nextInLine(waiting: WaitingPub[], busyChannels: Set<string>, now: number): WaitingPub[] {
  const byChannel = new Map<string, WaitingPub[]>();
  for (const w of waiting) byChannel.set(w.channelId, [...(byChannel.get(w.channelId) ?? []), w]);
  const out: WaitingPub[] = [];
  for (const [channel, list] of byChannel) {
    if (busyChannels.has(channel)) continue;
    const head = [...list].sort(byLine)[0];
    if (Date.parse(head.wait.retryAt) <= now) out.push(head);
  }
  return out;
}

/** Order in line: who came first, then the id so the order never flips. */
export const byLine = (a: { id: string; wait: Wait }, b: { id: string; wait: Wait }) => a.wait.since.localeCompare(b.wait.since) || a.id.localeCompare(b.id);

// A suggested moment for scheduling (fase F, automation 4 from the plan). Only a suggestion: it fills in the field,
// Milan schedules with his own click. Learns from our own videos when there are enough; otherwise it says it is a
// start value. Rhythm: never two videos within 24 hours of each other (2.2, 24.9 "ritme boven pieken").
import { friendlyError, supabase } from "../supabase";
import { amsterdamToIso, isoToAmsterdam } from "./publication";
import { median } from "./signals";

export const START_HOUR = 18;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type SlotInput = {
  /** Moments of videos that are scheduled or already published. */
  taken: string[];
  /** Our published videos with their near-live views, to learn the best hour. */
  performance: { published_at: string; views: number }[];
  now: number;
};
export type Slot = { iso: string; reason: string };

const amsterdamHour = (iso: string) => Number(isoToAmsterdam(iso).slice(11, 13));

export function suggestSlot(input: SlotInput): Slot {
  // Hour: the hour of the video with the most views per day (at least 3 videos older than a day), else the start value.
  const rated = input.performance
    .filter((p) => input.now - Date.parse(p.published_at) >= DAY)
    .map((p) => ({ ...p, perDay: p.views / Math.max(1, (input.now - Date.parse(p.published_at)) / DAY) }));
  let hour = START_HOUR;
  let why = `startwaarde ${START_HOUR}:00 (nog te weinig eigen video's om van te leren)`;
  if (rated.length >= 3) {
    const best = rated.reduce((a, b) => (b.perDay > a.perDay ? b : a));
    const m = median(rated.map((r) => r.perDay)) ?? 0;
    hour = amsterdamHour(best.published_at);
    why = `het uur van je best lopende video (${Math.round(best.perDay)} views per dag; mediaan ${Math.round(m)}), uit ${rated.length} eigen video's`;
  }
  // Day: the first day from now at that hour that is at least 2 hours ahead and 24 hours away from other videos.
  const today = isoToAmsterdam(new Date(input.now).toISOString()).slice(0, 10);
  for (let d = 0; d < 60; d++) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) + d * DAY).toISOString().slice(0, 10);
    const iso = amsterdamToIso(`${day}T${String(hour).padStart(2, "0")}:00`)!;
    const t = Date.parse(iso);
    if (t < input.now + 2 * HOUR) continue;
    if (input.taken.some((x) => Math.abs(Date.parse(x) - t) < DAY)) continue;
    return { iso, reason: `${why}; minstens 24 uur na of voor je andere video's` };
  }
  return { iso: amsterdamToIso(`${today}T${String(hour).padStart(2, "0")}:00`)!, reason: why };
}

/** What the suggestion needs: the moments already taken and the views of our published videos. */
export async function loadSlotInput(studioId: string): Promise<SlotInput> {
  const [pubs, snaps] = await Promise.all([
    supabase.from("yt_publications").select("status, publish_at, updated_at").eq("studio_id", studioId).in("status", ["scheduled", "published"]).returns<{ status: string; publish_at: string | null; updated_at: string }[]>(),
    supabase.from("yt_video_snapshots").select("youtube_video_id, published_at, views, taken_at").eq("studio_id", studioId).gte("taken_at", new Date(Date.now() - 2 * DAY).toISOString()).order("taken_at", { ascending: false }).limit(500).returns<{ youtube_video_id: string; published_at: string | null; views: number; taken_at: string }[]>(),
  ]);
  if (pubs.error) throw new Error(friendlyError(pubs.error.message));
  const latest = new Map<string, { published_at: string; views: number }>();
  for (const s of snaps.data ?? []) if (s.published_at && !latest.has(s.youtube_video_id)) latest.set(s.youtube_video_id, { published_at: s.published_at, views: Number(s.views) });
  const taken = [...(pubs.data ?? []).map((p) => p.publish_at ?? (p.status === "published" ? p.updated_at : null)).filter((x): x is string => !!x), ...[...latest.values()].map((v) => v.published_at)];
  return { taken, performance: [...latest.values()], now: Date.now() };
}

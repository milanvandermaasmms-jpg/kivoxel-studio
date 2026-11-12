// Performance report per video after 24 hours, 72 hours and 7 days (fase F, plan.md). Comes from the snapshots the
// worker already keeps every hour (migration 041): no extra quota, nothing invented. A milestone counts only when a
// snapshot exists within 12 hours after it; otherwise it says "niet gemeten" (for example while the pc was off).
import { friendlyError, supabase } from "../supabase";
import { median } from "./signals";

export const MILESTONES = [
  { key: "h24", label: "na 24 uur", ms: 24 * 3_600_000 },
  { key: "h72", label: "na 72 uur", ms: 72 * 3_600_000 },
  { key: "d7", label: "na 7 dagen", ms: 7 * 24 * 3_600_000 },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]["key"];
const TOLERANCE_MS = 12 * 3_600_000;

export type Point = { taken_at: string; views: number; likes: number | null; comments: number | null };
export type Milestone = { key: MilestoneKey; label: string; state: "measured" | "missing" | "future"; views: number | null; likes: number | null; comments: number | null; channelMedian: number | null; others: number };
export type Report = { youtube_video_id: string; published_at: string; milestones: Milestone[] };

/** The first snapshot at or after the milestone, within the tolerance. */
export function pointAt(points: Point[], publishedAt: string, ms: number): Point | null {
  const at = Date.parse(publishedAt) + ms;
  return [...points].sort((a, b) => a.taken_at.localeCompare(b.taken_at)).find((p) => Date.parse(p.taken_at) >= at && Date.parse(p.taken_at) <= at + TOLERANCE_MS) ?? null;
}

/** Reports for all videos, each milestone compared with the median of the other videos at the same age. */
export function buildReports(videos: { youtube_video_id: string; published_at: string | null; points: Point[] }[], now = Date.now()): Report[] {
  const withPub = videos.filter((v): v is typeof v & { published_at: string } => !!v.published_at);
  const at = new Map(withPub.map((v) => [v.youtube_video_id, Object.fromEntries(MILESTONES.map((m) => [m.key, pointAt(v.points, v.published_at, m.ms)])) as Record<MilestoneKey, Point | null>]));
  return withPub.map((v) => ({
    youtube_video_id: v.youtube_video_id,
    published_at: v.published_at,
    milestones: MILESTONES.map((m) => {
      const p = at.get(v.youtube_video_id)![m.key];
      const others = withPub.filter((o) => o.youtube_video_id !== v.youtube_video_id).map((o) => at.get(o.youtube_video_id)![m.key]?.views).filter((x): x is number => typeof x === "number");
      const due = Date.parse(v.published_at) + m.ms;
      const state: Milestone["state"] = p ? "measured" : due > now ? "future" : "missing";
      return { key: m.key, label: m.label, state, views: p?.views ?? null, likes: p?.likes ?? null, comments: p?.comments ?? null, channelMedian: others.length >= 3 ? median(others) : null, others: others.length };
    }),
  }));
}

/** The snapshots around the three milestones of each video (at most 20 newest videos; a few small queries). */
export async function loadReports(studioId: string, videos: { youtube_video_id: string; published_at: string | null }[]): Promise<Report[]> {
  const list = videos.filter((v) => v.published_at).slice(0, 20);
  const withPoints = await Promise.all(
    list.map(async (v) => {
      const from = new Date(Date.parse(v.published_at!) + MILESTONES[0].ms).toISOString();
      const to = new Date(Date.parse(v.published_at!) + MILESTONES[2].ms + TOLERANCE_MS).toISOString();
      const { data, error } = await supabase.from("yt_video_snapshots").select("taken_at, views, likes, comments").eq("studio_id", studioId).eq("youtube_video_id", v.youtube_video_id).gte("taken_at", from).lte("taken_at", to).order("taken_at").limit(300).returns<Point[]>();
      if (error) throw new Error(friendlyError(error.message));
      return { ...v, points: (data ?? []).map((p) => ({ ...p, views: Number(p.views), likes: p.likes === null ? null : Number(p.likes), comments: p.comments === null ? null : Number(p.comments) })) };
    }),
  );
  return buildReports(withPoints);
}

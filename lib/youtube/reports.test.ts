import { describe, expect, it } from "vitest";
import { buildReports, pointAt, type Point } from "./reports";

const pub = "2026-11-10T12:00:00Z";
const p = (hoursAfter: number, views: number): Point => ({ taken_at: new Date(Date.parse(pub) + hoursAfter * 3_600_000).toISOString(), views, likes: 1, comments: 0 });

describe("performance report after 24 hours, 72 hours and 7 days", () => {
  it("takes the first snapshot after the milestone, and only within 12 hours", () => {
    expect(pointAt([p(23, 50), p(25, 60), p(26, 70)], pub, 24 * 3_600_000)?.views).toBe(60);
    expect(pointAt([p(40, 90)], pub, 24 * 3_600_000)).toBeNull();
  });

  it("says measured, not measured (pc was off) or still to come, and compares with at least 3 other videos", () => {
    const now = Date.parse(pub) + 80 * 3_600_000;
    const other = (id: string, v24: number) => ({ youtube_video_id: id, published_at: pub, points: [p(24, v24)] });
    const reports = buildReports([{ youtube_video_id: "mine", published_at: pub, points: [p(24.5, 120)] }, other("a", 40), other("b", 60), other("c", 80)], now);
    const mine = reports[0].milestones;
    expect(mine[0]).toMatchObject({ label: "na 24 uur", state: "measured", views: 120, channelMedian: 60, others: 3 });
    expect(mine[1]).toMatchObject({ label: "na 72 uur", state: "missing", views: null });
    expect(mine[2]).toMatchObject({ label: "na 7 dagen", state: "future" });
    expect(buildReports([{ youtube_video_id: "solo", published_at: pub, points: [p(24, 5)] }], now)[0].milestones[0].channelMedian).toBeNull();
  });
});

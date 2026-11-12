import { describe, expect, it } from "vitest";
import { biggestDrop, curvePath, dayEarlier, engagedShare, videoRows, type VideoSnap } from "./stats";

const snap = (taken_at: string, views: number, extra: Partial<VideoSnap> = {}): VideoSnap => ({
  youtube_video_id: "vid1",
  video_id: null,
  taken_at,
  title: "Minecraft: test",
  published_at: "2026-11-10T10:00:00Z",
  duration_s: 18,
  views,
  likes: 1,
  comments: 0,
  a_views: null,
  engaged_views: null,
  watch_minutes: null,
  avg_view_duration_s: null,
  avg_view_pct: null,
  subscribers_gained: null,
  retention: null,
  analytics_until: null,
  ...extra,
});

describe("growth from our own snapshots", () => {
  it("finds the snapshot about a day earlier, not a too recent one", () => {
    const snaps = [{ taken_at: "2026-11-12T12:00:00Z" }, { taken_at: "2026-11-12T06:00:00Z" }, { taken_at: "2026-11-11T13:00:00Z" }, { taken_at: "2026-11-10T12:00:00Z" }];
    expect(dayEarlier(snaps, "2026-11-12T12:00:00Z")).toEqual({ taken_at: "2026-11-11T13:00:00Z" });
    expect(dayEarlier(snaps.slice(0, 2), "2026-11-12T12:00:00Z")).toBeNull();
  });

  it("combines the newest counts with the newest analytics and curve, and marks Shorts", () => {
    const rows = videoRows([
      snap("2026-11-12T12:00:00Z", 150),
      snap("2026-11-12T06:00:00Z", 130, { a_views: 100, engaged_views: 80, avg_view_pct: 83.3, analytics_until: "2026-11-11", retention: [{ at: 0, ratio: 1 }, { at: 1, ratio: 0.5 }] }),
      snap("2026-11-11T12:00:00Z", 100),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ views: 150, views24h: 50, a_views: 100, engaged_views: 80, avg_view_pct: 83.3, analytics_until: "2026-11-11", isShort: true });
    expect(rows[0].retention).toHaveLength(2);
    expect(engagedShare(rows[0])).toBe(0.8);
  });
});

describe("retention curve", () => {
  it("names the moment most viewers leave and draws the line", () => {
    const curve = [{ at: 0, ratio: 1 }, { at: 0.1, ratio: 0.6 }, { at: 0.5, ratio: 0.5 }, { at: 1, ratio: 0.45 }];
    const drop = biggestDrop(curve)!;
    expect(drop.at).toBe(0.1);
    expect(drop.drop).toBeCloseTo(0.4);
    expect(biggestDrop([{ at: 0, ratio: 1 }])).toBeNull();
    expect(curvePath([{ at: 0, ratio: 1.2 }, { at: 1, ratio: 0 }], 100, 30)).toBe("M0.0,0.0 L100.0,30.0");
  });
});

import { describe, expect, it } from "vitest";
import type { YouTube } from "./youtube.ts";
import { collect } from "./statsSync.ts";
import { createStats, isoDurationS, reportRows, windowTotals, type Stats } from "./youtubeStats.ts";

describe("reading YouTube's answers", () => {
  it("reads durations, report rows and day windows", () => {
    expect(isoDurationS("PT1M5S")).toBe(65);
    expect(isoDurationS("PT18S")).toBe(18);
    expect(isoDurationS("P1DT2H")).toBe(93600);
    expect(reportRows({ columnHeaders: [{ name: "video" }, { name: "views" }], rows: [["abc", 12]] })).toEqual([{ video: "abc", views: 12 }]);
    const days = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, views: 1, engagedViews: 1, minutes: 2, subscribersGained: i === 9 ? 1 : 0 }));
    expect(windowTotals(days, 7)).toEqual({ views: 7, engagedViews: 7, minutes: 14, subscribersGained: 1, until: "2026-11-10" });
    expect(windowTotals([{ day: "2026-11-01", views: 3, engagedViews: null, minutes: 1, subscribersGained: 0 }], 7).engagedViews).toBeNull();
  });
});

describe("asking YouTube", () => {
  function setup(answers: Record<string, unknown>, status = 200) {
    const urls: string[] = [];
    const spent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      const u = String(url);
      urls.push(u);
      const key = Object.keys(answers).find((k) => u.includes(k));
      return new Response(JSON.stringify(key ? answers[key] : {}), { status: key ? 200 : status });
    }) as typeof fetch;
    const yt = { accessToken: async () => "t", spend: async (c: string) => void spent.push(c) } as unknown as YouTube;
    return { stats: createStats({ yt, fetch: fetchFn, now: () => Date.parse("2026-11-12T12:00:00Z") }), urls, spent };
  }

  it("reads channel counts and the per-video analytics with a filter on our videos", async () => {
    const { stats, urls, spent } = setup({
      "channels?part=statistics": { items: [{ statistics: { subscriberCount: "2", viewCount: "120", videoCount: "1", hiddenSubscriberCount: false } }] },
      "v2/reports": { columnHeaders: [{ name: "video" }, { name: "views" }, { name: "engagedViews" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }, { name: "subscribersGained" }, { name: "likes" }, { name: "comments" }], rows: [["vid1", 100, 80, 25.5, 15, 83.3, 1, 4, 0]] },
    });
    expect(await stats.channel()).toEqual({ subscribers: 2, views: 120, videos: 1, hiddenSubscribers: false });
    expect(await stats.videoAnalytics(["vid1"], "2026-11-12")).toEqual([{ videoId: "vid1", views: 100, engagedViews: 80, minutes: 25.5, avgViewDurationS: 15, avgViewPct: 83.3, subscribersGained: 1, likes: 4, comments: 0 }]);
    const q = new URL(urls[1]).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ ids: "channel==MINE", dimensions: "video", filters: "video==vid1", startDate: "2026-11-12", endDate: "2026-11-12", sort: "-views" });
    expect(spent).toEqual(["channels.list"]);
  });

  it("explains a missing analytics permission", async () => {
    const { stats } = setup({}, 403);
    await expect(stats.daily("2026-10-01")).rejects.toThrow(/koppel YouTube opnieuw/);
  });
});

describe("one snapshot", () => {
  const fake = (analyticsFails = false): Stats =>
    ({
      channel: async () => ({ subscribers: 2, views: 120, videos: 1, hiddenSubscribers: false }),
      uploads: async () => [{ videoId: "vid1", title: "Minecraft: test", publishedAt: "2026-11-10T10:00:00Z" }],
      videos: async () => [{ videoId: "vid1", views: 120, likes: 5, comments: 1, durationS: 18 }],
      daily: async () => {
        if (analyticsFails) throw new Error("Geen toestemming voor statistieken: koppel YouTube opnieuw.");
        return [
          { day: "2026-11-10", views: 40, engagedViews: 30, minutes: 10, subscribersGained: 1 },
          { day: "2026-11-11", views: 60, engagedViews: 50, minutes: 14, subscribersGained: 0 },
        ];
      },
      videoAnalytics: async () => [{ videoId: "vid1", views: 100, engagedViews: 80, minutes: 24, avgViewDurationS: 15, avgViewPct: 83.33, subscribersGained: 1, likes: 5, comments: 1 }],
      retention: async () => [{ at: 0, ratio: 1, relative: 0.5 }, { at: 0.5, ratio: 0.7, relative: 0.6 }],
    }) as unknown as Stats;

  it("combines near-live counts with delayed analytics and the retention curve", async () => {
    const s = await collect(fake(), { analytics: true, now: Date.parse("2026-11-12T12:00:00Z") });
    expect(s.channel).toMatchObject({ subscribers: 2, views_total: 120, views_7d: 100, views_28d: 100, engaged_views_28d: 80, watch_minutes_28d: 24, subscribers_gained_28d: 1, analytics_until: "2026-11-11", analytics_error: null });
    expect(s.videos[0]).toMatchObject({ youtube_video_id: "vid1", views: 120, likes: 5, a_views: 100, engaged_views: 80, avg_view_pct: 83.3, retention: [{ at: 0, ratio: 1, relative: 0.5 }, { at: 0.5, ratio: 0.7, relative: 0.6 }], analytics_until: "2026-11-11" });
  });

  it("keeps the counts when analytics are not allowed yet, and says why", async () => {
    const s = await collect(fake(true), { analytics: true, now: Date.now() });
    expect(s.videos[0]).toMatchObject({ views: 120, a_views: null });
    expect(s.channel.analytics_error).toMatch(/koppel YouTube opnieuw/);
  });

  it("only counts when no analytics run is due", async () => {
    const s = await collect(fake(), { analytics: false, now: Date.now() });
    expect(s.channel.views_7d).toBeNull();
    expect(s.videos[0].retention).toBeNull();
  });
});

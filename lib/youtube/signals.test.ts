import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { dropMoment, median, signals, viewsPerDay, type Production } from "./signals";
import type { VideoRow } from "./stats";

const NOW = Date.parse("2026-11-20T12:00:00Z");
let n = 0;
const row = (extra: Partial<VideoRow> = {}): VideoRow => ({
  youtube_video_id: `vid${String(++n).padStart(8, "0")}`,
  video_id: null,
  taken_at: "2026-11-20T12:00:00Z",
  title: `Video ${n}`,
  published_at: "2026-11-01T12:00:00Z",
  duration_s: 20,
  views: 1000,
  likes: 10,
  comments: 1,
  a_views: 1000,
  engaged_views: 500,
  watch_minutes: 100,
  avg_view_duration_s: 10,
  avg_view_pct: 50,
  subscribers_gained: 2,
  retention: null,
  analytics_until: "2026-11-18",
  views24h: 10,
  isShort: true,
  ...extra,
});
const kinds = (rows: VideoRow[], prod: Record<string, Production> = {}) => signals(rows, prod, NOW).map((s) => s.kind);

describe("signals only on real numbers and never from one video", () => {
  it("helpers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(viewsPerDay({ views: 100, published_at: "2026-11-18T12:00:00Z" }, NOW)).toBe(50);
  });

  it("says nothing with too few videos to compare", () => {
    expect(kinds([row({ views24h: 500 }), row(), row()])).toEqual([]);
  });

  it("spots a video that grows faster than normal", () => {
    const s = signals([row({ views24h: 80, title: "Snel" }), row(), row(), row()], {}, NOW);
    expect(s.map((x) => x.kind)).toEqual(["growth"]);
    expect(s[0].rule).toContain("+80 views in 24 uur; de mediaan van je andere 3 video's is +10");
  });

  it("spots a strong Short by engaged views, and many subscribers", () => {
    expect(kinds([row({ engaged_views: 700 }), row(), row(), row()])).toEqual(["short_strong"]);
    expect(kinds([row({ subscribers_gained: 10 }), row(), row(), row()])).toEqual(["subscribers"]);
  });

  it("warns about a new video that is clearly weaker, with a careful note", () => {
    const s = signals([row({ published_at: "2026-11-18T12:00:00Z", views: 20, views24h: null }), row(), row(), row()], {}, NOW);
    expect(s.map((x) => x.kind)).toEqual(["new_weak"]);
    expect(s[0].rule).toMatch(/aanwijzing, niet als oordeel/);
  });

  it("compares hook types and formats as groups of at least two", () => {
    const rows = [row({ video_id: "a", engaged_views: 700 }), row({ video_id: "b", engaged_views: 700 }), row({ video_id: "c" }), row({ video_id: "d" }), row({ video_id: "e" })];
    const prod: Record<string, Production> = {
      a: { format: "A", hookType: "cold_open", segments: [] },
      b: { format: "A", hookType: "cold_open", segments: [] },
      c: { format: "B", hookType: "bold_claim", segments: [] },
      d: { format: "B", hookType: "bold_claim", segments: [] },
      e: { format: "B", hookType: null, segments: [] },
    };
    const s = signals(rows, prod, NOW).filter((x) => x.kind === "hook" || x.kind === "format");
    expect(s.map((x) => x.title)).toEqual(["Mogelijk succesvolle hook: Cold open (hoogtepunt eerst)", "Format Bijna-dood-moment lijkt beter te werken"]);
  });
});

describe("where viewers leave", () => {
  const segments: Segment[] = [
    { part: "build", src_start_ms: 0, src_end_ms: 5000, out_start_ms: 0, speed: 1, effects: [], note: "zombies komen dichterbij" },
    { part: "payoff", src_start_ms: 5000, src_end_ms: 20000, out_start_ms: 5000, speed: 1, effects: [], note: "ontsnapping" },
  ];
  const curve = [{ at: 0, ratio: 1 }, { at: 0.2, ratio: 0.9 }, { at: 0.35, ratio: 0.5 }, { at: 1, ratio: 0.4 }];

  it("names the fragment that plays at the biggest drop", () => {
    expect(dropMoment({ retention: curve, duration_s: 20 }, { format: "A", hookType: null, segments })).toMatchObject({ atMs: 7000, fragment: "fragment 2 (ontknoping): ontsnapping" });
    expect(dropMoment({ retention: curve, duration_s: 20 }, { format: "A", hookType: "cold_open", segments })?.fragment).toBe("fragment 2 (ontknoping): ontsnapping");
    expect(dropMoment({ retention: [{ at: 0, ratio: 1 }, { at: 0.05, ratio: 0.5 }], duration_s: 20 }, { format: "A", hookType: "cold_open", segments })?.fragment).toBe("de cold open (hoogtepunt vooraan)");
    expect(dropMoment({ retention: curve, duration_s: 20 }, undefined)).toMatchObject({ atMs: 7000, fragment: null });
    expect(dropMoment({ retention: null, duration_s: 20 }, undefined)).toBeNull();
  });
});

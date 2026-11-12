import { describe, expect, it } from "vitest";
import { suggestSlot } from "./slot";

const NOW = Date.parse("2026-11-12T20:00:00Z"); // 21:00 in Amsterdam

describe("suggested moment for scheduling", () => {
  it("uses the start value until there is enough own data, and skips today when it is too late", () => {
    const s = suggestSlot({ taken: [], performance: [], now: NOW });
    expect(s.iso).toBe("2026-11-13T17:00:00.000Z"); // tomorrow 18:00 Amsterdam
    expect(s.reason).toMatch(/startwaarde 18:00/);
  });

  it("keeps 24 hours between videos", () => {
    const s = suggestSlot({ taken: ["2026-11-13T17:00:00.000Z"], performance: [], now: NOW });
    expect(s.iso).toBe("2026-11-14T17:00:00.000Z");
  });

  it("learns the hour of the best video from at least three own videos", () => {
    const perf = [
      { published_at: "2026-11-01T07:00:00.000Z", views: 300 }, // 08:00 Amsterdam, about 26 per day
      { published_at: "2026-11-02T17:00:00.000Z", views: 100 },
      { published_at: "2026-11-03T17:00:00.000Z", views: 90 },
    ];
    const s = suggestSlot({ taken: [], performance: perf, now: NOW });
    expect(s.iso).toBe("2026-11-13T07:00:00.000Z"); // tomorrow 08:00 Amsterdam
    expect(s.reason).toMatch(/uit 3 eigen video's/);
  });
});

import { describe, expect, it } from "vitest";
import { byDay, calendarMoment } from "./publicationData";

describe("content calendar", () => {
  it("uses the planned time or the publication time, grouped per Amsterdam day", () => {
    expect(calendarMoment({ status: "scheduled", publish_at: "2026-11-14T17:00:00Z", updated_at: "x" })).toBe("2026-11-14T17:00:00Z");
    expect(calendarMoment({ status: "published", publish_at: null, updated_at: "2026-11-12T20:00:00Z" })).toBe("2026-11-12T20:00:00Z");
    expect(calendarMoment({ status: "draft", publish_at: null, updated_at: "2026-11-12T20:00:00Z" })).toBeNull();
    const days = byDay([{ at: "2026-11-14T23:30:00Z" }, { at: "2026-11-14T10:00:00Z" }, { at: "2026-11-13T09:00:00Z" }], (x) => x.at);
    expect(days.map((d) => [d.day, d.items.length])).toEqual([["2026-11-13", 1], ["2026-11-14", 1], ["2026-11-15", 1]]);
  });
});

import { describe, expect, it } from "vitest";
import { groupByProject, groupMeta } from "./projectGroups.ts";

const recs = [
  { id: "r1", label: "the one who watches" },
  { id: "r2", label: "14-11 23" },
];
const videos = [
  { id: "p3", recording_id: "r1", plan_key: "r1:C:part:3/5:0-1" },
  { id: "p1", recording_id: "r1", plan_key: "r1:C:part:1/5:0-1" },
  { id: "s1", recording_id: "r1", plan_key: "r1:A:m1" },
  { id: "x1", recording_id: "r2", plan_key: "r2:B:m2" },
  { id: "n1", recording_id: null, plan_key: null },
];
const item = (videoId: string, kind: "short" | "long", createdAt: string) => ({ videoId, kind, createdAt });

describe("Klaar voor YouTube per project", () => {
  const groups = groupByProject(
    [item("p3", "long", "2026-11-14T10:03"), item("s1", "short", "2026-11-14T10:05"), item("x1", "short", "2026-11-14T11:00"), item("p1", "long", "2026-11-14T10:01"), item("n1", "long", "2026-11-14T12:00")],
    videos,
    recs,
  );
  it("puts the videos of one recording together, newest project first, loose videos last", () => {
    expect(groups.map((g) => g.label)).toEqual(["14-11 23", "the one who watches", "Zonder opname"]);
  });
  it("shows the parts in story order, then the rest", () => {
    expect(groups[1].items.map((i) => i.videoId)).toEqual(["p1", "p3", "s1"]);
    expect(groups[1].parts).toBe(5);
  });
  it("describes a group in plain words", () => {
    expect(groupMeta(groups[1])).toBe("2 lange video's van 5 delen · 1 Short");
    expect(groupMeta(groups[0])).toBe("1 Short");
  });
});

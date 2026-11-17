import { describe, expect, it } from "vitest";
import { motifCues } from "./media";

describe("motifCues (eigen KIVOXEL-motief, 18-11-2026)", () => {
  it("plays at the start of a Short, and at start and end of a long video", () => {
    expect(motifCues({ short: true, durationMs: 30_000, motifMs: 3300, music: true, voice: false })).toEqual([{ atMs: 0, db: -8 }]);
    expect(motifCues({ short: false, durationMs: 600_000, motifMs: 3300, music: true, voice: false })).toEqual([{ atMs: 0, db: -8 }, { atMs: 596_700, db: -8 }]);
  });
  it("is softer under a voice and absent in game-only mode", () => {
    expect(motifCues({ short: true, durationMs: 30_000, motifMs: 3300, music: false, voice: true })[0].db).toBe(-14);
    expect(motifCues({ short: true, durationMs: 30_000, motifMs: 3300, music: false, voice: false })).toEqual([]);
  });
});

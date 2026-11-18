import { describe, expect, it } from "vitest";
import { motifCues } from "./media";

describe("motifCues (Milan, 18-11-2026 23:15: no motif anywhere)", () => {
  it("never adds the motif, in Shorts or long videos", () => {
    expect(motifCues({ short: true, durationMs: 30_000, motifMs: 3300, music: true, voice: false })).toEqual([]);
    expect(motifCues({ short: false, durationMs: 600_000, motifMs: 3300, music: true, voice: true })).toEqual([]);
  });
});

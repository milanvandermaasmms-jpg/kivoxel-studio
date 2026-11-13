import { describe, expect, it } from "vitest";
import { parseAnalysis } from "../lib/youtube/analysis";
import { buildTimeline } from "../lib/youtube/footage";
import { dropDead } from "./queue";

// TESTDATA: moments as the analysis service would return them, no real gameplay.
describe("dropping moments in dead parts (fase 3)", () => {
  it("keeps real moments and explains the dropped one", () => {
    const parsed = parseAnalysis(
      {
        moments: [
          { kind: "near_death", start_ms: 10_000, end_ms: 30_000, peak_ms: 25_000, reason: "TESTDATA", score: 80, has_context: true, has_payoff: true },
          { kind: "rare_find", start_ms: 60_000, end_ms: 80_000, peak_ms: 70_000, reason: "TESTDATA", score: 70, has_context: true, has_payoff: true },
        ],
      },
      120_000,
    );
    const timeline = buildTimeline({ version: 1, durationMs: 120_000, sceneCutsMs: [], freezes: [{ startMs: 55_000, endMs: 90_000 }], blacks: [], silences: [], loudness: [] });
    const out = dropDead(parsed, timeline);
    expect(out.moments.map((m) => m.kind)).toEqual(["near_death"]);
    expect(out.rejected).toEqual(["rare_find 60 s: piek valt in een stilstaand of zwart stuk (0:55-1:30)"]);
  });
});

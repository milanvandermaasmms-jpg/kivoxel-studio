import { describe, expect, it } from "vitest";
import { planVideos } from "../youtube/analysis";
import type { EventTimeline, GameEvent } from "./events";
import { momentKind, momentsFromTimeline } from "./freeMoments";

const ev = (id: string, peak: number, payoff: number, type: GameEvent["type"], kind: GameEvent["kind"] = "damage", description = ""): GameEvent => ({ id, kind, type, t_start: peak - 4000, t_peak: peak, t_end: peak + 3000, intensity: 0.8, payoff, description, t_thumb: peak, sources: [] });
const tl = (events: GameEvent[]): EventTimeline => ({ version: 1, durationMs: 600_000, generatedAt: "", engine: "free", events, dead: [], health: [] });

describe("analysis without AI", () => {
  it("maps events to the analysis' moment kinds", () => {
    expect(momentKind(ev("d", 1, 90, "fail", "death"))).toBe("mistake");
    expect(momentKind(ev("l", 1, 50, "bijna_dood", "low_health"))).toBe("near_death");
    expect(momentKind(ev("g", 1, 50, "geluk", "ai_moment"))).toBe("rare_find");
  });
  it("takes the strongest typed events, 15 s apart, in English, and the studio plans Shorts from them", () => {
    const t = tl([
      ev("a", 100_000, 95, "fail", "death"),
      ev("b", 105_000, 70, "bijna_dood", "damage", "Schade: van 10 naar 8 hartjes"),
      ev("c", 300_000, 60, "bijna_dood", "low_health", "Nog maar 3,5 hartjes"),
      ev("d", 400_000, 30, "fail"),
      ev("e", 450_000, 80, null, "audio_peak"),
    ]);
    const m = momentsFromTimeline(t, 600_000);
    expect(m.map((x) => x.peakMs)).toEqual([100_000, 300_000]);
    expect(m[1].reason).toBe("only 3.5 hearts left, one more hit could end it");
    expect(m.every((x) => x.peakMs - x.startMs >= 9000 && x.endMs - x.peakMs >= 3000)).toBe(true);
    expect(planVideos(m, 600_000, (x) => `${x.kind}:${x.startMs}`).length).toBeGreaterThanOrEqual(2);
  });
});

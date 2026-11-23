import { describe, expect, it } from "vitest";
import type { EventTimeline, GameEvent } from "./events";
import { deadShare, producerGate } from "./producerGate";

const ev = (over: Partial<GameEvent> = {}): GameEvent => ({ id: "e1", kind: "ai_moment", type: "geluk", t_start: 95_000, t_peak: 100_000, t_end: 103_000, intensity: 1, payoff: 80, description: "Opens a chest full of diamonds", t_thumb: 99_000, sources: [], ...over });
const tl = (over: Partial<EventTimeline> = {}): EventTimeline => ({ version: 1, durationMs: 300_000, generatedAt: "", engine: "free", events: [ev(), ev({ id: "e0", t_peak: 85_000, payoff: 50 })], dead: [], health: [], ...over });

describe("producer-poort vóór de montage", () => {
  it("GROEN LICHT when the moment, the opening and the outcome are gameplay and something leads up to it", () => {
    const g = producerGate({ event: ev(), timeline: tl(), sourceOnPc: true });
    expect(g.status).toBe("GROEN LICHT");
    expect(g.checks.find((c) => c.key === "originaliteit")!.verdict).toBe("ONBEWEZEN");
  });

  it("AFGEKEURD when the outcome is a menu (the Netherite Trim Armor Box case): no production time", () => {
    const g = producerGate({ event: ev(), timeline: tl({ dead: [{ startMs: 100_000, endMs: 104_000, why: "menu" }] }), sourceOnPc: true });
    expect(g.status).toBe("AFGEKEURD");
    expect(g.checks.find((c) => c.key === "einde")!.verdict).toBe("GEZAKT");
    expect(g.directions.length).toBeGreaterThan(0);
  });

  it("AFGEKEURD for a mostly-menu moment, a recording that stops at the peak, or a missing source", () => {
    expect(producerGate({ event: ev({ description: "Shulker box (grotendeels menu/inventaris: 80%)" }), timeline: tl(), sourceOnPc: true }).status).toBe("AFGEKEURD");
    expect(producerGate({ event: ev({ t_peak: 299_500 }), timeline: tl(), sourceOnPc: true }).status).toBe("AFGEKEURD");
    expect(producerGate({ event: ev(), timeline: tl(), sourceOnPc: false }).status).toBe("AFGEKEURD");
  });

  it("PROEFOPNAME when nothing is measured in the build-up or the moment is middling", () => {
    expect(producerGate({ event: ev(), timeline: tl({ events: [ev()] }), sourceOnPc: true }).status).toBe("PROEFOPNAME");
    expect(producerGate({ event: ev({ payoff: 50 }), timeline: tl(), sourceOnPc: true }).status).toBe("PROEFOPNAME");
  });

  it("a death screen is the outcome, even though it stands still", () => {
    const g = producerGate({ event: ev({ kind: "death", type: "fail" }), timeline: tl({ dead: [{ startMs: 100_000, endMs: 104_000, why: "still" }] }), sourceOnPc: true });
    expect(g.checks.find((c) => c.key === "einde")!.verdict).toBe("GESLAAGD");
  });

  it("measures how much of a stretch is dead", () => {
    expect(deadShare([{ startMs: 0, endMs: 500, why: "menu" }, { startMs: 500, endMs: 1000, why: "quiet" }], 0, 1000)).toBe(0.5);
  });
});

describe("kandidaatfragmenten vóór de montage", () => {
  it("ranks the strongest moments with their verdict and says when there is no sound basis", async () => {
    const { rankCandidates } = await import("./producerGate");
    const good = rankCandidates(tl());
    expect(good.candidates[0]).toMatchObject({ rank: 1, peakMs: 100_000, status: "GROEN LICHT" });
    expect(good.enough).toBe(true);
    const menu = rankCandidates(tl({ events: [ev()], dead: [{ startMs: 99_000, endMs: 104_000, why: "menu" }] }));
    expect(menu.enough).toBe(false);
  });
});

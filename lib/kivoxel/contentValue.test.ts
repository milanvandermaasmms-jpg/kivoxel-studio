import { describe, expect, it } from "vitest";
import { contentValue, reviewDecision } from "./contentValue";
import type { EventTimeline, GameEvent } from "./events";

const ev = (o: Partial<GameEvent>): GameEvent => ({ id: Math.random().toString(36), kind: "audio_peak", type: "grap", t_start: 0, t_peak: 60_000, t_end: 62_000, intensity: 0.5, payoff: 50, description: "Hard geluid (+20 LU)", t_thumb: 60_000, sources: ["geluid:piek"], ...o });
const tl = (events: GameEvent[], dead: EventTimeline["dead"] = []): EventTimeline => ({ version: 1, durationMs: 600_000, generatedAt: "", engine: "free", events, dead, health: [] });

describe("Content Value Gate", () => {
  it("rejects a moment with nothing measured or with mostly dead picture", () => {
    expect(contentValue(tl([]), 60_000).level).toBe("afgewezen");
    const menu = contentValue(tl([ev({ kind: "death", sources: ["beeld:doodscherm"] })], [{ startMs: 50_000, endMs: 62_000, why: "menu" }]), 60_000);
    expect(menu.level).toBe("afgewezen");
    expect(menu.reasons[0]).toMatch(/menu, zwart of stilstaand/);
  });

  it("only a loud sound, or only a Gemini claim: not confirmed (the AI check of the export must confirm it)", () => {
    expect(contentValue(tl([ev({})]), 60_000).level).toBe("onbevestigd");
    expect(contentValue(tl([ev({ kind: "ai_moment", sources: ["ai:escape"], payoff: 85, description: "He escapes the mob" })]), 60_000).level).toBe("onbevestigd");
  });

  it("confirmed: a death or a big hit in the picture, Gemini plus a measurement, or two measurements", () => {
    expect(contentValue(tl([ev({ kind: "death", sources: ["beeld:doodscherm"], payoff: 95 })]), 60_000).level).toBe("bevestigd");
    expect(contentValue(tl([ev({ kind: "damage", sources: ["beeld:hartjes"], payoff: 70, description: "Schade: van 10 naar 4 hartjes" })]), 60_000).level).toBe("bevestigd");
    expect(contentValue(tl([ev({ kind: "ai_moment", sources: ["ai:escape", "spraak:kinderen"], payoff: 87, description: "Rampage" })]), 60_000).level).toBe("bevestigd");
    expect(contentValue(tl([ev({}), ev({ kind: "kid_reaction", sources: ["spraak:kinderen"], t_peak: 61_000 })]), 60_000).level).toBe("bevestigd");
  });

  it("a quiet game sound (pickaxe, +10 LU) is no confirmation of a Gemini claim (praktijktest 24-11-2026)", () => {
    const mining = [ev({ kind: "ai_moment", sources: ["ai:discovery", "geluid:piek"], payoff: 72, description: "Uncovers gold ore + Hard geluid (+10 LU)" })];
    expect(contentValue(tl(mining), 60_000).level).toBe("onbevestigd");
    const loud = [ev({ kind: "ai_moment", sources: ["ai:near_death", "geluid:piek"], payoff: 90, description: "Falls off the cliff + Hard geluid (+23 LU)" })];
    expect(contentValue(tl(loud), 60_000).level).toBe("bevestigd");
  });

  it("ignores evidence far from the moment and weak Gemini moments", () => {
    expect(contentValue(tl([ev({ kind: "death", sources: ["beeld:doodscherm"], t_peak: 90_000 })]), 60_000).level).toBe("afgewezen");
    expect(contentValue(tl([ev({ kind: "ai_moment", sources: ["ai:surprise"], payoff: 50 })]), 60_000).level).toBe("afgewezen");
  });

  it("after the export: Milan's request always goes to review; an unconfirmed moment needs the AI check to see it", () => {
    const unconfirmed = contentValue(tl([ev({})]), 60_000);
    const confirmed = contentValue(tl([ev({ kind: "death", sources: ["beeld:doodscherm"] })]), 60_000);
    expect(reviewDecision(unconfirmed, { fragment: 8, verhaal: 7, hook: 7, summary: "" }, false).toReview).toBe(true);
    expect(reviewDecision(unconfirmed, { fragment: 6, verhaal: 8, hook: 7, summary: "Walking around." }, false).toReview).toBe(false);
    expect(reviewDecision(unconfirmed, { fragment: 3, verhaal: 3, hook: 3, summary: "" }, true).toReview).toBe(true);
    // A high score elsewhere cannot make up for a weak fragment: no compensation.
    expect(reviewDecision(confirmed, { fragment: 4, verhaal: 9, hook: 10, summary: "" }, false).toReview).toBe(false);
    expect(reviewDecision(confirmed, { fragment: 7, verhaal: 7, hook: 7, summary: "" }, false).toReview).toBe(true);
  });
});

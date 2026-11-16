import { describe, expect, it } from "vitest";
import { buildEvents } from "../lib/kivoxel/events.ts";
import { reactionsFrom, speechWindows } from "./kidsSpeech.ts";

describe("kids' reactions (local Whisper, section 7.8)", () => {
  it("listens only around the moments, windows joined and inside the recording", () => {
    expect(speechWindows([1000, 5000, 30_000], 32_000)).toEqual([[0, 8000], [26_000, 32_000]]);
  });
  it("keeps short loud shouts and drops sentences, mumbling and Whisper's inventions", () => {
    const loud = Array.from({ length: 200 }, (_, i) => (i >= 20 && i < 40 ? -12 : -45));
    const r = reactionsFrom(
      [
        { timestamp: [0.2, 1.1], text: " NEEEE!" },
        { timestamp: [2.5, 6], text: " en dan gaan we daarna naar de grot om ijzer te zoeken" },
        { timestamp: [9, 10], text: " Thank you." },
        { timestamp: [15, 16], text: " ja" },
      ],
      2000,
      loud,
    );
    expect(r).toEqual([{ atMs: 2200, endMs: 3100, text: "NEEEE!", loudness: -12 }]);
  });
  it("a reaction becomes a moment with room for the kids' own voice, without their words", () => {
    const visual = { version: 3, fps: 4, durationMs: 20_000, frames: Array.from({ length: 80 }, () => ({ luma: 120, tint: 0, motion: 10, health: 1000 })) };
    const t = buildEvents({ visual: visual as never, signals: null, reactions: [{ atMs: 9000, endMs: 9800, text: "NEEEE!", loudness: -10 }] });
    const e = t.events.find((x) => x.kind === "kid_reaction")!;
    expect(e.payoff).toBeGreaterThanOrEqual(50);
    expect(e.description).not.toContain("NEEEE");
  });
});

describe("no false reactions", () => {
  it("one word stretched over a whole window is noise, not a shout", () => {
    expect(reactionsFrom([{ timestamp: [0, 25], text: " Ja." }], 0, Array.from({ length: 300 }, () => -10))).toEqual([]);
  });
});

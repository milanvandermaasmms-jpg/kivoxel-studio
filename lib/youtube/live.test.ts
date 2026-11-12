import { describe, expect, it } from "vitest";
import { stepNotes } from "./live";

describe("AI production notes", () => {
  it("describe a real analysis", () => {
    expect(stepNotes("analyse", { moments: 4, usable: 4, videos: 5, source: "ai" })).toEqual(["4 momenten gevonden, 4 met context en afloop", "5 video's voorgesteld"]);
  });

  it("say when the analysis was only test data", () => {
    expect(stepNotes("analyse", { moments: 1, usable: 1, videos: 1, source: "test" })).toEqual(["Testanalyse met vaste posities (geen AI)", "1 moment gevonden, 1 met context en afloop", "1 video voorgesteld"]);
  });

  it("describe a montage with its real lengths and protection", () => {
    expect(stepNotes("render", { recordingMs: 1_444_000, durationMs: 18_000, segments: 3, blurredRegions: 2, gameMuted: false, voice: null, note: "Montage zonder stem: stem nog te verbinden" })).toEqual([
      "Lengte teruggebracht van 24:04 naar 0:18",
      "3 fragmenten gemonteerd",
      "2 hoeken vervaagd",
      "Montage zonder stem: stem nog te verbinden",
    ]);
  });

  it("say nothing when there is no result or no numbers", () => {
    expect(stepNotes("render", null)).toEqual([]);
    expect(stepNotes("analyse", { moments: "veel" })).toEqual([]);
    expect(stepNotes("onbekend", { a: 1 })).toEqual([]);
  });

  it("describe intake and script", () => {
    expect(stepNotes("intake", { durationMs: 20_000, width: 1920, height: 1080 })).toEqual(["Opname van 0:20, 1920×1080"]);
    expect(stepNotes("script", { version: 2, targetMs: 18_000, warnings: ["x"] })).toEqual(["Script versie 2, lengte 0:18", "1 waarschuwing bij het montageplan"]);
  });
});

import { describe, expect, it } from "vitest";
import { repetitions, similarity, words } from "./originality";

describe("word comparison", () => {
  it("ignores case, punctuation, filler words and test labels", () => {
    expect(words("[TEST] Swarmed by Zombies, with LOW health!")).toEqual(["swarmed", "by", "zombies", "low", "health"]);
  });

  it("measures overlap between two texts", () => {
    expect(similarity("SWARMED BY ZOMBIES WITH LOW HEALTH", "LOW HEALTH AGAINST MULTIPLE ZOMBIES")).toBeCloseTo(3 / 7);
    expect(similarity("CAVE SPIDER ATTACK", "CAVE SPIDER ATTACK")).toBe(1);
    expect(similarity("", "")).toBe(0);
  });
});

describe("repetition check", () => {
  const current = { videoId: "v1", label: "Short 1", topLine: "SWARMED BY ZOMBIES WITH LOW HEALTH", hook: "Four zombies trap the player in a dark cave.", narration: "One heart left. The zombies close in." };

  it("warns for a title template with only one word changed", () => {
    const found = repetitions(current, [{ videoId: "v2", label: "Short 2", topLine: "SWARMED BY SKELETONS WITH LOW HEALTH", hook: "Something else entirely happens here.", narration: "A calm walk." }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ videoId: "v2", field: "titel" });
    expect(found[0].share).toBeCloseTo(4 / 6);
  });

  it("stays quiet for a video with its own story", () => {
    expect(repetitions(current, [{ videoId: "v3", label: "Short 3", topLine: "CAVE SPIDER ATTACK IN THE DARK", hook: "A cave spider strikes from the dark.", narration: "Spider bites, then a narrow escape." }])).toEqual([]);
  });

  it("never compares a video with itself", () => {
    expect(repetitions(current, [current])).toEqual([]);
  });
});

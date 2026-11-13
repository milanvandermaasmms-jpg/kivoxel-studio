import { describe, expect, it } from "vitest";
import { arrange, composeLullaby, harmonize, melodyBeats, MELODIES, midiToHz } from "./music";

describe("melodies", () => {
  it("fill whole bars and end on the home note C", () => {
    for (const m of [...MELODIES, composeLullaby(1), composeLullaby(42)]) {
      expect(melodyBeats(m) % m.beatsPerBar).toBeCloseTo(0);
      expect(m.notes.at(-1)![0] % 12).toBe(0);
    }
  });
  it("every melody says where it comes from", () => {
    for (const m of MELODIES) expect(m.source).toMatch(/publiek domein/);
    expect(composeLullaby(3).source).toMatch(/eigen werk/);
  });
  it("the generator makes different songs for different seeds, the same for the same seed", () => {
    expect(composeLullaby(5)).toEqual(composeLullaby(5));
    expect(composeLullaby(5).notes).not.toEqual(composeLullaby(6).notes);
  });
  it("stays gentle: small steps and within one octave and a bit", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const n = composeLullaby(seed).notes.map((x) => x[0]);
      expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(12);
      for (let i = 1; i < n.length; i++) expect(Math.abs(n[i] - n[i - 1])).toBeLessThanOrEqual(7);
    }
  });
});

describe("arrangement", () => {
  it("has a chord for every bar and ends at home", () => {
    const chords = harmonize(MELODIES[0]);
    expect(chords).toHaveLength(Math.ceil(melodyBeats(MELODIES[0]) / 4));
    expect(chords.at(-1)).toBe("C");
  });
  it("thinning removes melody notes but keeps the pad", () => {
    const full = arrange(MELODIES[0], 66).events;
    const thin = arrange(MELODIES[0], 66, { thin: 0.9 }).events;
    expect(thin.filter((e) => e.instrument === "musicbox").length).toBeLessThan(full.filter((e) => e.instrument === "musicbox").length / 2);
    expect(thin.filter((e) => e.instrument === "pad").length).toBe(full.filter((e) => e.instrument === "pad").length);
  });
  it("tempo sets the length", () => {
    expect(arrange(MELODIES[0], 60).lengthS).toBeCloseTo(melodyBeats(MELODIES[0]));
    expect(midiToHz(69)).toBe(440);
  });
});

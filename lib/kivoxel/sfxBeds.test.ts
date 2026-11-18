import { describe, expect, it } from "vitest";
import { MAX_SFX_INPUTS, sfxBeds } from "./mix";

const cue = (i: number) => ({ file: `whoosh-${i % 3}.wav`, atMs: i * 8_000, db: -3, kind: "whoosh" });

describe("sfxBeds (18-11-2026)", () => {
  it("a Short with a handful of effects needs no beds", () => {
    expect(sfxBeds(Array.from({ length: MAX_SFX_INPUTS }, (_, i) => cue(i)), 30_000, (k) => `bed${k}.wav`)).toEqual([]);
  });
  it("a long part with 120 effects becomes a few full-length beds, each run opening at most MAX_SFX_INPUTS files", () => {
    const beds = sfxBeds(Array.from({ length: 120 }, (_, i) => cue(i)), 1_000_000, (k) => `bed${k}.wav`);
    expect(beds).toHaveLength(Math.ceil(120 / MAX_SFX_INPUTS));
    for (const b of beds) {
      expect(b.args.filter((a) => a === "-i").length).toBeLessThanOrEqual(MAX_SFX_INPUTS);
      expect(b.args.join(" ")).toContain("apad=whole_dur=1000.000");
      expect(b.cue).toMatchObject({ atMs: 0, db: 0, kind: "bed" });
    }
    // Every effect keeps its own place and level inside its bed.
    expect(beds[1].args.join(" ")).toContain(`adelay=${16 * 8_000}|${16 * 8_000}`);
    expect(beds[0].args.join(" ")).toContain("volume=-3.0dB");
  });
});

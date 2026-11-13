import { describe, expect, it } from "vitest";
import { arrange, MELODIES } from "../../../lib/dreamnest/music.ts";
import { brownNoise, fade, fireplace, peak, rain, renderEvents, SR, wav } from "./synth.ts";

const finite = (a: Float32Array) => a.every((v) => Number.isFinite(v));
/** Largest jump between two samples: a click shows up as a big jump. */
const maxStep = (a: Float32Array) => a.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - a[i - 1])) : 0), 0);

describe("own synthesizer", () => {
  const { events, lengthS } = arrange(MELODIES[0], 66);
  const music = renderEvents(events.slice(0, 40), 12);

  it("makes sound without errors or clipping", () => {
    expect(finite(music.l) && finite(music.r)).toBe(true);
    expect(peak(music)).toBeGreaterThan(0.01);
    expect(peak(music)).toBeLessThan(2);
    expect(lengthS).toBeGreaterThan(30);
  });

  it("has no clicks: relative to its loudness, no sudden sample jumps", () => {
    fade(music, 0.5, 0.5);
    expect(maxStep(music.l) / peak(music)).toBeLessThan(0.25);
  });

  it("room sounds stay soft and never peak sharply", () => {
    for (const s of [brownNoise(3, 0.3), fireplace(3, 0.3), rain(3, 0.3)]) {
      expect(finite(s.l)).toBe(true);
      expect(peak(s)).toBeLessThan(0.6);
      expect(s.l.length).toBe(3 * SR);
    }
  });

  it("fades start and end at silence", () => {
    const s = fade(brownNoise(2, 0.3), 0.5, 0.5);
    expect(Math.abs(s.l[0])).toBe(0);
    expect(Math.abs(s.l[s.l.length - 1])).toBeLessThan(1e-6);
  });

  it("writes a valid 48 kHz stereo WAV", () => {
    const b = wav(brownNoise(1, 0.3));
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    expect(b.readUInt32LE(24)).toBe(48000);
    expect(b.readUInt16LE(22)).toBe(2);
    expect(b.length).toBe(44 + SR * 4);
  });
});

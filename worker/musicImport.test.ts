import { describe, expect, it } from "vitest";
import { bpmFromEnvelope, safeFileName } from "./musicImport.ts";

const pulses = (bpm: number, hopMs: number, seconds = 30) => {
  const n = Math.round((seconds * 1000) / hopMs);
  const every = 60_000 / bpm / hopMs;
  return Array.from({ length: n }, (_, i) => (Math.abs(i % every) < 1 ? 1 : 0.02));
};

describe("Uppbeat-import", () => {
  it("measures the tempo from the beat pulses", () => {
    const hop = (256 / 11025) * 1000;
    expect(Math.abs(bpmFromEnvelope(pulses(128, hop), hop)! - 128)).toBeLessThanOrEqual(3);
    expect(Math.abs(bpmFromEnvelope(pulses(90, hop), hop)! - 90)).toBeLessThanOrEqual(3);
    expect(bpmFromEnvelope([1, 2, 3], hop)).toBeNull();
  });

  it("keeps Uppbeat's file name recognisable and safe", () => {
    expect(safeFileName("Relentless - Iros Young (main version) 47984.MP3")).toBe("relentless-iros-young-main-version-47984.mp3");
    expect(safeFileName("../../evil.wav")).toBe("evil.wav");
  });
});

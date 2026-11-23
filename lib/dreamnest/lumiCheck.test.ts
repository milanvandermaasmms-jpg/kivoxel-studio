import { describe, expect, it } from "vitest";
import { lumiCheck } from "./lumiCheck";
import type { ExportMeasure } from "../kivoxel/editorReview";

const m = (motion: number[], over: Partial<ExportMeasure> = {}): ExportMeasure => ({ durationMs: motion.length * 1000, black: [], frozen: [], silence: [], peakDb: -6, clippedSamples: 0, motion, captions: [], ...over });

describe("LUMI-controle (eigen maatstaf, 8,0)", () => {
  it("gentle steady movement and calm sound pass the measured part; Lumi and atmosphere wait for Milan", () => {
    const r = lumiCheck(m(Array.from({ length: 30 }, () => 0.8)), { short: true });
    expect(r.total).toBeGreaterThanOrEqual(8);
    expect(r.status).toBe("oordeel nodig");
    expect(lumiCheck(m(Array.from({ length: 30 }, () => 0.8)), { short: true, milan: 9 }).status).toBe("voldoet (8,0+)");
  });

  it("a fully still picture (rain that does not move) and a gap in the music loop are found", () => {
    const r = lumiCheck(m(Array.from({ length: 30 }, () => 0), { silence: [{ startMs: 12_000, endMs: 15_000 }] }), { short: true });
    expect(r.status).toBe("onder 8,0");
    expect(r.parts.find((p) => p.key === "levendigheid")!.evidence.join(" ")).toMatch(/volledig stil beeld/);
    expect(r.parts.find((p) => p.key === "geluid")!.evidence[0]).toMatch(/Gat in de muziek op 0:12/);
  });

  it("restless jumps and hard transitions cost points", () => {
    const motion = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? 14 : 0.8));
    const r = lumiCheck(m(motion), { short: true });
    expect(r.parts.find((p) => p.key === "rust")!.score).toBeLessThan(8);
    expect(r.parts.find((p) => p.key === "overgangen")!.evidence[0]).toMatch(/Harde overgang/);
  });
  it("the intended fade in and fade out (first and last second) are no restlessness", () => {
    const motion = [11, ...Array.from({ length: 28 }, () => 0.8), 11];
    const r = lumiCheck(m(motion), { short: true });
    expect(r.parts.find((p) => p.key === "rust")!.score).toBe(10);
    expect(r.parts.find((p) => p.key === "overgangen")!.score).toBe(10);
  });
});

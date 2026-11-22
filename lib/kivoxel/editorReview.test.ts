import { describe, expect, it } from "vitest";
import { quietestStretch, reviewExport, type ExportMeasure, type Intent } from "./editorReview";

const base: ExportMeasure = { durationMs: 14_000, black: [], frozen: [], silence: [], peakDb: -1.5, clippedSamples: 0, motion: [5, 6, 4, 8, 9, 3, 7, 9, 6, 5, 4, 6, 5, 4], captions: [] };
const music: Intent = { short: true, peakOutMs: 6500, voiceLines: [], hasVoice: false };

describe("eindredacteur na de export", () => {
  it("Klaar voor Milan when picture, sound and outcome are fine", () => {
    const r = reviewExport(base, music);
    expect(r.status).toBe("Klaar voor Milan");
    expect(r.blind[0]).toMatch(/De meeste beweging zit rond 00:04/);
  });

  it("the outcome cut off right after the peak blocks (the old 2-second payoff)", () => {
    const r = reviewExport({ ...base, durationMs: 8000 }, { ...music, peakOutMs: 6500 });
    expect(r.status).toBe("Correctie nodig");
    expect(r.findings.find((f) => f.kind === "uitkomst")!.text).toMatch(/1\.5 s/);
    expect(r.main).toMatch(/^00:06/);
  });

  it("black or frozen picture and digital clipping block; a late peak and a quiet stretch are improvements", () => {
    expect(reviewExport({ ...base, black: [{ startMs: 11_000, endMs: 11_600 }] }, music).status).toBe("Correctie nodig");
    expect(reviewExport({ ...base, frozen: [{ startMs: 3000, endMs: 4500 }] }, music).status).toBe("Correctie nodig");
    expect(reviewExport({ ...base, peakDb: 0, clippedSamples: 400 }, music).status).toBe("Correctie nodig");
    const late = reviewExport({ ...base, motion: [5, 0.5, 0.4, 0.3, 0.5, 6, 6, 6, 6, 6, 6, 6, 6, 6] }, { ...music, peakOutMs: 10_000 });
    expect(late.status).toBe("Klaar voor Milan");
    expect(late.findings.map((f) => f.kind)).toEqual(["aandacht", "opening"]);
  });

  it("a voice-over is never a green tick: human listening check, and captions must exist and fit", () => {
    const v: Intent = { short: true, peakOutMs: 6500, voiceLines: [{ atMs: 400, text: "Hear that? He's on the right." }], hasVoice: true };
    expect(reviewExport({ ...base, captions: [{ startMs: 400, endMs: 2000 }] }, v).status).toBe("Handmatige controle nodig");
    expect(reviewExport(base, v).status).toBe("Correctie nodig");
    expect(reviewExport({ ...base, captions: [{ startMs: 13_000, endMs: 15_000 }] }, v).status).toBe("Correctie nodig");
  });

  it("finds the stretch where the picture hardly changes", () => {
    expect(quietestStretch([5, 0.5, 0.5, 0.5, 6, 0.2, 7])).toEqual({ startMs: 1000, endMs: 4000 });
  });
});

describe("inhoud gemeten op de gebruikte bronbeelden", () => {
  it("a mostly-menu export blocks (88% menu in the Netherite Trim Armor Box Short)", () => {
    const r = reviewExport(base, { ...music, gameplayShare: 0.12, measuredEvents: 2 });
    expect(r.status).toBe("Correctie nodig");
    expect(r.main).toMatch(/12% van deze export is gameplay/);
  });
  it("only the chosen moment measured: a human has to look (never a green tick)", () => {
    expect(reviewExport(base, { ...music, gameplayShare: 0.68, measuredEvents: 1 }).status).toBe("Handmatige controle nodig");
    expect(reviewExport(base, { ...music, gameplayShare: 0.9, measuredEvents: 3 }).status).toBe("Klaar voor Milan");
  });
});

import { describe, expect, it } from "vitest";
import { firstActionMs, needsLoudnessFix, parseQcLog, pickLoudnessFix, qcChecklist, type QcContext, type QcProbe } from "./qc";

const STDERR = `[blackdetect @ 1] black_start:0 black_end:1.5 black_duration:1.5
[freezedetect @ 2] lavfi.freezedetect.freeze_duration: 2.4
[Parsed_metadata_3 @ 3] lavfi.scd.time=2.1
[Parsed_metadata_3 @ 3] lavfi.scd.time=4.0
[silencedetect @ 4] silence_end: 9 | silence_duration: 3.5
[Parsed_ebur128_0 @ 5] Summary:

  Integrated loudness:
    I:         -37.3 LUFS
    Threshold: -49.2 LUFS

  True peak:
    Peak:       -7.0 dBFS
`;

describe("quality measurements", () => {
  it("reads loudness, peaks, scene changes, black, freeze and silence", () => {
    expect(parseQcLog(STDERR)).toEqual({ integratedLufs: -37.3, truePeakDb: -7, sceneTimes: [2.1, 4], blackSeconds: [1.5], freezeSeconds: [2.4], silenceSeconds: [3.5] });
  });

  it("knows nothing about loudness without a summary", () => {
    expect(parseQcLog("nothing").integratedLufs).toBeNull();
  });
});

const probe: QcProbe = { width: 1080, height: 1920, fps: 30, bitrateBps: 3_300_000, durationMs: 18_000, hasAudio: true };
const ctx: QcContext = { format: "A", expected: { width: 1080, height: 1920 }, targetMs: { min: 15_000, max: 35_000 }, firstActionMs: 400, hasVoice: false, captionsInSafeZone: true };
const level = (items: ReturnType<typeof qcChecklist>, key: string) => items.find((i) => i.key === key)?.level;

describe("quality checklist", () => {
  it("is green for a good Short", () => {
    const items = qcChecklist(probe, { integratedLufs: -14.2, truePeakDb: -1.6, sceneTimes: [2, 4, 6, 8, 10, 12, 14], blackSeconds: [], freezeSeconds: [], silenceSeconds: [] }, ctx);
    expect(items.filter((i) => i.level === "red" || i.level === "orange").map((i) => i.key)).toEqual([]);
  });

  it("marks the real problems of the first Short: far too quiet and no visual change", () => {
    const items = qcChecklist(probe, parseQcLog(STDERR.replace(/lavfi\.scd\.time=[\d.]+\n?/g, "")), ctx);
    expect(level(items, "loudness")).toBe("red");
    expect(level(items, "rhythm")).toBe("orange");
    expect(level(items, "black")).toBe("orange");
    expect(level(items, "silence")).toBe("orange");
  });

  it("refuses a Short longer than 3 minutes and a wrong size", () => {
    const items = qcChecklist({ ...probe, width: 1920, height: 1080, durationMs: 200_000 }, parseQcLog(STDERR), ctx);
    expect(level(items, "duration")).toBe("red");
    expect(level(items, "resolution")).toBe("red");
  });

  it("asks for the first action within a second", () => {
    expect(level(qcChecklist(probe, parseQcLog(STDERR), { ...ctx, firstActionMs: 2000 }), "first_action")).toBe("orange");
    expect(level(qcChecklist(probe, parseQcLog(STDERR), { ...ctx, firstActionMs: 6000 }), "first_action")).toBe("red");
  });

  it("does not judge the shot rhythm of a long video", () => {
    expect(level(qcChecklist({ ...probe, width: 1920, height: 1080 }, parseQcLog(STDERR), { ...ctx, format: "C", expected: { width: 1920, height: 1080 }, targetMs: { min: 480_000, max: 720_000 } }), "rhythm")).toBe("na");
  });
});

describe("time to the first action", () => {
  it("finds where the montage first shows an analysed moment", () => {
    const segments = [
      { src_start_ms: 120_000, src_end_ms: 125_000, out_start_ms: 0, speed: 1 },
      { src_start_ms: 125_000, src_end_ms: 140_000, out_start_ms: 5000, speed: 1 },
    ];
    expect(firstActionMs(segments, [{ start_ms: 125_000, end_ms: 134_000 }])).toBe(5000);
    expect(firstActionMs(segments, [{ start_ms: 121_000, end_ms: 134_000 }])).toBe(1000);
  });

  it("takes the speed of a segment into account, and is unknown without overlap", () => {
    expect(firstActionMs([{ src_start_ms: 0, src_end_ms: 10_000, out_start_ms: 0, speed: 2 }], [{ start_ms: 4000, end_ms: 6000 }])).toBe(2000);
    expect(firstActionMs([{ src_start_ms: 0, src_end_ms: 1000, out_start_ms: 0, speed: 1 }], [{ start_ms: 5000, end_ms: 6000 }])).toBeNull();
  });
});

describe("extra sound pass", () => {
  it("runs when the montage is too quiet or clips", () => {
    expect(needsLoudnessFix({ integratedLufs: -20.7, truePeakDb: -1 })).toBe(true);
    expect(needsLoudnessFix({ integratedLufs: -16, truePeakDb: 0.5 })).toBe(true);
    expect(needsLoudnessFix({ integratedLufs: -16, truePeakDb: -2 })).toBe(false);
  });

  it("keeps the loudest version with safe peaks (real measurements of 12-11-2026)", () => {
    // Cold-open Short: original clipped at +0,5 dBFS; limit 0.6 still overshot after AAC, limit 0.5 is safe.
    const before = { integratedLufs: -20.5, truePeakDb: 0.5 };
    const pick = pickLoudnessFix(before, [
      { id: "0.6", integratedLufs: -17.5, truePeakDb: 0.2 },
      { id: "0.5", integratedLufs: -18.3, truePeakDb: -2.6 },
    ]);
    expect(pick?.id).toBe("0.5");
  });

  it("accepts a slightly quieter version only to stop clipping", () => {
    expect(pickLoudnessFix({ integratedLufs: -16, truePeakDb: 0.4 }, [{ id: "a", integratedLufs: -16.8, truePeakDb: -2 }])?.id).toBe("a");
    expect(pickLoudnessFix({ integratedLufs: -20, truePeakDb: -2 }, [{ id: "a", integratedLufs: -19.5, truePeakDb: -2 }])).toBeNull();
  });
});

describe("silence rule from the superprompt (fase 5)", () => {
  it("marks a silence longer than 2 seconds", () => {
    const quiet = (s: number) => qcChecklist(probe, { integratedLufs: -14, truePeakDb: -1.5, sceneTimes: [2, 4, 6, 8, 10, 12, 14], blackSeconds: [], freezeSeconds: [], silenceSeconds: [s] }, ctx);
    expect(level(quiet(2.5), "silence")).toBe("orange");
    expect(level(quiet(2), "silence")).toBe("green");
  });
});

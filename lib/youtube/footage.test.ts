import { describe, expect, it } from "vitest";
import { buildTimeline, createSignalParser, deadReason, mergeSpans, signalHints, timelineSummary, type Signals } from "./footage";

// A piece of a real FFmpeg log (generated test picture, no gameplay), split at awkward places like a stream does.
const LOG = [
  "[Parsed_ametadata_2 @ 0x1] frame:0    pts:0       pts_time:0",
  "[Parsed_ametadata_2 @ 0x1] lavfi.r128.M=-120.691",
  "[Parsed_ametadata_2 @ 0x1] frame:1    pts:4410    pts_time:0.1",
  "[Parsed_ametadata_2 @ 0x1] lavfi.r128.M=-41.773",
  "[Parsed_metadata_5 @ 0x2] frame:0    pts:40      pts_time:4",
  "[Parsed_metadata_5 @ 0x2] lavfi.scene_score=1.000000",
  "[Parsed_silencedetect_0 @ 0x3] silence_start: 3.999841",
  "[Parsed_blackdetect_3 @ 0x4] black_start:4 black_end:7 black_duration:3",
  "[Parsed_metadata_5 @ 0x2] frame:1    pts:70      pts_time:7",
  "[Parsed_metadata_5 @ 0x2] lavfi.scene_score=0.650000",
  "[Parsed_freezedetect_2 @ 0x5] lavfi.freezedetect.freeze_start: 7",
  "[Parsed_silencedetect_0 @ 0x3] silence_end: 17.000023 | silence_duration: 13.000181",
  "[Parsed_freezedetect_2 @ 0x5] lavfi.freezedetect.freeze_duration: 10",
  "[Parsed_freezedetect_2 @ 0x5] lavfi.freezedetect.freeze_end: 17",
  "[Parsed_freezedetect_2 @ 0x5] lavfi.freezedetect.freeze_start: 19.5",
].join("\r\n");

const empty = (over: Partial<Signals> = {}): Signals => ({ version: 1, durationMs: 120_000, sceneCutsMs: [], freezes: [], blacks: [], silences: [], loudness: [], ...over });

describe("FFmpeg signal parser", () => {
  it("reads cuts, stillness, black, silence and loudness from a log that arrives in pieces", () => {
    const p = createSignalParser(21_000);
    for (let i = 0; i < LOG.length; i += 37) p.feed(LOG.slice(i, i + 37));
    const s = p.finish();
    expect(s.sceneCutsMs).toEqual([4000, 7000]);
    expect(s.blacks).toEqual([{ startMs: 4000, endMs: 7000 }]);
    expect(s.silences).toEqual([{ startMs: 4000, endMs: 17000 }]);
    // The last freeze runs until the end of the recording.
    expect(s.freezes).toEqual([
      { startMs: 7000, endMs: 17000 },
      { startMs: 19500, endMs: 21000 },
    ]);
    expect(s.loudness).toEqual([-120, -42]);
  });
});

describe("timeline from the signals", () => {
  it("calls a long freeze AFK, a short one a still picture and black a loading screen", () => {
    const t = buildTimeline(empty({ freezes: [{ startMs: 0, endMs: 30_000 }, { startMs: 50_000, endMs: 58_000 }], blacks: [{ startMs: 70_000, endMs: 72_000 }] }));
    expect(t.dead.map((d) => d.kind)).toEqual(["afk", "still", "black"]);
    expect(t.deadMs).toBe(40_000);
  });

  it("joins spans that touch", () => {
    expect(mergeSpans([{ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 }, { startMs: 100, endMs: 110 }])).toEqual([
      { startMs: 0, endMs: 20 },
      { startMs: 100, endMs: 110 },
    ]);
  });

  it("finds a sudden loud moment, but not a steady loud part and not one in a dead part", () => {
    const loudness = Array.from({ length: 1200 }, () => -40); // two minutes of quiet gameplay
    loudness[300] = -20; // a bang at 0:30
    loudness[301] = -24;
    loudness[320] = -22; // the echo 2 s later counts as the same moment
    for (let i = 600; i < 900; i++) loudness[i] = -18; // a long loud part: not sudden
    loudness[1000] = -15; // a bang inside a freeze
    const t = buildTimeline(empty({ loudness, freezes: [{ startMs: 95_000, endMs: 105_000 }] }));
    expect(t.peaks.map((p) => p.atMs)).toEqual([30_000]);
    expect(t.peaks[0].rise).toBe(20);
  });

  it("drops moments in dead parts and explains why", () => {
    const t = buildTimeline(empty({ freezes: [{ startMs: 10_000, endMs: 40_000 }] }));
    expect(deadReason({ startMs: 5_000, endMs: 20_000, peakMs: 15_000 }, t)).toMatch(/piek valt/);
    expect(deadReason({ startMs: 8_000, endMs: 30_000, peakMs: 9_000 }, t)).toMatch(/% van het moment/);
    expect(deadReason({ startMs: 40_000, endMs: 60_000, peakMs: 50_000 }, t)).toBeNull();
  });

  it("gives short hints for the analysis and a Dutch summary", () => {
    const loudness = Array.from({ length: 1200 }, () => -40);
    loudness[700] = -15;
    const t = buildTimeline(empty({ loudness, sceneCutsMs: [1000, 2000], freezes: [{ startMs: 0, endMs: 25_000 }], blacks: [{ startMs: 30_000, endMs: 31_000 }] }));
    const hints = signalHints(t);
    expect(hints).toContain("0:00-0:25 standing still (AFK)");
    expect(hints).not.toContain("0:30-0:31"); // shorter than 3 s: not worth the tokens
    expect(hints).toContain("1:10");
    expect(timelineSummary(t, 120_000)).toBe("2 scènewissels, 1 geluidspieken, 22% dood beeld (1× AFK, 1× zwart/laden)");
    expect(signalHints(buildTimeline(empty()))).toBe("");
  });
});

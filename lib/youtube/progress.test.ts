import { describe, expect, it } from "vitest";
import { checkStall, createProgressParser, formatEta, renderProgress } from "./progress";

const block = (frame: number, us: number, speed: string, end = false) => `frame=${frame}\nfps=60.0\nout_time_us=${us}\nout_time_ms=${us}\nout_time=00:00:00.000000\nspeed=${speed}\nprogress=${end ? "end" : "continue"}\n`;

describe("FFmpeg progress", () => {
  it("turns each block into a snapshot, also when a chunk ends halfway a line", () => {
    const parse = createProgressParser();
    const text = block(120, 4_000_000, "2.05x") + block(240, 8_000_000, "2.1x", true);
    const cut = text.indexOf("speed=2.1");
    expect(parse(text.slice(0, cut))).toEqual([{ frame: 120, fps: 60, outMs: 4000, speed: 2.05, done: false }]);
    expect(parse(text.slice(cut))).toEqual([{ frame: 240, fps: 60, outMs: 8000, speed: 2.1, done: true }]);
  });

  it("uses the clock time when out_time_us is missing, and no speed when FFmpeg says N/A", () => {
    const parse = createProgressParser();
    expect(parse("frame=1\nout_time=00:01:02.500000\nspeed=N/A\nprogress=continue\n")[0]).toMatchObject({ outMs: 62_500, speed: null });
  });

  it("reads Windows line endings", () => {
    expect(createProgressParser()("frame=5\r\nout_time_us=1000000\r\nspeed=1x\r\nprogress=continue\r\n")[0]).toMatchObject({ frame: 5, outMs: 1000, speed: 1 });
  });
});

describe("render progress and remaining time", () => {
  it("is the measured share of the output, and the remaining time follows the measured speed", () => {
    expect(renderProgress({ outMs: 25_000, speed: 2.5, done: false }, 100_000, 10_000)).toEqual({ progress: 0.25, etaMs: 30_000 });
  });

  it("gives no remaining time in the first seconds or without a speed", () => {
    expect(renderProgress({ outMs: 1000, speed: 2, done: false }, 100_000, 1500).etaMs).toBeNull();
    expect(renderProgress({ outMs: 1000, speed: null, done: false }, 100_000, 9000).etaMs).toBeNull();
  });

  it("knows nothing without measurements, and is complete at the end", () => {
    expect(renderProgress({ outMs: null, speed: null, done: false }, 100_000, 9000)).toEqual({ progress: null, etaMs: null });
    expect(renderProgress({ outMs: 99_000, speed: 2, done: true }, 100_000, 9000)).toEqual({ progress: 1, etaMs: 0 });
    expect(renderProgress({ outMs: 120_000, speed: 2, done: false }, 100_000, 9000).progress).toBe(0.999);
  });

  it("writes the remaining time as minutes and seconds, or says it is unknown", () => {
    expect(formatEta(83_000)).toBe("1:23");
    expect(formatEta(null)).toBe("Nog onbekend");
  });
});

describe("stall check", () => {
  const base = { stallMs: 300_000, sleepGapMs: 60_000 };
  it("is fine while progress keeps coming", () => {
    expect(checkStall({ ...base, now: 100_000, lastProgress: 95_000, lastCheck: 85_000 })).toEqual({ stalled: false, lastProgress: 95_000 });
  });

  it("stops a montage that made no progress for too long", () => {
    expect(checkStall({ ...base, now: 400_000, lastProgress: 90_000, lastCheck: 385_000 }).stalled).toBe(true);
  });

  it("starts waiting again after the pc slept, instead of stopping the montage", () => {
    const night = 8 * 3_600_000;
    expect(checkStall({ ...base, now: night, lastProgress: 1_000, lastCheck: 16_000 })).toEqual({ stalled: false, lastProgress: night });
  });
});

describe("analysis progress", () => {
  it("maps stages onto one bar and never fakes the end", async () => {
    const { stageProgress, expectedThinkingMs, thinkingShare } = await import("./progress");
    expect(stageProgress("proxy", 0.5)).toBeCloseTo(0.2);
    expect(stageProgress("upload", 1)).toBeCloseTo(0.5);
    expect(stageProgress("thinking", 2)).toBeCloseTo(0.97);
    expect(expectedThinkingMs(24 * 60_000)).toBe(92_000);
    expect(thinkingShare(0, 60_000)).toBe(0);
    expect(thinkingShare(30_000, 60_000)).toBeGreaterThan(0.5);
    expect(thinkingShare(10 * 60_000, 60_000)).toBe(0.95);
  });
});

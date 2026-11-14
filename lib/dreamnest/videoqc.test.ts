import { describe, expect, it } from "vitest";
import { judgeVideo, parseBlack, perMinute } from "./videoqc";

const fps = 24;
const calm = (n: number) => ({ luma: Array.from({ length: n }, (_, i) => 80 - i * 0.0005), steps: Array.from({ length: n }, () => 0.997) });

describe("video QC per minute", () => {
  it("passes a calm, slowly dimming video", () => {
    const { luma, steps } = calm(fps * 180);
    const rows = perMinute(luma, steps, fps);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.problems.length === 0)).toBe(true);
  });
  it("names the minute and time of a flash, a hard cut and restlessness", () => {
    const { luma, steps } = calm(fps * 120);
    luma[fps * 75] = 140;
    steps[fps * 30] = 0.4;
    for (let i = fps * 90; i < fps * 110; i++) steps[i] = 0.95;
    const p = perMinute(luma, steps, fps).flatMap((r) => r.problems).join(" | ");
    expect(p).toMatch(/flits bij 1:15/);
    expect(p).toMatch(/harde knip bij 0:30/);
    expect(p).toMatch(/onrustig/);
  });
  it("allows gentle movement in the story but not in the sleep part", () => {
    const { luma, steps } = calm(fps * 120);
    steps.fill(0.985);
    const rows = perMinute(luma, steps, fps, (m) => (m < 1 ? 0.98 : 0.99));
    expect(rows[0].problems).toEqual([]);
    expect(rows[1].problems.join()).toMatch(/onrustig/);
  });
  it("checks length, resolution, fps and black frames", () => {
    const ok = judgeVideo({ durationS: 3600, width: 1920, height: 1080, fps: 24 }, [], 3600, [{ start: 3560, end: 3600 }]);
    expect(ok.ok).toBe(true);
    const bad = judgeVideo({ durationS: 3000, width: 1280, height: 720, fps: 25 }, [], 3600, [{ start: 100, end: 104 }]);
    expect(bad.problems).toHaveLength(4);
  });
  it("reads FFmpeg's black frame output", () => {
    expect(parseBlack("black_start:3561.5 black_end:3600 black_duration:38.5")).toEqual([{ start: 3561.5, end: 3600 }]);
  });
});

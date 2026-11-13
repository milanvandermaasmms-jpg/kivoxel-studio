import { describe, expect, it } from "vitest";
import { median, parseAllSsim, parseLuma, parseSsim, silentArgs } from "./measure.ts";

describe("FFmpeg output", () => {
  it("reads the brightness of every frame", () => {
    expect(parseLuma("frame:0 pts:0\nlavfi.signalstats.YAVG=81.5\nframe:1\nlavfi.signalstats.YAVG=82\n")).toEqual([81.5, 82]);
  });
  it("reads the seam similarity", () => {
    expect(parseSsim("[Parsed_ssim_0] SSIM Y:0.98 U:0.99 V:0.99 All:0.981234 (17.2)")).toBeCloseTo(0.981);
    expect(parseSsim("nothing")).toBeNull();
  });
  it("reads every frame step and takes the median", () => {
    const steps = parseAllSsim("n:1 Y:0.9 All:0.90 (10)\nn:2 Y:0.9 All:0.98 (17)\nn:3 Y:0.9 All:0.95 (13)\n");
    expect(steps).toEqual([0.9, 0.98, 0.95]);
    expect(median(steps)).toBe(0.95);
    expect(median([])).toBeNull();
  });
  it("keeps the picture and drops the sound", () => {
    expect(silentArgs("a.mp4", "b.mp4")).toEqual(["-y", "-v", "error", "-i", "a.mp4", "-an", "-c:v", "copy", "b.mp4"]);
  });
});

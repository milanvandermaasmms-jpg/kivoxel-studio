import { describe, expect, it } from "vitest";
import { parseLuma, parseSsim, silentArgs } from "./measure.ts";

describe("FFmpeg output", () => {
  it("reads the brightness of every frame", () => {
    expect(parseLuma("frame:0 pts:0\nlavfi.signalstats.YAVG=81.5\nframe:1\nlavfi.signalstats.YAVG=82\n")).toEqual([81.5, 82]);
  });
  it("reads the seam similarity", () => {
    expect(parseSsim("[Parsed_ssim_0] SSIM Y:0.98 U:0.99 V:0.99 All:0.981234 (17.2)")).toBeCloseTo(0.981);
    expect(parseSsim("nothing")).toBeNull();
  });
  it("keeps the picture and drops the sound", () => {
    expect(silentArgs("a.mp4", "b.mp4")).toEqual(["-y", "-v", "error", "-i", "a.mp4", "-an", "-c:v", "copy", "b.mp4"]);
  });
});

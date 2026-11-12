import { describe, expect, it } from "vitest";
import { parseProbe, parseRate } from "./ffmpeg";

describe("ffprobe output", () => {
  it("reads frame rates", () => {
    expect(parseRate("60/1")).toBe(60);
    expect(parseRate("60000/1001")).toBe(59.94);
    expect(parseRate("0/0")).toBeNull();
  });

  it("reads length, picture size and codecs", () => {
    const info = parseProbe({
      format: { duration: "12.345" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "60/1" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    expect(info).toEqual({ durationMs: 12345, width: 1920, height: 1080, fps: 60, videoCodec: "h264", audioCodec: "aac" });
  });
});

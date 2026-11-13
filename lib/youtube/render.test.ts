import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { assText, assTime, buildAss, captions, cleanRegions, segmentOverlays, DEFAULT_BLUR_REGIONS, isRenderFileName, narration, renderArgs, renderFileName, renderSize } from "./render";

const seg = (src_start_ms: number, src_end_ms: number, speed = 1): Segment => ({ part: "build", src_start_ms, src_end_ms, out_start_ms: 0, speed, effects: [], note: "" });
const base = { recording: "C:\\Users\\x\\FamilieMK-YouTube\\recordings\\abc.mp4", recordingMs: 60_000, hasAudio: true, assFile: "subs.ass", voice: [], gameVolume: 0.25, output: "out.mp4" };

describe("montage sizes", () => {
  it("Shorts are vertical, a long video horizontal", () => {
    expect(renderSize("A")).toEqual({ width: 1080, height: 1920 });
    expect(renderSize("B")).toEqual({ width: 1080, height: 1920 });
    expect(renderSize("C")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("subtitles", () => {
  it("writes ASS times in centiseconds", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(83_456)).toBe("0:01:23.46");
    expect(assTime(3_725_000)).toBe("1:02:05.00");
  });

  it("keeps script text from opening override blocks", () => {
    expect(assText("Hi {\\b1}there\nnow")).toBe("Hi /b1there now");
  });

  it("puts the hook first when no line opens the video", () => {
    expect(narration("Three creepers.", [{ at_ms: 4000, text: "Then" }])[0]).toEqual({ at_ms: 0, text: "Three creepers." });
    expect(narration("Three creepers.", [{ at_ms: 500, text: "Go" }])).toHaveLength(1);
  });

  it("shows a caption until the next line or as long as it takes to say it", () => {
    const c = captions([{ at_ms: 0, text: "one two three four five six seven eight nine ten" }, { at_ms: 2000, text: "next" }, { at_ms: 9000, text: "last" }], 9500);
    expect(c[0]).toMatchObject({ startMs: 0, endMs: 2000 });
    expect(c[1]).toMatchObject({ startMs: 2000, endMs: 3200 });
    expect(c[2].endMs).toBe(9500);
  });

  it("adds the top line only to Shorts", () => {
    const lines = [{ at_ms: 0, text: "Run!" }];
    const short = buildAss({ size: renderSize("A"), topLine: "3 creepers, 2 hearts", lines, durationMs: 18_000 });
    expect(short).toContain("PlayResY: 1920");
    expect(short).toContain("Dialogue: 1,0:00:00.00,0:00:18.00,Top,,0,0,0,,3 CREEPERS, 2 HEARTS");
    expect(short).toContain(",Caption,,0,0,0,,Run!");
    expect(buildAss({ size: renderSize("C"), topLine: "x", lines, durationMs: 18_000 })).not.toContain(",Top,,");
  });
});

describe("FFmpeg montage", () => {
  it("seeks per piece, speeds up and joins the pieces", () => {
    const { args, durationMs, segments } = renderArgs({ ...base, segments: [seg(1000, 3000), seg(10_000, 20_000, 2)], size: renderSize("A") });
    expect(segments).toBe(2);
    expect(durationMs).toBe(2000 + 5000);
    expect(args.slice(4, 10)).toEqual(["-ss", "1.000", "-t", "2.000", "-i", base.recording]);
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("[1:v]setpts=(PTS-STARTPTS)/2,scale=-2:1920,crop=1080:1920");
    expect(filter).toContain("atempo=2,");
    expect(filter).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]");
    expect(filter).toContain("[vc]subtitles=subs.ass[vout]");
    expect(filter).toContain("[ac]anull[amix]");
    expect(filter).toContain("[amix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]");
    expect(filter).not.toContain("C:\\");
    expect(args.at(-1)).toBe("out.mp4");
  });

  it("keeps a long video horizontal with bars when needed", () => {
    const filter = renderArgs({ ...base, segments: [seg(0, 5000)], size: renderSize("C") }).args.find((a) => a.includes("concat"))!;
    expect(filter).toContain("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080");
  });

  it("lays the narrator over the quieter game sound at its place on the timeline", () => {
    const { args } = renderArgs({ ...base, segments: [seg(0, 5000)], size: renderSize("A"), voice: [{ file: "line0.mp3", atMs: 0 }, { file: "line1.mp3", atMs: 2500 }] });
    expect(args).toContain("line1.mp3");
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("[ac]volume=0.25[game]");
    expect(filter).toContain("[2:a]aresample=48000,aformat=channel_layouts=stereo,adelay=2500|2500[n1]");
    expect(filter).toContain("[game][n0][n1]amix=inputs=3:duration=first:normalize=0[amix]");
  });

  it("uses silence for a recording without sound", () => {
    const filter = renderArgs({ ...base, hasAudio: false, segments: [seg(0, 4000)], size: renderSize("A") }).args.find((a) => a.includes("concat"))!;
    expect(filter).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=4.000[a0]");
  });

  it("stays inside the recording and refuses an empty plan", () => {
    expect(renderArgs({ ...base, segments: [seg(55_000, 70_000)], size: renderSize("A") }).durationMs).toBe(5000);
    expect(() => renderArgs({ ...base, segments: [seg(70_000, 80_000)], size: renderSize("A") })).toThrow(/geen bruikbare stukken/);
  });
});

describe("render file names", () => {
  it("match the check in the database", () => {
    const name = renderFileName("1b2c3d4e-0000-4000-8000-000000000001", 2, "9f8e7d6c-1111-4000-8000-000000000002");
    expect(name).toBe("1b2c3d4e-0000-4000-8000-000000000001-v2-9f8e7d6c.mp4");
    expect(isRenderFileName(name)).toBe(true);
    expect(isRenderFileName("../x.mp4")).toBe(false);
    expect(isRenderFileName("a.mp4.exe")).toBe(false);
    expect(isRenderFileName("abc-v1-1234-t2.jpg")).toBe(true);
    expect(isRenderFileName("abc.png")).toBe(false);
  });
});

describe("blurring and muting (fase 1.5)", () => {
  const filter = (extra: object) => {
    const { args } = renderArgs({ ...base, segments: [seg(0, 5000), seg(9000, 12000)], size: renderSize("A"), ...extra });
    return args[args.indexOf("-filter_complex") + 1];
  };

  it("blurs every fixed corner in every piece, before the Short is cut from the middle", () => {
    const f = filter({ blur: DEFAULT_BLUR_REGIONS });
    expect(f.match(/boxblur/g)).toHaveLength(4);
    expect(f).toContain("[0:v]split=3[s0b][s0r0][s0r1]");
    expect(f).toContain("crop=w=iw*0.3000:h=ih*0.1800:x=iw*0.7000:y=ih*0.0000");
    expect(f.indexOf("overlay")).toBeLessThan(f.indexOf("setpts"));
    expect(f).toContain("[s1o0][s1k1]overlay=x=main_w*0.7000:y=main_h*0.0000[p1]");
  });

  it("leaves the picture alone without regions", () => {
    const f = filter({});
    expect(f).not.toContain("boxblur");
    expect(f).toContain("[0:v]setpts=");
  });

  it("drops regions that are broken, too small or outside the picture", () => {
    expect(cleanRegions([{ x: 0.9, y: 0, w: 0.5, h: 0.2 }, { x: 0, y: 0, w: 0.01, h: 0.2 }, { x: "a" }, null])).toEqual([{ x: 0.9, y: 0, w: 0.09999999999999998, h: 0.2 }]);
    expect(cleanRegions("nope")).toEqual([]);
  });

  it("mutes the game sound with and without narrator", () => {
    expect(filter({ muteGame: true })).toContain("[ac]volume=0[amix]");
    expect(filter({ muteGame: true, voice: [{ file: "line0.mp3", atMs: 0 }] })).toContain("[ac]volume=0[game]");
    expect(filter({ voice: [{ file: "line0.mp3", atMs: 0 }] })).toContain("[ac]volume=0.25[game]");
  });
});

describe("editor effects in the montage (fase C3)", () => {
  it("zooms into the middle of a segment with the zoom effect only", () => {
    const { args } = renderArgs({ ...base, segments: [{ ...seg(0, 5000), effects: ["zoom"] }, seg(9000, 12000)], size: renderSize("A") });
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("setpts=(PTS-STARTPTS)/1,crop=iw*0.8:ih*0.8,scale=-2:1920");
    expect(f.match(/crop=iw\*0\.8/g)).toHaveLength(1);
  });

  it("shows segment text during that segment, after speed-up", () => {
    const overlays = segmentOverlays([seg(0, 4000), { ...seg(10_000, 16_000, 2), text: "4 ZOMBIES" }], 60_000);
    expect(overlays).toEqual([{ startMs: 4000, endMs: 7000, text: "4 ZOMBIES" }]);
    const ass = buildAss({ size: renderSize("A"), topLine: null, lines: [], durationMs: 7000, overlays });
    expect(ass).toContain("Dialogue: 2,0:00:04.00,0:00:07.00,Overlay,,0,0,0,,4 ZOMBIES");
    expect(ass).toContain("Style: Overlay,Arial,70");
  });
});

describe("caption file for YouTube (fase D4b)", () => {
  it("writes the spoken lines with SRT times", async () => {
    const { buildSrt, srtTime, srtFileName } = await import("./render");
    expect(srtTime(62_450)).toBe("00:01:02,450");
    expect(srtTime(3_723_004)).toBe("01:02:03,004");
    const srt = buildSrt([{ at_ms: 0, text: "No way out." }, { at_ms: 2000, text: "Four zombies,\nhalf a heart." }], 10_000);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,200\nNo way out.\n\n2\n00:00:02,000 --> 00:00:04,000\nFour zombies, half a heart.\n");
    expect(srtFileName("abc-v1-12345678.mp4")).toBe("abc-v1-12345678.srt");
  });
});

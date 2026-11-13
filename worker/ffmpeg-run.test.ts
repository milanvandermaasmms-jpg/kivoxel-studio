import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { FfmpegSnapshot } from "../lib/youtube/progress.ts";
import { CancelledError, findTool, runFfmpeg } from "./ffmpeg.ts";

// Runs the real FFmpeg on a generated test picture (no gameplay). Skipped on a machine without FFmpeg.
const ffmpeg = findTool("ffmpeg");
const available = (() => {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const source = (seconds: number, realtime = false) => [...(realtime ? ["-re"] : []), "-f", "lavfi", "-i", `testsrc2=size=320x240:rate=30:duration=${seconds}`, "-f", "null", "-"];

describe.skipIf(!available)("FFmpeg runner (real FFmpeg)", () => {
  it("reports real progress and ends with a final snapshot", async () => {
    const seen: FfmpegSnapshot[] = [];
    await runFfmpeg(ffmpeg, source(3), tmpdir(), 30_000, { onProgress: (s) => seen.push(s) });
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.done).toBe(true);
    expect(last.frame).toBe(90);
    expect(last.outMs).toBeGreaterThanOrEqual(2900);
  });

  it("stops FFmpeg when cancelled, long before it would have finished", async () => {
    const control = new AbortController();
    const started = Date.now();
    setTimeout(() => control.abort(), 1500);
    await expect(runFfmpeg(ffmpeg, source(60, true), tmpdir(), 120_000, { signal: control.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("gives a clear Dutch error when FFmpeg fails", async () => {
    await expect(runFfmpeg(ffmpeg, ["-i", "bestaat-niet.mp4", "-f", "null", "-"], tmpdir(), 30_000)).rejects.toThrow(/FFmpeg kon de montage niet maken/);
  });
});

describe.skipIf(!available)("quality measurement (real FFmpeg)", () => {
  it("measures a generated clip: size, length, loudness and a black start", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { measureRender } = await import("./ffmpeg.ts");
    const { parseQcLog } = await import("../lib/youtube/qc.ts");
    const dir = mkdtempSync(join(tmpdir(), "qc-"));
    try {
      const file = join(dir, "clip.mp4");
      // 1 s black, then 3 s test picture, with a tone: black and loudness must be found.
      execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=320x240:r=30:d=1", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", file]);
      const { probe, stderr } = await measureRender(ffmpeg, findTool("ffprobe"), file, dir);
      expect(probe).toMatchObject({ width: 320, height: 240, hasAudio: true });
      expect(probe.durationMs).toBeGreaterThan(3500);
      const log = parseQcLog(stderr);
      expect(log.integratedLufs).not.toBeNull();
      expect(log.blackSeconds[0]).toBeGreaterThanOrEqual(0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(!available)("signal pass (fase 3, real FFmpeg)", () => {
  it("finds the black part, the still part and the scene cuts in a generated clip", async () => {
    const { mkdtempSync, rmSync: remove } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const { detectSignals } = await import("./ffmpeg.ts");
    const { buildTimeline } = await import("../lib/youtube/footage.ts");
    const dir = mkdtempSync(joinPath(tmpdir(), "kivoxel-signals-"));
    try {
      // TESTDATA: 4 s moving test picture, 3 s black and silent, 10 s one still colour and silent, 4 s moving again.
      const clip = joinPath(dir, "TESTDATA-signalen.mp4");
      const mono = "aformat=channel_layouts=mono:sample_rates=44100";
      execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4,volume=0.1",
        "-f", "lavfi", "-i", "color=black:size=320x180:rate=30:d=3", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=3",
        "-f", "lavfi", "-i", "color=red:size=320x180:rate=30:d=10", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=10",
        "-f", "lavfi", "-i", "mandelbrot=size=320x180:rate=30,trim=duration=4", "-f", "lavfi", "-i", "sine=f=200:d=4,volume=3",
        "-filter_complex", `[1]${mono}[a1];[3]${mono}[a3];[5]${mono}[a5];[7]${mono}[a7];[0][a1][2][a3][4][a5][6][a7]concat=n=4:v=1:a=1[v][a]`,
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", clip,
      ]);
      const signals = await detectSignals(ffmpeg, clip, 21_000, dir);
      const t = buildTimeline(signals);
      expect(signals.blacks).toEqual([{ startMs: 4000, endMs: 7000 }]);
      expect(t.dead.map((d) => d.kind)).toContain("still");
      expect(signals.sceneCutsMs.some((ms) => Math.abs(ms - 4000) <= 200)).toBe(true);
      expect(signals.silences.length).toBeGreaterThan(0);
      expect(signals.loudness.length).toBeGreaterThan(150);
    } finally {
      remove(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

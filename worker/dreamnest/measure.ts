// FFmpeg measurements for a Dreamnest clip: brightness per frame (flashes), and the loop seam (first vs last frame).
// Free, on this pc. The rules that judge them are in lib/dreamnest/motion.ts.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClipMeasure } from "../../lib/dreamnest/motion.ts";

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve, reject) => execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (e, stdout, stderr) => (e ? reject(new Error(String(stderr).slice(-400))) : resolve(`${stdout}\n${stderr}`))));

export function parseLuma(text: string): number[] {
  return [...text.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
}
export function parseSsim(text: string): number | null {
  const m = /All:([\d.]+)/.exec(text);
  return m ? Number(m[1]) : null;
}

export async function measureClip(ffmpeg: string, ffprobe: string, file: string, loop: boolean): Promise<ClipMeasure> {
  const info = JSON.parse(await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate:format=duration", "-of", "json", file]).then((t) => t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1))) as { streams: { r_frame_rate: string }[]; format: { duration: string } };
  const [n, d] = info.streams[0].r_frame_rate.split("/").map(Number);
  const luma = parseLuma(await run(ffmpeg, ["-hide_banner", "-i", file, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]));
  let seamSsim: number | null = null;
  // Every frame against the next one (at 480 px, fast enough): the median is a normal step, the minimum shows a hard cut.
  const steps = parseAllSsim(await run(ffmpeg, ["-hide_banner", "-i", file, "-i", file, "-filter_complex", "[0:v]scale=480:-2[a];[1:v]scale=480:-2,trim=start_frame=1,setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=-", "-f", "null", "-"]));
  const stepSsim = median(steps);
  const minStepSsim = steps.length ? Math.min(...steps) : null;
  if (loop) {
    const dir = await mkdtemp(join(tmpdir(), "dn-seam-"));
    try {
      await run(ffmpeg, ["-y", "-v", "error", "-i", file, "-frames:v", "1", join(dir, "first.png")]);
      await run(ffmpeg, ["-y", "-v", "error", "-sseof", "-0.2", "-i", file, "-update", "1", join(dir, "last.png")]);
      seamSsim = parseSsim(await run(ffmpeg, ["-hide_banner", "-i", join(dir, "first.png"), "-i", join(dir, "last.png"), "-lavfi", "ssim", "-f", "null", "-"]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { durationS: Number(info.format.duration), fps: d ? n / d : n, luma, seamSsim, stepSsim, minStepSsim };
}

/** Per-frame lines of the ssim stats file ("n:1 Y:.. All:0.98 (..)"), without the summary line. */
export function parseAllSsim(text: string): number[] {
  return [...text.matchAll(/^n:\d+.*?All:([\d.]+)/gm)].map((m) => Number(m[1]));
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Omni always makes sound; Dreamnest uses its own music and ambience, so the clip is kept silent. */
export const silentArgs = (input: string, output: string) => ["-y", "-v", "error", "-i", input, "-an", "-c:v", "copy", output];
export { run as runTool };

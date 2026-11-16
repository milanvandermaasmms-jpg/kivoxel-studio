// KIVOXEL fase 1: after every thumbnail, prove the yellow header matches brand/thumbnail_header.json.
// 1) the font file must be installed (otherwise libass silently picks another font);
// 2) the same header is drawn alone on black: that shows exactly where the letters belong;
// 3) at those places the thumbnail must be the brand yellow. A deviation fails the thumbnail.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkHeaderPixels, HEADER, type HeaderCheck, type HeaderSpec } from "../lib/kivoxel/brand.ts";

const run = promisify(execFile);

/** Where Windows keeps fonts: for all users, and for the current user only. */
export function fontPath(spec: HeaderSpec = HEADER, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = [join(env.WINDIR ?? "C:\\Windows", "Fonts"), env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : null].filter((d): d is string => !!d);
  for (const d of dirs) {
    const p = join(d, spec.font.windows_file);
    if (existsSync(p)) return p;
  }
  return null;
}

const raw = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"];

async function rgb(ffmpeg: string, args: string[], cwd: string): Promise<Uint8Array> {
  const { stdout } = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args, ...raw], { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  return new Uint8Array(stdout);
}

/**
 * Checks one finished thumbnail (JPEG) against its header file (.ass, in `cwd`).
 * The thumbnail is the same size as the header file's PlayRes, so pixels line up one to one.
 */
export async function checkThumbnailHeader(ffmpeg: string, thumb: string, assFile: string, size: { width: number; height: number }, cwd: string, spec: HeaderSpec = HEADER): Promise<HeaderCheck> {
  if (!fontPath(spec)) return { ok: false, textPixels: 0, matchShare: 0, reason: `Lettertype ${spec.font.family} (${spec.font.windows_file}) is niet geïnstalleerd op deze pc.` };
  const { width, height } = size;
  const reference = await rgb(ffmpeg, ["-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:d=1`, "-vf", `subtitles=${assFile}`, "-frames:v", "1"], cwd);
  const picture = await rgb(ffmpeg, ["-i", thumb, "-vf", `scale=${width}:${height}`, "-frames:v", "1"], cwd);
  return checkHeaderPixels(reference, picture, width, height, spec);
}

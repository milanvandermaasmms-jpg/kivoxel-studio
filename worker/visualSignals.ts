// Runs the free picture pass (lib/kivoxel/visual.ts) over a recording and keeps the result next to the signals,
// so every later step (events, thumbnails, Shorts) can use it without decoding the recording again.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createVisualParser, visualArgs, type VisualSignals } from "../lib/kivoxel/visual.ts";
import { CancelledError } from "./ffmpeg.ts";

export function detectVisual(ffmpeg: string, file: string, durationMs: number, options: { signal?: AbortSignal; onFrames?: (frames: number) => void } = {}): Promise<VisualSignals> {
  return new Promise((resolve, reject) => {
    const parser = createVisualParser(durationMs);
    const child = spawn(ffmpeg, visualArgs(file), { windowsHide: true });
    let errors = "";
    let frames = 0;
    const abort = () => child.kill();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      parser.feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      const now = parser.finish().frames.length;
      if (options.onFrames && now - frames >= 40) options.onFrames((frames = now));
    });
    child.stderr.on("data", (c: Buffer) => (errors = (errors + c.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(new CancelledError());
      if (code !== 0) return reject(new Error(`Beeldsignalen mislukt (FFmpeg ${code}): ${errors.trim().slice(-300)}`));
      resolve(parser.finish());
    });
  });
}

/** Cached per recording in <data>/visual/<fingerprint>.json. */
export async function visualFor(ffmpeg: string, dataDir: string, fingerprint: string, file: string, durationMs: number, options: Parameters<typeof detectVisual>[3] = {}): Promise<VisualSignals> {
  const dir = join(dataDir, "visual");
  const cache = join(dir, `${fingerprint}.json`);
  try {
    const stored = JSON.parse(await readFile(cache, "utf8")) as VisualSignals;
    if (stored.version === 3) return stored;
  } catch {
    // not measured yet
  }
  const v = await detectVisual(ffmpeg, file, durationMs, options);
  await mkdir(dir, { recursive: true });
  await writeFile(cache, JSON.stringify(v));
  return v;
}

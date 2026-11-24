// 24-11-2026: the free Fortnite HUD pass (lib/kivoxel/fortniteHud.ts): only the bottom-left corner of a Fortnite
// recording, cached next to the other picture signals in <data>/visual/<fingerprint>.fortnite.json.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFortniteParser, fortniteArgs, type FortniteSignals } from "../lib/kivoxel/fortniteHud.ts";
import { CancelledError } from "./ffmpeg.ts";

export function detectFortnite(ffmpeg: string, file: string, options: { signal?: AbortSignal } = {}): Promise<FortniteSignals> {
  return new Promise((resolve, reject) => {
    const parser = createFortniteParser();
    const child = spawn(ffmpeg, fortniteArgs(file), { windowsHide: true });
    let errors = "";
    const abort = () => child.kill();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => parser.feed(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    child.stderr.on("data", (c: Buffer) => (errors = (errors + c.toString()).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(new CancelledError());
      if (code !== 0) return reject(new Error(`Fortnite-balken meten mislukt (FFmpeg ${code}): ${errors.trim().slice(-300)}`));
      resolve(parser.finish());
    });
  });
}

export async function fortniteFor(ffmpeg: string, dataDir: string, fingerprint: string, file: string, options: { signal?: AbortSignal } = {}): Promise<FortniteSignals> {
  const dir = join(dataDir, "visual");
  const cache = join(dir, `${fingerprint}.fortnite.json`);
  try {
    const stored = JSON.parse(await readFile(cache, "utf8")) as FortniteSignals;
    if (stored.version === 1) return stored;
  } catch {
    // not measured yet
  }
  const s = await detectFortnite(ffmpeg, file, options);
  await mkdir(dir, { recursive: true });
  await writeFile(cache, JSON.stringify(s));
  return s;
}

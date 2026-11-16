import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
const t = await import("@huggingface/transformers");
t.env.cacheDir = join(homedir(), "FamilieMK-YouTube", "kivoxel-speech", "cache");
const pipe = await t.pipeline("automatic-speech-recognition", "Xenova/whisper-base", { dtype: "q8" });
for (const f of process.argv.slice(2)) {
  const raw = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", f, "-vn", "-ac", "1", "-ar", "16000", "-af", "highpass=f=150,lowpass=f=5000", "-f", "f32le", "-"], { maxBuffer: 1e9 }).stdout;
  const audio = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const r = (await pipe(audio, { return_timestamps: "word", language: "english", task: "transcribe" } as never)) as { chunks?: { timestamp: [number, number]; text: string }[] };
  console.log("==", f.split(/[\/]/).pop());
  console.log((r.chunks ?? []).map((c) => `${c.timestamp[0].toFixed(1)}:${c.text.trim()}`).join("  "));
}
process.exit(0);

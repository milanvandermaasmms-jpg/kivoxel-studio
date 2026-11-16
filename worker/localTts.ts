// KIVOXEL fase 1, section 8: a voice WITHOUT cloud credits, on this pc. Best available engine first:
//   1. Piper  (<data>/kivoxel-tts/piper/piper.exe + an English .onnx voice)  - natural, fast, offline
//   2. Kokoro (npm package kokoro-js, model cached by it)                    - natural, offline
//   3. Windows (System.Speech, "Microsoft Zira")                             - always there, robotic: last resort
// Every engine returns WAV; the sync gate measures its real length like it does for Google.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SpeakOptions } from "./tts.ts";

const run = promisify(execFile);

export type LocalTts = { name: string; ext: "wav"; speak: (text: string, options: SpeakOptions) => Promise<Buffer> };

/** SAPI rate is -10..10; our speaking rate 1.0 = normal. */
export const sapiRate = (rate: number) => Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)));

/** Windows' own voice (no download). Text goes through a file, never through the command line. */
export function windowsTts(voice = "Microsoft Zira Desktop"): LocalTts {
  return {
    name: `Windows (${voice.replace(/^Microsoft | Desktop$/g, "")})`,
    ext: "wav",
    async speak(text, options) {
      const dir = await mkdtemp(join(tmpdir(), "kivoxel-tts-"));
      try {
        const txt = join(dir, "line.txt");
        const wav = join(dir, "line.wav");
        await writeFile(txt, text, "utf8");
        const script = [
          "Add-Type -AssemblyName System.Speech",
          "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
          `try { $s.SelectVoice('${voice.replace(/'/g, "")}') } catch {}`,
          `$s.Rate = ${sapiRate(options.speakingRate)}`,
          `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}')`,
          `$s.Speak([IO.File]::ReadAllText('${txt.replace(/'/g, "''")}', [Text.Encoding]::UTF8))`,
          "$s.Dispose()",
        ].join("; ");
        await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 60_000, windowsHide: true });
        return await readFile(wav);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Piper: piper.exe with an English voice model, text on stdin, WAV out. */
export function piperTts(exe: string, model: string): LocalTts {
  return {
    name: `Piper (${model.replace(/^.*[\\/]/, "").replace(/\.onnx$/, "")})`,
    ext: "wav",
    async speak(text, options) {
      const dir = await mkdtemp(join(tmpdir(), "kivoxel-piper-"));
      try {
        const wav = join(dir, "line.wav");
        // length_scale < 1 = faster; our rate 1.1 -> 0.91.
        const child = execFile(exe, ["--model", model, "--output_file", wav, "--length_scale", (1 / Math.max(0.5, options.speakingRate)).toFixed(2)], { timeout: 60_000, windowsHide: true });
        await new Promise<void>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Piper stopte met code ${code}`))));
          child.stdin?.end(text);
        });
        return await readFile(wav);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

type KokoroModel = { generate: (t: string, o: Record<string, unknown>) => Promise<{ toWav: () => ArrayBuffer }> };
/** One model per process: the gate speaks all lines at once, and five parallel loads lock the model file (error 13). */
let kokoroModel: Promise<KokoroModel> | null = null;
/** Kokoro runs one line at a time (it is CPU-heavy); lines queue up behind each other. */
let kokoroQueue: Promise<unknown> = Promise.resolve();

/** Kokoro via the npm package kokoro-js (only when it is installed). The model is kept in <cacheDir> (on this pc). */
export async function kokoroTts(voice = "am_michael", cacheDir?: string): Promise<LocalTts | null> {
  let mod: { KokoroTTS?: { from_pretrained: (id: string, o: Record<string, unknown>) => Promise<KokoroModel> } };
  try {
    mod = (await import(/* @vite-ignore */ "kokoro-js" as string)) as typeof mod;
    if (cacheDir) {
      // Keep the downloaded model out of node_modules (that folder may be read-only or wiped by npm).
      const hf = (await import(/* @vite-ignore */ "@huggingface/transformers" as string)) as { env?: { cacheDir?: string } };
      if (hf.env) hf.env.cacheDir = cacheDir;
    }
  } catch {
    return null;
  }
  if (!mod.KokoroTTS) return null;
  return {
    name: `Kokoro (${voice})`,
    ext: "wav",
    speak(text, options) {
      kokoroModel ??= mod.KokoroTTS!.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
      const job = kokoroQueue.then(async () => {
        const model = await kokoroModel!;
        const audio = await model.generate(text, { voice, speed: options.speakingRate });
        return Buffer.from(audio.toWav());
      });
      kokoroQueue = job.catch(() => undefined);
      return job;
    },
  };
}

/** Where Piper lives on this pc, if Milan installed it: <data>/kivoxel-tts/piper/piper.exe + the first en_*.onnx voice. */
export function findPiper(dataDir: string): { exe: string; model: string } | null {
  const dir = join(dataDir, "kivoxel-tts", "piper");
  const exe = [join(dir, "piper.exe"), join(dir, "piper", "piper.exe")].find((p) => existsSync(p));
  if (!exe || !existsSync(dir)) return null;
  const voices = readdirSync(dir).filter((f) => /^en_.*\.onnx$/.test(f));
  return voices.length ? { exe, model: join(dir, voices[0]) } : null;
}

/** The best local voice on this pc, in the order of presets.json (voice.local_order); Windows is always the last resort. */
export async function bestLocalTts(dataDir: string, order: ("kokoro" | "piper" | "windows")[] = ["kokoro", "piper", "windows"], kokoroVoice = "am_puck"): Promise<LocalTts> {
  for (const engine of order) {
    if (engine === "piper") {
      const piper = findPiper(dataDir);
      if (piper) return piperTts(piper.exe, piper.model);
    } else if (engine === "kokoro") {
      const kokoro = await kokoroTts(kokoroVoice, join(dataDir, "kivoxel-tts", "kokoro-cache"));
      if (kokoro) return kokoro;
    } else return windowsTts();
  }
  return windowsTts();
}

// KIVOXEL fase 1, sections 1a and 7.8: the real reactions of the kids ("NOOO!") found with local speech recognition
// (Whisper base via transformers.js, free, on this pc). Only short windows around the candidate moments are listened
// to, so a long recording costs seconds, not minutes. The words stay on this pc (<data>/speech/<fingerprint>.json):
// they are never shown or spoken in a video (videos are English) and never sent to a cloud service; only the moment
// and how loud it was go into the Event Timeline.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Reaction } from "../lib/kivoxel/events.ts";
import { runFfmpeg } from "./ffmpeg.ts";

export const SPEECH_VERSION = 1;
export const WHISPER_MODEL = "Xenova/whisper-base";

type Chunk = { timestamp: [number, number | null]; text: string };
type Asr = (audio: Float32Array) => Promise<{ chunks?: Chunk[]; text?: string }>;

/** Whisper's known inventions on noise and music; never a reaction. */
const HALLUCINATION = /thank(s| you)|subtit|ondertitel|amara|♪|\bmusic\b|muziek|applause|copyright|www\.|\.com|^\s*[[(]/i;

/** Windows of `before`/`after` ms around each time, joined when they touch, inside the recording. */
export function speechWindows(times: number[], durationMs: number, before = 4000, after = 3000): [number, number][] {
  const sorted = [...times].sort((a, b) => a - b).map((t) => [Math.max(0, t - before), Math.min(durationMs, t + after)] as [number, number]);
  const out: [number, number][] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else if (w[1] - w[0] >= 500) out.push([...w]);
  }
  return out;
}

/** A short, loud shout is a reaction; long sentences (explaining), noise and Whisper's inventions are not. */
export function reactionsFrom(chunks: Chunk[], offsetMs: number, loudness: number[]): Reaction[] {
  const out: Reaction[] = [];
  for (const c of chunks) {
    const text = c.text.trim();
    const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
    if (!words.length || words.length > 6 || text.length > 60 || HALLUCINATION.test(text)) continue;
    const atMs = Math.round(offsetMs + c.timestamp[0] * 1000);
    const endMs = Math.round(offsetMs + (c.timestamp[1] ?? c.timestamp[0] + 1) * 1000);
    // A shout is short; a "word" spread over many seconds is Whisper guessing at noise.
    if (endMs <= atMs || endMs - atMs > 4000) continue;
    const span = loudness.slice(Math.floor(atMs / 100), Math.ceil(endMs / 100) + 1).filter((v) => Number.isFinite(v));
    const loud = span.length ? Math.max(...span) : -40;
    // Quiet mumbling is no reaction worth showing.
    if (loud < -32) continue;
    out.push({ atMs, endMs, text, loudness: loud });
  }
  return out;
}

let asrPromise: Promise<Asr | null> | null = null;
/** One Whisper model per worker; null when transformers.js or the model cannot be loaded (then: no reactions, no error). */
function loadAsr(cacheDir: string): Promise<Asr | null> {
  asrPromise ??= (async () => {
    try {
      const t = await import("@huggingface/transformers");
      t.env.cacheDir = cacheDir;
      const pipe = await t.pipeline("automatic-speech-recognition", WHISPER_MODEL, { dtype: "q8" });
      // The kids speak Dutch while playing; the words only mark the moment (nothing of it goes into a video).
      return async (audio: Float32Array) => (await pipe(audio, { return_timestamps: true, chunk_length_s: 30, task: "transcribe", language: "dutch" })) as { chunks?: Chunk[]; text?: string };
    } catch {
      asrPromise = null;
      return null;
    }
  })();
  return asrPromise;
}

export function createSpeechStore(ffmpeg: string, dataDir: string) {
  const dir = join(dataDir, "speech");
  const file = (fp: string) => join(dir, `${fp}.json`);
  return {
    /** The kids' reactions near `times` (ms); cached per recording. Never throws: without Whisper the list is empty. */
    async reactions(fingerprint: string, recordingPath: string, durationMs: number, times: number[], loudness: number[], signal?: AbortSignal): Promise<Reaction[]> {
      try {
        const c = JSON.parse(await readFile(file(fingerprint), "utf8")) as { version: number; reactions: Reaction[] };
        if (c.version === SPEECH_VERSION) return c.reactions;
      } catch {
        /* not made yet */
      }
      const asr = await loadAsr(join(dataDir, "kivoxel-speech", "cache"));
      if (!asr) return [];
      await mkdir(dir, { recursive: true });
      const reactions: Reaction[] = [];
      for (const [i, [from, to]] of speechWindows(times, durationMs).entries()) {
        if (signal?.aborted) return reactions;
        const raw = `speech-${fingerprint.slice(0, 8)}-${i}.f32`;
        try {
          await runFfmpeg(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", (from / 1000).toFixed(3), "-t", ((to - from) / 1000).toFixed(3), "-i", recordingPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", raw], dir, 120_000);
          const buf = await readFile(join(dir, raw));
          const audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
          const r = await asr(audio);
          reactions.push(...reactionsFrom(r.chunks ?? [], from, loudness));
        } catch {
          /* one window failing never stops the rest */
        } finally {
          await rm(join(dir, raw), { force: true });
        }
      }
      await writeFile(file(fingerprint), JSON.stringify({ version: SPEECH_VERSION, model: WHISPER_MODEL, reactions }));
      return reactions;
    },
  };
}
export type SpeechStore = ReturnType<typeof createSpeechStore>;

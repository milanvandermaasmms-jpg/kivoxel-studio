// KIVOXEL fase 1, section 1c on this pc: speak every script line on its own (better intonation, exact timing),
// measure the real length, run the sync gate, and make lines at most 1.08x faster where the gate asks for it.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { persona, type Settings } from "../lib/kivoxel/config.ts";
import type { EventTimeline } from "../lib/kivoxel/events.ts";
import { runGate, type GateRun, type VoLine } from "../lib/kivoxel/voiceScript.ts";
import type { Segment, ScriptLine } from "../lib/youtube/analysis.ts";
import type { VoiceClip } from "../lib/youtube/render.ts";
import type { Tts } from "./tts.ts";
import { tempoArgs, tightenArgs } from "./ffmpeg.ts";
import { heardMatch, type HeardWord } from "../lib/kivoxel/captions.ts";

export type VoiceGateInput = {
  lines: VoLine[];
  segments: Segment[];
  timeline: EventTimeline | null;
  targetMs: number;
  settings: Settings;
  /** Google TTS, or a local voice (worker/localTts.ts) that returns WAV. */
  tts: Pick<Tts, "speak"> & { ext?: string };
  voiceName: string;
  baseRate: number;
  tmp: string;
  reserve: (characters: number) => Promise<unknown>;
  duration: (file: string) => Promise<number>;
  run: (args: string[], cwd: string, timeoutMs: number) => Promise<void>;
  /** Whisper on a voice clip: the words really said, with times (ms in the clip). The captions follow them. */
  align?: (file: string, cwd: string) => Promise<{ text: string; startMs: number; endMs: number }[] | null>;
  /** A cloned voice can skip or invent words: check every line against what was heard, speak it again when it does not match. */
  verify?: boolean;
};

/** The TTS rate for a line: the channel's rate times the style of the line (voice_persona.json), within Google's limits. */
export function rateFor(style: VoLine["style"], baseRate: number): number {
  const styles = persona.tts_styles as unknown as Record<string, { rate: number } | undefined>;
  const r = baseRate * (styles[style ?? "normaal"]?.rate ?? 1);
  return Math.round(Math.min(1.5, Math.max(0.75, r)) * 100) / 100;
}

export async function speakWithGate(input: VoiceGateInput): Promise<{ clips: VoiceClip[]; spoken: (ScriptLine & { ms: number; heard?: HeardWord[] })[]; result: GateRun; characters: number; files: (string | null)[]; firstFiles: (string | null)[] }> {
  const files = new Map<VoLine, string>();
  let n = 0;
  let characters = 0;
  const result = await runGate({
    lines: input.lines,
    segments: input.segments,
    timeline: input.timeline,
    targetMs: input.targetMs,
    settings: input.settings,
    async speak(line) {
      await input.reserve(line.text.length);
      characters += line.text.length;
      const k = n++;
      let best: { file: string; match: number } | null = null;
      for (let attempt = 0; attempt < (input.verify && input.align ? 3 : 1); attempt++) {
        const raw = `vo${k}${attempt ? `-${attempt}` : ""}.${input.tts.ext ?? "mp3"}`;
        await writeFile(join(input.tmp, raw), await input.tts.speak(line.text, { voiceName: input.voiceName, speakingRate: rateFor(line.style, input.baseRate), style: line.style }));
        // Tight: no silence before, after or long pauses inside the line.
        const file = raw.replace(/.(mp3|wav)$/, "-strak.wav");
        await input.run(tightenArgs(raw, file), input.tmp, 60_000);
        if (!input.verify || !input.align) {
          best = { file, match: 1 };
          break;
        }
        const heard = await input.align(join(input.tmp, file), input.tmp);
        const match = heard ? heardMatch(line.text, heard) : 1;
        if (!best || match > best.match) best = { file, match };
        if (match >= 0.75) break;
      }
      files.set(line, best!.file);
      return input.duration(join(input.tmp, best!.file));
    },
  });
  const clips: VoiceClip[] = [];
  const spoken: (ScriptLine & { ms: number; heard?: HeardWord[] })[] = [];
  for (const [i, line] of result.lines.entries()) {
    const item = result.gate.items[i];
    let file = files.get(line);
    if (!file || !item?.ok) continue;
    if (item.speed > 1) {
      const fast = file.replace(/\.(mp3|wav)$/, "-snel.wav");
      await input.run(tempoArgs(file, fast, item.speed), input.tmp, 60_000);
      file = fast;
    }
    clips.push({ file, atMs: item.atMs });
    // The real word times of the final clip (after any speed-up), so captions and voice run exactly together.
    const heard = input.align ? await input.align(join(input.tmp, file), input.tmp) : null;
    spoken.push({ at_ms: item.atMs, text: line.text, ms: item.ms, ...(heard?.length ? { heard: heard.map((w) => ({ text: w.text, startMs: item.atMs + w.startMs, endMs: item.atMs + w.endMs })) } : {}) });
  }
  return { clips, spoken, result, characters, files: result.lines.map((l) => files.get(l) ?? null), firstFiles: input.lines.map((l) => files.get(l) ?? null) };
}

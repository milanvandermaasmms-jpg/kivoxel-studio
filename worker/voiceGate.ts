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
import { tempoArgs } from "./ffmpeg.ts";

export type VoiceGateInput = {
  lines: VoLine[];
  segments: Segment[];
  timeline: EventTimeline | null;
  targetMs: number;
  settings: Settings;
  tts: Tts;
  voiceName: string;
  baseRate: number;
  tmp: string;
  reserve: (characters: number) => Promise<unknown>;
  duration: (file: string) => Promise<number>;
  run: (args: string[], cwd: string, timeoutMs: number) => Promise<void>;
};

/** The TTS rate for a line: the channel's rate times the style of the line (voice_persona.json), within Google's limits. */
export function rateFor(style: VoLine["style"], baseRate: number): number {
  const styles = persona.tts_styles as unknown as Record<string, { rate: number } | undefined>;
  const r = baseRate * (styles[style ?? "normaal"]?.rate ?? 1);
  return Math.round(Math.min(1.5, Math.max(0.75, r)) * 100) / 100;
}

export async function speakWithGate(input: VoiceGateInput): Promise<{ clips: VoiceClip[]; spoken: ScriptLine[]; result: GateRun; characters: number; files: (string | null)[]; firstFiles: (string | null)[] }> {
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
      const file = `vo${n++}.mp3`;
      await writeFile(join(input.tmp, file), await input.tts.speak(line.text, { voiceName: input.voiceName, speakingRate: rateFor(line.style, input.baseRate) }));
      files.set(line, file);
      return input.duration(join(input.tmp, file));
    },
  });
  const clips: VoiceClip[] = [];
  const spoken: ScriptLine[] = [];
  for (const [i, line] of result.lines.entries()) {
    const item = result.gate.items[i];
    let file = files.get(line);
    if (!file || !item?.ok) continue;
    if (item.speed > 1) {
      const fast = file.replace(/\.mp3$/, "-snel.wav");
      await input.run(tempoArgs(file, fast, item.speed), input.tmp, 60_000);
      file = fast;
    }
    clips.push({ file, atMs: item.atMs });
    spoken.push({ at_ms: item.atMs, text: line.text });
  }
  return { clips, spoken, result, characters, files: result.lines.map((l) => files.get(l) ?? null), firstFiles: input.lines.map((l) => files.get(l) ?? null) };
}

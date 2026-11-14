// Edit proposals from Ivar: cuts named in the timecodes Milan sees (the finished video) become cuts in the recording,
// applied on a NEW script version with cutPlan (lib/youtube/viral.ts). The source and earlier versions stay. Pure.
import type { ScriptLine, Segment } from "../youtube/analysis.ts";
import { cutPlan } from "../youtube/viral.ts";

/** The parts of the recording behind one span of the finished video. */
export function outputToSource(segments: Segment[], fromMs: number, toMs: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of segments) {
    const len = (s.src_end_ms - s.src_start_ms) / s.speed;
    const a = Math.max(fromMs, s.out_start_ms);
    const b = Math.min(toMs, s.out_start_ms + len);
    if (b <= a) continue;
    out.push([Math.round(s.src_start_ms + (a - s.out_start_ms) * s.speed), Math.round(s.src_start_ms + (b - s.out_start_ms) * s.speed)]);
  }
  return out;
}

export type EditOutcome = { segments: Segment[]; lines: ScriptLine[]; removedMs: number; sourceCuts: [number, number][] } | { error: string };

/** Cuts (in finished-video time) on a montage plan. Refuses cuts that would leave almost nothing. */
export function applyCuts(segments: Segment[], lines: ScriptLine[], cuts: { from_ms: number; to_ms: number }[], minLeftMs = 5000): EditOutcome {
  if (!segments.length) return { error: "Deze versie heeft nog geen montageplan." };
  const total = segments.reduce((sum, s) => Math.max(sum, s.out_start_ms + (s.src_end_ms - s.src_start_ms) / s.speed), 0);
  const sourceCuts: [number, number][] = [];
  for (const c of cuts) {
    if (c.to_ms <= c.from_ms) return { error: `Knip ${c.from_ms}-${c.to_ms}: het einde moet na het begin liggen.` };
    if (c.from_ms >= total) return { error: `Knip vanaf ${Math.round(c.from_ms / 1000)} s valt na het einde van de video.` };
    sourceCuts.push(...outputToSource(segments, c.from_ms, Math.min(c.to_ms, total)));
  }
  if (!sourceCuts.length) return { error: "Deze stukken komen niet in de montage voor." };
  const result = cutPlan(segments, lines, sourceCuts);
  if (total - result.removedMs < minLeftMs) return { error: "Na deze knippen blijft er bijna niets over." };
  return { ...result, sourceCuts };
}

/** New narration texts on the same timing; returns how many lines changed. */
export function replaceLines(lines: ScriptLine[], changes: { index: number; text: string }[]): { lines: ScriptLine[]; changed: number } | { error: string } {
  const next = lines.map((l) => ({ ...l }));
  let changed = 0;
  for (const c of changes) {
    if (!next[c.index]) return { error: `Regel ${c.index + 1} bestaat niet (er zijn ${lines.length} regels).` };
    const text = c.text.trim();
    if (!text) return { error: `Regel ${c.index + 1} kan niet leeg zijn; laat Ivar hem weghalen via een knip.` };
    if (next[c.index].text !== text) changed++;
    next[c.index].text = text;
  }
  return { lines: next, changed };
}

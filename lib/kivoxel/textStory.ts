// KIVOXEL fase 1, section 3: without a voice (modes muziek_geen_vo and alleen_game) the story is told with text in the
// picture, with the same anticipation rule: the text comes BEFORE the action ("WAIT FOR IT…" -> action -> reaction)
// and is gone during the peak. Same lines as the voice script, placed by the same gate with reading time instead of
// speaking time.
import type { Settings } from "./config.ts";
import type { EventTimeline } from "./events.ts";
import type { Segment } from "../youtube/analysis.ts";
import { assText, assTime, type Overlay } from "../youtube/render.ts";
import { HEADER, assColour } from "./brand.ts";
import { syncGate, type VoLine } from "./voiceScript.ts";

/** How long a text needs on screen: about 0.3 s per word, at least 0.9 s (short punchy texts), at most 2.6 s. */
export const readMs = (text: string) => Math.min(2600, Math.max(900, text.split(/\s+/).filter(Boolean).length * 300 + 300));

/** Shorter on screen than spoken: the shortest version of each line, in capitals. */
const screenText = (l: VoLine) => [l.text, ...(l.alts ?? [])].sort((a, b) => a.length - b.length)[0].toUpperCase();

export type StoryText = Overlay & { reaction: boolean };

export function textOverlays(lines: VoLine[], segments: Segment[], timeline: EventTimeline | null, targetMs: number, settings: Settings): { overlays: StoryText[]; dropped: string[] } {
  // The hook is already at the top of a Short; on screen it would be said twice.
  const story = lines.filter((l) => l.kind !== "hook").map((l) => ({ ...l, text: screenText(l), alts: [] }));
  const gate = syncGate(story, story.map((l) => readMs(l.text)), segments, timeline, targetMs, settings);
  const overlays: StoryText[] = [];
  const dropped: string[] = [];
  for (const it of gate.items) {
    if (it.ok) overlays.push({ startMs: it.atMs, endMs: it.atMs + it.ms, text: story[it.index].text, reaction: story[it.index].kind === "reaction" });
    else dropped.push(story[it.index].text);
  }
  return { overlays, dropped };
}

/**
 * The story texts as ASS: big Arial Black with a thick outline, just below the middle (away from the game's own
 * messages at the top and the HUD at the bottom), popping in; reactions in the brand yellow and a bit bigger.
 */
export function storyAss(texts: StoryText[], size: { width: number; height: number }, durationMs: number): { style: string; events: string[] } {
  const font = Math.round(size.height * 0.05);
  const x = Math.round(size.width / 2);
  const y = Math.round(size.height * 0.56);
  const style = `Style: Story,${HEADER.font.family},${font},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,8,3,5,70,140,0,1`;
  const events = texts
    .filter((t) => t.text.trim() && t.endMs > t.startMs)
    .map((t) => {
      const colour = t.reaction ? `\\c${assColour(HEADER.color_hex)}\\fs${Math.round(font * 1.35)}` : "";
      return `Dialogue: 4,${assTime(t.startMs)},${assTime(Math.min(t.endMs, durationMs))},Story,,0,0,0,,{\\an5\\pos(${x},${y})${colour}\\fscx70\\fscy70\\t(0,120,\\fscx106\\fscy106)\\t(120,200,\\fscx100\\fscy100)}${assText(t.text)}`;
    });
  return { style, events };
}

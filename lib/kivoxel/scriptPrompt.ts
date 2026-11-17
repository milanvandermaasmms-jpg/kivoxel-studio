// KIVOXEL fase 1, section 1b with the AI (Gemini, within the € 5 budget): the same rules as the free engine, the
// timeline as input. The model also writes shorter versions of every line, so the sync gate can shorten without a
// second paid call.
import { looksDutch, persona, type EventType, type Language, type Settings } from "./config.ts";
import type { EventTimeline, GameEvent } from "./events.ts";
import { HUD_RULE, readsHud, type Segment } from "../youtube/analysis.ts";
import { estimateMs, eventsInMontage, type LineKind, type TtsStyle, type VoLine } from "./voiceScript.ts";

/**
 * The event in English for the model. The stored descriptions are Dutch notes for Milan; giving those to the model
 * would invite Dutch words into an English script.
 */
export function englishDescription(e: GameEvent): string {
  const hearts = [...e.description.matchAll(/([\d,]+) hartjes/g)].map((m) => m[1].replace(",", "."));
  const from = /van ([\d,]+) naar/.exec(e.description)?.[1]?.replace(",", ".");
  if (e.kind === "death") return "the player dies (hardcore GAME OVER screen)";
  if (e.kind === "damage") return `the player takes a big hit: from ${from ?? "?"} to ${hearts.at(-1) ?? "?"} hearts`;
  if (e.kind === "low_health") return `only ${hearts.at(-1) ?? "a few"} hearts left, one more hit could end it`;
  if (e.kind === "audio_peak") return "a sudden loud sound (an explosion, a hit or a mob)";
  if (e.kind === "kid_reaction") return "the kids react loudly";
  // AI moments come from the analysis, which writes in English.
  // Quoted on-screen text (death messages, pop-ups) invites the model to read it aloud: leave it out.
  return looksDutch(e.description) ? "something exciting happens" : e.description.replace(/["“][^"”]*["”]/g, "an on-screen message");
}

/** Things the narrator must never say (they push viewers away or make them lower the sound). */
const BAD = /\b(speakers?|volume|headphones|turn (it|your sound|the sound) down|skip|look away|in this video|subscribe)\b/i;
const KINDS: LineKind[] = ["hook", "anticipation", "reaction", "open_loop", "bridge", "loop"];
const STYLES: TtsStyle[] = ["spannend", "fluisterend", "schreeuw", "lachend", "normaal"];
const tc = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function anticipationPrompt(input: { segments: Segment[]; targetMs: number; timeline: EventTimeline | null; language?: Language; settings: Settings; short: boolean; recent?: string[]; note?: string; /** What the frames show (section 1a, vision model). */ evidence?: string; /** Milan's own story of the recording. */ story?: string }): { prompt: string; ids: Map<string, number> } {
  // KIVOXEL videos are English, always.
  const lang = "English";
  const events = eventsInMontage(input.segments, input.timeline).filter((e) => e.peak_out < input.targetMs - 800);
  const ids = new Map<string, number>();
  const list = events.map((e, i) => {
    const id = `E${i + 1}`;
    ids.set(id, e.t_peak);
    return `${id}: peak at ${tc(e.peak_out)}, type ${e.type ?? "action"}, payoff ${e.payoff}/100, what happens: ${englishDescription(e)}`;
  });
  const p = persona;
  const s = input.settings.sync;
  const prompt = [
    `You write the voice-over for a ${input.short ? "YouTube Short" : "long YouTube video"} of Minecraft gameplay recorded by kids, in ${lang}. Video length: ${tc(input.targetMs)}.`,
    "These events happen in the video (times are in the finished video). Use ONLY these; invent nothing:",
    ...(list.length ? list : ["(no clear events: keep it short, curious and light)"]),
    ...(input.evidence ? [input.evidence] : []),
    ...(input.story?.trim() ? [input.story.trim()] : []),
    "",
    "THE MOST IMPORTANT RULE (anticipation): the voice tells what is ABOUT to happen, never what is already on screen.",
    `A line about an event must END ${(s.lead_min_ms / 1000).toFixed(1)}-${(s.lead_max_ms / 1000).toFixed(1)} s BEFORE its peak. During the peak: silence (let the game sound hit). After the peak at most ONE short reaction (1-4 words), then on to the next build-up.`,
    `Wrong (describing): "He falls into the lava." Right (tension): "Okay… one wrong step and this goes very wrong…" -> [peak] -> "…yep. There it goes."`,
    "Plant open loops early: a question or a hint that is only answered at the payoff (\"Keep an eye on his hearts…\").",
    `The first line is the hook: spoken within the first 0.5 s, at most 7 words, no greeting, no "in this video". Make it explosive, not calm.`,
    "Never leave more than 6 seconds without a line before the next moment: keep the tension up with short build-up lines.",
    "Never tell viewers to turn their sound down, look away, skip or leave; never mention speakers, volume or the video itself.",
    HUD_RULE,
    "",
    `Voice: ${p.feel.age}; energy: ${p.feel.energy}; humor: ${p.feel.humor}. Kid-friendly, never mean.`,
    ...p.style_rules.map((r) => `- ${r}`),
    `Write ONLY in English. Never any other language, not even one word.`,
    `Never use: ${p.banned_phrases.join(", ")}.`,
    `Interjections you may use (vary, do not repeat): ${p.expressions.interjection.join(" | ")}`,
    `Example reactions (explosive, never calm or ironic): ${p.expressions.reaction.join(" | ")}`,
    ...(input.recent?.length ? [`Recently used, do NOT use again: ${input.recent.slice(-20).join(" | ")}`] : []),
    ...(input.note ? [`The owner's comment on the previous version: "${input.note.replace(/"/g, "'")}". Change only what it asks.`] : []),
    "",
    'Answer only with JSON: {"lines":[{"event":"E1" or null,"kind":"hook|anticipation|reaction|open_loop|bridge|loop","text":"…","shorter":["shorter version","even shorter"],"style":"spannend|fluisterend|schreeuw|lachend|normaal"}]}',
    'Every anticipation and reaction line names its event. Give every line 1-2 shorter versions with the same meaning (the timing check uses them when the spoken line is too long). Order the lines by time.',
  ].join("\n");
  return { prompt, ids };
}

/** Checks the model's answer and turns it into script lines with a first time estimate (the gate places them for real). */
export function parseAnticipation(json: unknown, ids: Map<string, number>, segments: Segment[], targetMs: number, timeline: EventTimeline | null): { lines: VoLine[] } | { error: string } {
  // The model sometimes answers with the bare list instead of {"lines": [...]}: accept both.
  const raw = Array.isArray(json) ? json : (json as { lines?: unknown })?.lines;
  if (!Array.isArray(raw) || !raw.length) return { error: "geen regels" };
  const events = eventsInMontage(segments, timeline);
  const lines: VoLine[] = [];
  let cursor = 0;
  for (const r of raw as Record<string, unknown>[]) {
    let text = typeof r.text === "string" ? r.text.trim().replace(/\s+/g, " ").slice(0, 200) : "";
    // Lines that send viewers away or make them lower the sound cost retention: take a clean shorter version, or drop it.
    // Same for a line that reads numbers off the HUD (Milan 15-11-2026: "hij benoemt de tijd en gekke coördinaten!").
    const wrong = (t: string) => BAD.test(t) || readsHud(t);
    if (wrong(text)) text = Array.isArray(r.shorter) ? ((r.shorter as unknown[]).find((a): a is string => typeof a === "string" && !!a.trim() && !wrong(a)) ?? "").trim() : "";
    if (!text) continue;
    const kind = KINDS.includes(r.kind as LineKind) ? (r.kind as LineKind) : "bridge";
    const style = STYLES.includes(r.style as TtsStyle) ? (r.style as TtsStyle) : "normaal";
    const src = typeof r.event === "string" ? ids.get(r.event) : undefined;
    const ev = src !== undefined ? events.find((e) => e.t_peak === src) : undefined;
    const alts = Array.isArray(r.shorter) ? (r.shorter as unknown[]).filter((a): a is string => typeof a === "string" && a.trim().length > 0 && a.length < text.length && !wrong(a)).map((a) => a.trim()).slice(0, 3) : [];
    let at = cursor;
    if (kind === "hook") at = 0;
    else if (ev && kind === "anticipation") at = Math.max(0, ev.peak_out - 600 - estimateMs(text));
    else if (ev && kind === "reaction") at = ev.peak_out + 250;
    else if (kind === "loop") at = Math.max(0, targetMs - estimateMs(text) - 400);
    lines.push({ at_ms: Math.round(at), text, kind, style, alts: alts.sort((a, b) => b.length - a.length), ...(ev ? { event_src_ms: ev.t_peak, event_id: ev.id } : {}) });
    cursor = at + estimateMs(text) + 200;
  }
  if (!lines.length) return { error: "alle regels leeg" };
  return { lines: lines.sort((a, b) => a.at_ms - b.at_ms) };
}

export const hookTypeOf = (lines: VoLine[], timeline: EventTimeline | null): EventType | null => {
  const id = lines.find((l) => l.event_id)?.event_id;
  return timeline?.events.find((e) => e.id === id)?.type ?? null;
};

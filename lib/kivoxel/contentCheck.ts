// 23-11-2026 (Milan, vervolgopdracht prioriteit 5, akkoord op de kosten): the AI content check. Gemini watches the
// finished export (picture and sound) and judges what the pc cannot measure: is the right moment chosen (fragment), is
// there a build-up and a clear story (verhaal), is it original and entertaining (originaliteit), and does the opening
// grab (hook). Each with evidence and time codes from what it really saw and heard; "unclear" is allowed and stays
// open. It is labelled "AI" everywhere: an outside judgement, never Milan's. Cost ± 1-3 cent per video. Pure, tested.

import type { PartKey, ViralResult } from "./viralScore.ts";

export const AI_PARTS = ["hook", "fragment", "verhaal", "originaliteit"] as const satisfies readonly PartKey[];
export type AiPart = (typeof AI_PARTS)[number];
export type AiVerdict = { score: number | null; evidence: string };
export type ContentCheck = { parts: Record<AiPart, AiVerdict>; summary: string; checkedAt: string; model: string };

export function contentPrompt(input: { kind: "short" | "long"; game: string; script: string[]; briefing?: string | null }): string {
  return [
    `You review a finished ${input.kind === "short" ? "YouTube Short (vertical)" : "long YouTube video"} of ${input.game} gameplay for a kids' gaming channel (faceless, English voice-over or none).`,
    "Watch and listen to the whole video. Judge ONLY what you really see and hear. Never guess; if something is unclear, give score null and say why.",
    "Score 0-10 (10 = excellent, 8 = good enough to publish) for:",
    "- hook: do the first 3 seconds make a viewer stay (something happens or is promised right away)?",
    "- fragment: is this a strong moment of the game (action, danger, surprise, a find), not menus, inventory, walking or empty sky?",
    "- verhaal: is there a build-up and a clear outcome a viewer understands without context?",
    "- originaliteit: is it entertaining and does it feel fresh, not generic?",
    "For each give evidence: one or two short sentences IN DUTCH with time codes (m:ss) of what you saw or heard.",
    ...(input.script.length ? ["Voice-over / text lines of this video (check that they match the picture):", ...input.script.slice(0, 30).map((l) => `- ${l}`)] : []),
    ...(input.briefing ? [`The owner's briefing (direction only): ${input.briefing}`] : []),
    'Answer JSON only: {"hook":{"score":n|null,"evidence":"..."},"fragment":{...},"verhaal":{...},"originaliteit":{...},"summary":"one sentence in Dutch"}',
  ].join("\n");
}

const clean = (v: unknown): AiVerdict => {
  const o = (v ?? {}) as { score?: unknown; evidence?: unknown };
  const n = typeof o.score === "number" && Number.isFinite(o.score) ? Math.max(0, Math.min(10, Math.round(o.score * 10) / 10)) : null;
  const evidence = typeof o.evidence === "string" ? o.evidence.trim().slice(0, 300) : "";
  // A score without evidence is not accepted (nothing invented): it stays open.
  return { score: evidence ? n : null, evidence: evidence || "Geen onderbouwing gegeven" };
};

export function parseContentCheck(json: unknown, model: string, now = new Date()): ContentCheck {
  const o = (json ?? {}) as Record<string, unknown>;
  const parts = Object.fromEntries(AI_PARTS.map((k) => [k, clean(o[k])])) as Record<AiPart, AiVerdict>;
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 300) : "";
  return { parts, summary, checkedAt: now.toISOString(), model };
}

/**
 * The AI judgement fills the parts nobody judged yet (source null) and stands next to measured parts as extra evidence;
 * Milan's own judgement always wins. Returns the parts to show; the viral total is recomputed by the caller.
 */
export function aiForViral(v: ViralResult, c: ContentCheck): Partial<Record<PartKey, number>> {
  const out: Partial<Record<PartKey, number>> = {};
  for (const k of AI_PARTS) {
    const part = v.parts.find((p) => p.key === k);
    if (!part || part.source === "Milan") continue;
    if (part.score === null && c.parts[k].score !== null) out[k] = c.parts[k].score!;
  }
  return out;
}

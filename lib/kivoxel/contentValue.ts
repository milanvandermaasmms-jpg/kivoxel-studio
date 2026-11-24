// 24-11-2026 (Milan, definitieve acceptatie: "ik wil geen Shorts meer ter keuring krijgen waarin niets interessants
// gebeurt"): the Content Value Gate. Before a Short is made, the moment must show real, measured content; after the
// export, the AI content check must confirm what only one source claimed. Pure, tested.
//
// Calibrated on Milan's own verdicts (24-11-2026, 213 Shorts): of the 12 Shorts waiting for his review, 11 had nothing
// measured but a loud sound, only a Gemini claim, or mostly dead picture; his three rejections "geen content" / "geen goede
// game play" were Gemini claims that no measurement confirmed. A Gemini claim alone is not rejected outright (Milan approved
// 63 of those), but it must be confirmed by the AI check of the export before it reaches him.

import type { EventTimeline, GameEvent } from "./events.ts";
import { deadShare } from "./producerGate.ts";

export type ContentLevel = "bevestigd" | "onbevestigd" | "afgewezen";
export type ContentEvidence = { source: "beeld" | "geluid" | "kinderen" | "ai"; atMs: number; text: string; strong: boolean };
export type ContentValue = { level: ContentLevel; evidence: ContentEvidence[]; reasons: string[]; summary: string };

/** The window around the peak in which evidence counts: the build-up and the moment itself. */
export const CV_BEFORE_MS = 6000;
export const CV_AFTER_MS = 3000;
/** More dead picture (menu, black, standing still) than this in the 10 s around the peak: nothing to watch. */
export const CV_MAX_DEAD = 0.35;
/** A Gemini moment counts as a claim from this score on (weaker ones are no evidence at all). */
export const CV_AI_MIN = 70;

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

function evidenceOf(e: GameEvent): ContentEvidence[] {
  const out: ContentEvidence[] = [];
  for (const s of e.sources) {
    if (s === "beeld:doodscherm") out.push({ source: "beeld", atMs: e.t_peak, text: "doodscherm in beeld", strong: true });
    else if (s.startsWith("beeld:") && e.kind === "damage") out.push({ source: "beeld", atMs: e.t_peak, text: e.description, strong: e.payoff >= 60 });
    else if (s.startsWith("beeld:")) out.push({ source: "beeld", atMs: e.t_peak, text: e.description, strong: false });
    else if (s.startsWith("geluid:")) out.push({ source: "geluid", atMs: e.t_peak, text: e.description.split(" + ")[0].startsWith("Hard geluid") ? e.description.split(" + ")[0] : "hard geluid", strong: false });
    else if (s.startsWith("spraak:")) out.push({ source: "kinderen", atMs: e.t_peak, text: "reactie van de kinderen", strong: false });
    else if (s.startsWith("ai:") && e.kind === "ai_moment" && e.payoff >= CV_AI_MIN) out.push({ source: "ai", atMs: e.t_peak, text: e.description.slice(0, 120), strong: false });
  }
  return out;
}

/** The gate before the montage: what does the recording really show around this moment? */
export function contentValue(t: EventTimeline, peakMs: number): ContentValue {
  const win = t.events.filter((e) => e.t_peak >= peakMs - CV_BEFORE_MS && e.t_peak <= peakMs + CV_AFTER_MS);
  const ev = win.flatMap(evidenceOf);
  // One piece of evidence per source kind is enough to show; keep the strongest.
  const seen = new Map<string, ContentEvidence>();
  for (const x of ev) if (!seen.has(x.source) || (x.strong && !seen.get(x.source)!.strong)) seen.set(x.source, x);
  const evidence = [...seen.values()].sort((a, b) => a.atMs - b.atMs);
  const measured = evidence.filter((x) => x.source !== "ai");
  const ai = evidence.some((x) => x.source === "ai");
  const strong = measured.some((x) => x.strong);
  const dead = deadShare(t.dead, peakMs - 8000, peakMs + 2000);
  const reasons: string[] = [];
  let level: ContentLevel;
  if (dead > CV_MAX_DEAD) {
    level = "afgewezen";
    reasons.push(`Rond ${clock(peakMs)} is ${Math.round(dead * 100)}% menu, zwart of stilstaand beeld: er is niets te zien.`);
  } else if (!evidence.length) {
    level = "afgewezen";
    reasons.push(`Rond ${clock(peakMs)} is geen enkele gebeurtenis gemeten (geen schade, dood, reactie, hard geluid of AI-moment).`);
  } else if (strong) {
    level = "bevestigd";
    reasons.push(`Gemeten in beeld: ${measured.find((x) => x.strong)!.text} (${clock(measured.find((x) => x.strong)!.atMs)}).`);
  } else if (ai && measured.length) {
    level = "bevestigd";
    reasons.push(`Gemini zag het moment, en ${measured.map((x) => x.source).join(" en ")} bevestigt het.`);
  } else if (new Set(measured.map((x) => x.source)).size >= 2) {
    level = "bevestigd";
    reasons.push(`Twee onafhankelijke metingen: ${measured.map((x) => x.source).join(" en ")}.`);
  } else {
    level = "onbevestigd";
    reasons.push(ai ? "Alleen Gemini noemt dit moment; geen meting bevestigt het." : `Alleen ${measured[0].source === "geluid" ? "een hard geluid" : measured[0].text}, verder niets gemeten.`);
    reasons.push("De AI-inhoudscheck moet in de export bevestigen dat er iets gebeurt, anders gaat hij niet naar Te keuren.");
  }
  const summary = `${level === "bevestigd" ? "Inhoud bevestigd" : level === "onbevestigd" ? "Inhoud nog niet bevestigd" : "Geen interessante gebeurtenis"}: ${reasons[0]}`;
  return { level, evidence, reasons, summary };
}

/** AI check of the export (0-10 per part); null when it did not run. */
export type AiContent = { fragment: number | null; verhaal: number | null; hook: number | null; summary: string } | null;

/**
 * After the export: does this Short go to Milan's review? Milan's own request (a re-montage with his feedback) always
 * does. An unconfirmed moment needs the AI check to see a real fragment and story (both 7 or more). A confirmed one is
 * held back only when the AI check clearly sees nothing (fragment or story 5 or less).
 */
export function reviewDecision(cv: ContentValue | null, ai: AiContent, milanAsked: boolean): { toReview: boolean; reason: string } {
  if (milanAsked) return { toReview: true, reason: "Op jouw verzoek gemaakt: altijd naar Te keuren." };
  if (!cv) return { toReview: true, reason: "Geen inhoudsmeting bij deze versie." };
  if (cv.level === "afgewezen") return { toReview: false, reason: cv.summary };
  const f = ai?.fragment ?? null;
  const v = ai?.verhaal ?? null;
  if (cv.level === "onbevestigd") {
    if (f === null || v === null) return { toReview: true, reason: "Inhoud niet bevestigd en de AI-inhoudscheck liep niet: ter keuring met waarschuwing." };
    if (f >= 7 && v >= 7) return { toReview: true, reason: `AI-inhoudscheck bevestigt het moment (fragment ${f}, verhaal ${v}).` };
    return { toReview: false, reason: `Inhoud niet bevestigd: ${cv.reasons[0]} AI-inhoudscheck: fragment ${f}, verhaal ${v}. ${ai?.summary ?? ""}`.trim() };
  }
  if (f !== null && v !== null && (f <= 5 || v <= 5)) return { toReview: false, reason: `AI-inhoudscheck ziet te weinig in de export (fragment ${f}, verhaal ${v}). ${ai?.summary ?? ""}`.trim() };
  return { toReview: true, reason: cv.summary };
}

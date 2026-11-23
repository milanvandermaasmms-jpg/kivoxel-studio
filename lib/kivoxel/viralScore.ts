// 23-11-2026 (Milan, superprompt V6, fase 30): the internal Viral Quality Score, 0-10 per part, weighted, minimum 8.0.
// Every part says where its number comes from: "gemeten" (the pc measured it in the export or the timeline),
// "inschatting" (a rule over measured facts, e.g. the music's mood against the event), or "Milan" (his own judgement in
// the review). A part nobody can measure stays open ("oordeel nodig") and is NEVER filled in with a guess: without it
// the production is not "publicatiegereed". Hard blocks (technical fault, briefing not followed, voice out of sync with
// the picture, music without a confirmed licence) block whatever the total is. The score is never raised to pass.
// A score is an internal quality estimate, not a promise of views. Pure, tested.

import { ATTENTION_MS, OUTCOME_MS, quietestStretch, type EditorReport, type ExportMeasure } from "./editorReview.ts";
import type { GateResult } from "./producerGate.ts";

export type PartKey = "hook" | "fragment" | "verhaal" | "montage" | "muziek_sfx" | "stem_audio" | "originaliteit" | "payoff";
export const PARTS: { key: PartKey; label: string; weight: number }[] = [
  { key: "hook", label: "Hook / eerste seconden", weight: 0.15 },
  { key: "fragment", label: "Fragmentselectie", weight: 0.15 },
  { key: "verhaal", label: "Verhaal en spanningsopbouw", weight: 0.15 },
  { key: "montage", label: "Montage en pacing", weight: 0.15 },
  { key: "muziek_sfx", label: "Muziek en geluidseffecten", weight: 0.15 },
  { key: "stem_audio", label: "Voice-over of gameplay-audio", weight: 0.1 },
  { key: "originaliteit", label: "Originaliteit en entertainment", weight: 0.1 },
  { key: "payoff", label: "Einde / payoff", weight: 0.05 },
];
export const MINIMUM = 8.0;

export type Source = "gemeten" | "inschatting" | "Milan";
export type Part = { key: PartKey; label: string; weight: number; score: number | null; source: Source | null; evidence: string[] };
export type ViralResult = {
  parts: Part[];
  /** Weighted over the scored parts only; null when nothing is scored. */
  total: number | null;
  /** Share of the weight that is scored (1 = everything judged). */
  coverage: number;
  blocks: string[];
  status: "publicatiegereed" | "onder 8,0" | "oordeel nodig" | "geblokkeerd";
  /** The weakest parts, with what would help (for the targeted repair). */
  weakest: { key: PartKey; label: string; score: number; fix: string }[];
  summary: string;
};

export type ViralInput = {
  short: boolean;
  measure: ExportMeasure;
  /** Where the high point lands in the export (ms). */
  peakOutMs: number | null;
  /** Share of the used source frames that are gameplay (null = not measurable). */
  gameplayShare: number | null;
  editor: EditorReport | null;
  gate: GateResult | null;
  /** Payoff of the main event (0-100), from the timeline. */
  payoff: number | null;
  firstLineWeak: boolean;
  hasVoice: boolean;
  voiceSyncRed: boolean;
  /** Music in the mix: its moods and whether its licence is on record; null = no music (by choice or mode). */
  music: { moods: string[]; licensed: boolean; /** Suitability of the track for this montage (musicFit, 0-10). */ fit?: number | null } | null;
  /** Moods that suit the main event (MOOD_FOR), best first; empty when unknown. */
  fittingMoods: string[];
  sfxCount: number;
  musicChosenOff: boolean;
  briefingOk: boolean | null;
  /** Milan's own judgement per part (0-10), from the review. */
  milan?: Partial<Record<PartKey, number>>;
};

const r1 = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const len = (s: { startMs: number; endMs: number }) => s.endMs - s.startMs;
const verdict = (g: GateResult | null, key: string) => g?.checks.find((c) => c.key === key) ?? null;

function hook(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const ev: string[] = [];
  let s = 10;
  const open = i.measure.motion.slice(0, 3);
  if (open.length === 3 && open.every((x) => x < 1.2)) (s -= 3), ev.push("0:00–0:03 nauwelijks beweging");
  const first = verdict(i.gate, "eerste_indruk");
  if (first?.verdict === "GEZAKT") (s -= 4), ev.push(first.reason);
  if (i.short && i.peakOutMs !== null && i.peakOutMs > ATTENTION_MS * 1.5) (s -= 3), ev.push(`Hoogtepunt pas op ${clock(i.peakOutMs)} (kijker is na ~8 s weg)`);
  if (i.firstLineWeak) (s -= 2), ev.push("Generieke openingszin");
  if (!ev.length) ev.push(i.peakOutMs !== null ? `Beweging vanaf 0:00, hoogtepunt op ${clock(i.peakOutMs)}` : "Beweging vanaf 0:00");
  return { score: r1(s), source: "gemeten", evidence: ev };
}

function fragment(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  if (i.gameplayShare === null && i.payoff === null) return { score: null, source: null, evidence: ["Gameplay-aandeel en sterkte van het moment niet meetbaar (andere game, geen timeline)"] };
  const ev: string[] = [];
  let s = 10;
  if (i.gameplayShare !== null) {
    ev.push(`${Math.round(i.gameplayShare * 100)}% van de gebruikte beelden is gameplay`);
    if (i.gameplayShare < 0.9) s -= (0.9 - i.gameplayShare) * 20;
  }
  if (i.payoff !== null) {
    ev.push(`Sterkte van het moment: ${i.payoff}/100 (Event Timeline)`);
    if (i.payoff < 70) s -= (70 - i.payoff) / 8;
  }
  return { score: r1(s), source: "gemeten", evidence: ev };
}

function verhaal(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const lead = verdict(i.gate, "voortgang");
  const promise = verdict(i.gate, "belofte");
  if (!lead || lead.verdict === "ONBEWEZEN") return { score: null, source: null, evidence: [lead?.reason ?? "Geen producer-beoordeling bij deze versie", "Of de opbouw boeit, kan de pc niet meten"] };
  let s = lead.verdict === "GESLAAGD" ? 8.5 : 4;
  if (promise?.verdict !== "GESLAAGD") s -= 1.5;
  return { score: r1(s), source: "inschatting", evidence: [lead.reason, ...(promise ? [promise.reason] : [])] };
}

function montage(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const ev: string[] = [];
  let s = 10;
  const m = i.measure;
  const quiet = quietestStretch(m.motion);
  if (quiet && len(quiet) >= (i.short ? 3000 : 12_000)) (s -= 2.5), ev.push(`${Math.round(len(quiet) / 1000)} s nauwelijks beweging vanaf ${clock(quiet.startMs)}`);
  const frozen = m.frozen.filter((x) => len(x) >= 1000);
  if (frozen.length) (s -= 3), ev.push(`Bevroren beeld op ${frozen.map((x) => clock(x.startMs)).join(", ")}`);
  if (m.black.some((b) => len(b) >= 300)) (s -= 3), ev.push("Zwart beeld");
  if (i.short && m.durationMs > 35_000) (s -= 1), ev.push(`Short van ${Math.round(m.durationMs / 1000)} s`);
  if (!ev.length) ev.push("Geen dode stukken, geen bevroren of zwart beeld");
  return { score: r1(s), source: "gemeten", evidence: ev };
}

function muziekSfx(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const ev: string[] = [];
  let s = 10;
  if (!i.music) {
    if (!i.musicChosenOff) return { score: null, source: null, evidence: ["Geen muziek in deze versie en geen bewuste keuze daarvoor"] };
    ev.push("Bewust zonder muziek");
  } else if (typeof i.music.fit === "number") {
    s = i.music.fit;
    ev.push(`Muziekgeschiktheid ${i.music.fit.toFixed(1).replace(".", ",")} voor dit moment (sfeer, energie, tempo, balans met de stem, licentie)`);
  } else {
    const best = i.fittingMoods.length ? Math.min(...i.music.moods.map((m) => (i.fittingMoods.includes(m) ? i.fittingMoods.indexOf(m) : 9))) : null;
    if (best === null) ev.push(`Muziek: ${i.music.moods.join(", ")} (soort moment onbekend)`), (s -= 1);
    else if (best === 9) (s -= 4), ev.push(`Sfeer ${i.music.moods.join(", ")} past niet bij dit moment (verwacht ${i.fittingMoods.join(", ")})`);
    else (s -= best), ev.push(`Sfeer ${i.music.moods.join(", ")} past bij dit moment (${best === 0 ? "beste keus" : `${best + 1}e keus`})`);
  }
  const perHalfMinute = i.sfxCount / Math.max(1, i.measure.durationMs / 30_000);
  if (i.sfxCount === 0) (s -= 1.5), ev.push("Geen geluidseffecten");
  else if (perHalfMinute > 8) (s -= 2), ev.push(`${i.sfxCount} geluidseffecten: te veel`);
  else ev.push(`${i.sfxCount} geluidseffect(en) op de hoogtepunten`);
  return { score: r1(s), source: "inschatting", evidence: ev };
}

function stemAudio(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const ev: string[] = [];
  let s = 10;
  const m = i.measure;
  if (m.clippedSamples > 50 || (m.peakDb !== null && m.peakDb > -0.1)) (s -= 4), ev.push(`Vervorming (piek ${m.peakDb?.toFixed(1) ?? "?"} dBFS)`);
  if (m.peakDb !== null && m.peakDb < -12) (s -= 2), ev.push(`Te zacht (piek ${m.peakDb.toFixed(1)} dBFS)`);
  const holes = m.silence.filter((x) => len(x) >= 1500 && x.startMs > 300 && x.endMs < m.durationMs - 300);
  if (holes.length) (s -= Math.min(3, holes.length * 1.5)), ev.push(`Onverwachte stilte op ${holes.map((x) => clock(x.startMs)).join(", ")}`);
  if (i.hasVoice) {
    if (i.voiceSyncRed) (s -= 4), ev.push("Stem loopt niet gelijk met het beeld");
    // How natural the voice sounds is a listening judgement: measured at most 8 until Milan judged it.
    s = Math.min(s, 8);
    ev.push("Of de stem natuurlijk klinkt, is een luisteroordeel (hooguit 8 zonder jouw oordeel)");
  } else ev.push("Gameplay-geluid zonder stem");
  if (!ev.length) ev.push("Geen vervorming, geen gaten");
  return { score: r1(s), source: "gemeten", evidence: ev };
}

function payoff(i: ViralInput): Omit<Part, "key" | "label" | "weight"> {
  const end = verdict(i.gate, "einde");
  if (i.peakOutMs === null && !end) return { score: null, source: null, evidence: ["Hoogtepunt in de export onbekend"] };
  const ev: string[] = [];
  let s = 10;
  if (i.peakOutMs !== null) {
    const after = i.measure.durationMs - i.peakOutMs;
    if (after < OUTCOME_MS) (s -= 5), ev.push(`Uitkomst maar ${(after / 1000).toFixed(1)} s in beeld`);
    else ev.push(`Uitkomst ${(after / 1000).toFixed(1)} s in beeld na het hoogtepunt`);
  }
  if (end?.verdict === "GEZAKT") (s -= 4), ev.push(end.reason);
  return { score: r1(s), source: "gemeten", evidence: ev };
}

const FIX: Record<PartKey, string> = {
  hook: "Openen met het hoogtepunt (cold open) of een ander openingsbeeld",
  fragment: "Een ander, sterker moment kiezen (minder menu, hogere sterkte)",
  verhaal: "Meer aanloop meenemen of een moment met een duidelijke opbouw kiezen",
  montage: "Dode of bevroren stukken eruit knippen, korter maken",
  muziek_sfx: "Een track met een passende sfeer, en effecten alleen op de hoogtepunten",
  stem_audio: "De mix rechtzetten (niveau, stiltes) of de stem opnieuw laten inspreken",
  originaliteit: "Een moment of invalshoek die we nog niet eerder lieten zien",
  payoff: "De uitkomst langer laten doorlopen",
};

export function viralScore(i: ViralInput): ViralResult {
  const measured: Record<PartKey, Omit<Part, "key" | "label" | "weight">> = {
    hook: hook(i),
    fragment: fragment(i),
    verhaal: verhaal(i),
    montage: montage(i),
    muziek_sfx: muziekSfx(i),
    stem_audio: stemAudio(i),
    originaliteit: { score: null, source: null, evidence: ["Wat dit moment eigen en vermakelijk maakt, kan de pc niet meten"] },
    payoff: payoff(i),
  };
  const parts: Part[] = PARTS.map((p) => {
    const own = i.milan?.[p.key];
    if (typeof own === "number") return { ...p, score: r1(own), source: "Milan", evidence: [`Jouw oordeel: ${r1(own)}`, ...measured[p.key].evidence] };
    return { ...p, ...measured[p.key] };
  });
  const blocks: string[] = [];
  for (const f of i.editor?.findings ?? []) if (f.severity === "blokkeert" && f.kind !== "briefing") blocks.push(`Eindredacteur: ${f.text}`);
  if (i.briefingOk === false) blocks.push("Briefing niet gevolgd");
  if (i.voiceSyncRed && i.hasVoice) blocks.push("Stem en beeld lopen niet gelijk (script past niet bij het beeld)");
  if (i.music && !i.music.licensed) blocks.push("Muziek zonder vastgelegde licentie");
  return finish(parts, blocks);
}

/** Milan's judgement in the review, applied to a stored result (the measured parts and the blocks stay as they are). */
export function applyJudgement(r: ViralResult, milan: Partial<Record<PartKey, number>>): ViralResult {
  const parts = r.parts.map((p) => {
    const own = milan[p.key];
    if (typeof own !== "number") return p;
    const measured = p.source === "Milan" ? p.evidence.slice(1) : p.evidence;
    return { ...p, score: r1(own), source: "Milan" as const, evidence: [`Jouw oordeel: ${r1(own)}`, ...measured] };
  });
  return finish(parts, r.blocks);
}

function finish(parts: Part[], blocks: string[]): ViralResult {
  const scored = parts.filter((p) => p.score !== null);
  const w = scored.reduce((a, p) => a + p.weight, 0);
  const total = w ? Math.round((scored.reduce((a, p) => a + p.score! * p.weight, 0) / w) * 10) / 10 : null;
  const coverage = Math.round(w * 100) / 100;
  const weakest = scored.filter((p) => p.score! < MINIMUM).sort((a, b) => a.score! - b.score!).map((p) => ({ key: p.key, label: p.label, score: p.score!, fix: FIX[p.key] }));
  const open = parts.filter((p) => p.score === null);
  const status: ViralResult["status"] = blocks.length ? "geblokkeerd" : total !== null && total < MINIMUM ? "onder 8,0" : open.length ? "oordeel nodig" : total !== null && total >= MINIMUM ? "publicatiegereed" : "oordeel nodig";
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const summary =
    status === "geblokkeerd"
      ? `Geblokkeerd: ${blocks[0]}`
      : status === "onder 8,0"
        ? `${fmt(total!)} — onder 8,0. Zwakst: ${weakest.slice(0, 2).map((p) => `${p.label} ${fmt(p.score)}`).join(", ")}`
        : status === "oordeel nodig"
          ? `${total !== null ? `${fmt(total)} op het gemeten deel (${Math.round(coverage * 100)}%)` : "Nog niets gemeten"}; jouw oordeel nodig voor: ${open.map((p) => p.label).join(", ")}`
          : `${fmt(total!)} — publicatiegereed (alles beoordeeld, geen blokkade)`;
  return { parts, total, coverage, blocks, status, weakest, summary };
}

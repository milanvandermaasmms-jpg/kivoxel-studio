// 23-11-2026 (Milan, superprompt V5, fase 4-6): one central content register. Every production (Short or long video)
// once, with its current version, and five scores built ONLY from things the pc measures in the export file itself or
// that are stored with the production: no AI, no costs, no invented judgements. A score that cannot be measured is
// null ("niet beoordeeld") with the reason, never a guess. Then one action: behouden, verbeteren (a targeted fix of a
// measured problem) or opnieuw maken (the moment or the footage itself is the problem). Live videos are never touched:
// for them the register only informs. Pure, tested.

import { ATTENTION_MS, OUTCOME_MS, quietestStretch, type ExportMeasure } from "./editorReview.ts";
import { weakFirstLine } from "../youtube/hooks.ts";

export type Facts = {
  videoId: string;
  channel: string;
  title: string;
  format: "A" | "B" | "C";
  /** yt_videos.status (idea, scripted, rendering, review, approved, scheduled, published, failed, archived). */
  status: string;
  /** Publication status on YouTube, when there is one. */
  publication: string | null;
  createdAt: string;
  /** Is the original recording still on the pc? null = no recording linked. */
  source: boolean | null;
  /** Newest render of this production: its file is on the pc (true), gone (false), or there is no render (null). */
  renderFile: boolean | null;
  renderName: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** One FFmpeg pass over the export (null when not measured). */
  measure: ExportMeasure | null;
  /** Share of the used source frames that are gameplay (Minecraft HUD), null = not measurable. */
  gameplayShare: number | null;
  hasVoice: boolean;
  topLine: string | null;
  lines: { atMs: number; text: string }[];
  /** Where the high point lands in the export, if known. */
  peakOutMs: number | null;
  /** Red QC checks stored with the render (vo_sync separately). */
  qcRed: number;
  voSyncRed: boolean;
  /** Milan's own note when he rejected it. */
  reviewNote: string | null;
  /** YouTube: average % watched (latest snapshot), for live videos. */
  avgViewPct: number | null;
  views: number | null;
};

export type ScoreKey = "script" | "montage" | "audio" | "beeld" | "techniek";
export const SCORE_LABEL: Record<ScoreKey, string> = { script: "Script", montage: "Montage", audio: "Audio", beeld: "Beeld", techniek: "Techniek" };
export type Score = { value: number | null; reasons: string[] };
export type Action = "behouden" | "verbeteren" | "opnieuw maken" | "niet beoordeeld" | "live (alleen info)" | "afgekeurd (archief)";
export type Entry = {
  videoId: string;
  channel: string;
  title: string;
  type: "Short" | "Lang";
  status: string;
  source: "beschikbaar" | "ontbreekt" | "geen opname";
  scores: Record<ScoreKey, Score>;
  total: number | null;
  action: Action;
  why: string;
  /** Open = needs Milan or a re-montage; afgerond = nothing to do. */
  control: "open" | "afgerond";
  renderName: string | null;
  createdAt: string;
  avgViewPct: number | null;
  views: number | null;
};

/** Weights of the total (techniek and audio first: a broken file is never ok). Validate later with channel results. */
export const WEIGHTS: Record<ScoreKey, number> = { techniek: 0.2, audio: 0.2, beeld: 0.25, montage: 0.2, script: 0.15 };
/** Provisional quality norm (superprompt: 85 is the viral target; below 60 the production is remade). */
export const NORM = { keep: 75, remake: 55 };

const len = (s: { startMs: number; endMs: number }) => s.endMs - s.startMs;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const LIVE = new Set(["published", "scheduled"]);
const TEXT_WRONG = /tekst klopt niet|klopt niet|gekke tekst|niet waar|hartjes|hearts?|health/i;
const NO_ACTION = /geen (goede )?content|gebeurt niks|gebeurt niets|saai|verkeerde clip|alleen lucht|menu|inventaris/i;

function techniek(f: Facts): Score {
  const r: string[] = [];
  let s = 100;
  const short = f.format !== "C";
  if (f.width && f.height) {
    const portrait = f.height > f.width;
    if (short !== portrait) (s -= 30), r.push(`Verkeerde beeldverhouding (${f.width}x${f.height})`);
    if (Math.min(f.width, f.height) < 720) (s -= 20), r.push(`Lage resolutie (${f.width}x${f.height})`);
  }
  const m = f.measure!;
  const black = m.black.filter((b) => len(b) >= 300);
  const frozen = m.frozen.filter((x) => len(x) >= 1000);
  if (black.length) (s -= 35), r.push(`Zwart beeld (${black.map((b) => clock(b.startMs)).join(", ")})`);
  if (frozen.length) (s -= 35), r.push(`Bevroren beeld (${frozen.map((x) => clock(x.startMs)).join(", ")})`);
  const red = f.qcRed - (f.voSyncRed ? 1 : 0);
  if (red > 0) (s -= Math.min(30, red * 10)), r.push(`${red} rode kwaliteitscontrole(s)`);
  return { value: clamp(s), reasons: r.length ? r : ["Bestand leesbaar, juiste verhouding, geen zwart of bevroren beeld"] };
}

function audio(f: Facts): Score {
  const r: string[] = [];
  let s = 100;
  const m = f.measure!;
  if (m.clippedSamples > 50 || (m.peakDb !== null && m.peakDb > -0.1)) (s -= 35), r.push(`Vervorming (piek ${m.peakDb?.toFixed(1) ?? "?"} dBFS)`);
  if (m.peakDb !== null && m.peakDb < -12) (s -= 20), r.push(`Te zacht (piek ${m.peakDb.toFixed(1)} dBFS)`);
  const silences = m.silence.filter((x) => len(x) >= 1500 && x.startMs > 300 && x.endMs < m.durationMs - 300);
  if (silences.length) (s -= Math.min(30, silences.length * 15)), r.push(`Onverwachte stilte (${silences.map((x) => clock(x.startMs)).join(", ")})`);
  if (f.voSyncRed) (s -= 20), r.push("Stem loopt niet gelijk met het beeld (controle rood)");
  return { value: clamp(s), reasons: r.length ? r : ["Geen vervorming, geen gaten, volume in orde"] };
}

function beeld(f: Facts): Score {
  const r: string[] = [];
  if (f.gameplayShare === null) return { value: null, reasons: ["Niet meetbaar: geen Minecraft-HUD in deze opname (andere game of geen meting)"] };
  let s = Math.round(f.gameplayShare * 100);
  r.push(`${Math.round(f.gameplayShare * 100)}% van de gebruikte beelden is gameplay (geen menu of inventaris)`);
  if (f.gameplayShare < 0.6) (s = Math.min(s, 35)), r.push("Te veel menu, inventaris of laadscherm");
  return { value: clamp(s), reasons: r };
}

function montage(f: Facts): Score {
  const r: string[] = [];
  let s = 100;
  const m = f.measure!;
  const short = f.format !== "C";
  if (f.peakOutMs !== null) {
    const after = m.durationMs - f.peakOutMs;
    if (after < OUTCOME_MS) (s -= 30), r.push(`Uitkomst maar ${(after / 1000).toFixed(1)} s in beeld na het hoogtepunt`);
    if (short && f.peakOutMs > ATTENTION_MS * 1.5) (s -= 15), r.push(`Hoogtepunt pas op ${clock(f.peakOutMs)} (kijker is na ~8 s weg)`);
  }
  const quiet = quietestStretch(m.motion);
  if (quiet && len(quiet) >= (short ? 3000 : 12_000)) (s -= 20), r.push(`${Math.round(len(quiet) / 1000)} s nauwelijks beweging (${clock(quiet.startMs)})`);
  const opening = m.motion.slice(0, 3);
  if (opening.length === 3 && opening.every((x) => x < 1.2)) (s -= 15), r.push("Stilstaand beeld in de eerste 3 s");
  if (short && m.durationMs > 35_000) (s -= 10), r.push(`Short van ${Math.round(m.durationMs / 1000)} s (eigen data: lange Shorts worden minder uitgekeken)`);
  return { value: clamp(s), reasons: r.length ? r : ["Uitkomst in beeld, geen dode stukken, opening beweegt"] };
}

function script(f: Facts): Score {
  const texts = [f.topLine ?? "", ...f.lines.map((l) => l.text)].filter((t) => t.trim());
  if (!texts.length) return { value: null, reasons: ["Geen tekst of stem in deze versie"] };
  const r: string[] = [];
  let s = 100;
  if (f.topLine && weakFirstLine(f.topLine)) (s -= 25), r.push(`Zwakke openingszin: "${f.topLine}"`);
  const weak = f.lines.filter((l) => weakFirstLine(l.text));
  if (weak.length) (s -= Math.min(30, weak.length * 10)), r.push(`Generieke zinnen: "${weak[0].text}"`);
  const long = f.lines.filter((l) => l.text.split(/\s+/).length > 16);
  if (long.length) (s -= Math.min(20, long.length * 5)), r.push(`${long.length} te lange zin(nen) voor gesproken tekst`);
  if (f.reviewNote && TEXT_WRONG.test(f.reviewNote)) (s -= 40), r.push(`Milan: "${f.reviewNote.slice(0, 80)}"`);
  return { value: clamp(s), reasons: r.length ? r : ["Specifieke openingszin, geen generieke kreten, zinnen spreekbaar"] };
}

/** One production in the register. */
export function assess(f: Facts): Entry {
  const base = { videoId: f.videoId, channel: f.channel, title: f.title, type: (f.format === "C" ? "Lang" : "Short") as Entry["type"], status: f.status, source: (f.source === null ? "geen opname" : f.source ? "beschikbaar" : "ontbreekt") as Entry["source"], renderName: f.renderName, createdAt: f.createdAt, avgViewPct: f.avgViewPct, views: f.views };
  const none = (why: string): Record<ScoreKey, Score> => ({ script: { value: null, reasons: [why] }, montage: { value: null, reasons: [why] }, audio: { value: null, reasons: [why] }, beeld: { value: null, reasons: [why] }, techniek: { value: null, reasons: [why] } });
  const live = LIVE.has(f.status) || f.publication === "published" || f.publication === "scheduled";
  if (!f.measure) {
    const why = f.renderFile === null ? "Nog geen montage" : f.renderFile === false ? "Exportbestand staat niet meer op de pc" : "Export niet te meten";
    const scores = none(why);
    if (f.renderFile !== null) scores.script = script(f);
    return { ...base, scores, total: null, action: live ? "live (alleen info)" : "niet beoordeeld", why: live ? `${why}. Live op YouTube${f.avgViewPct !== null ? `: ${Math.round(f.avgViewPct)}% bekeken bij ${f.views ?? 0} weergaven` : ""}; wordt niet aangeraakt.` : why, control: live || f.renderFile === null ? "afgerond" : "open" };
  }
  const scores: Record<ScoreKey, Score> = { techniek: techniek(f), audio: audio(f), beeld: beeld(f), montage: montage(f), script: script(f) };
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(WEIGHTS) as ScoreKey[]) {
    const v = scores[k].value;
    if (v === null) continue;
    sum += v * WEIGHTS[k];
    w += WEIGHTS[k];
  }
  const total = w ? Math.round(sum / w) : null;
  if (live) return { ...base, scores, total, action: "live (alleen info)", why: `Live op YouTube; wordt niet aangeraakt.${f.avgViewPct !== null ? ` ${Math.round(f.avgViewPct)}% bekeken bij ${f.views ?? 0} weergaven.` : ""}`, control: "afgerond" };
  // Remake: the footage itself is the problem (menus, Milan said nothing happens), or the total is far below the norm.
  const contentNote = f.reviewNote && NO_ACTION.test(f.reviewNote);
  const lowBeeld = scores.beeld.value !== null && scores.beeld.value < 60;
  const weakest = (Object.keys(scores) as ScoreKey[]).filter((k) => scores[k].value !== null).sort((a, b) => scores[a].value! - scores[b].value!)[0];
  const blocker = (Object.keys(scores) as ScoreKey[]).find((k) => scores[k].value !== null && scores[k].value! < 60);
  let action: Action;
  let why: string;
  if (lowBeeld || contentNote || (total !== null && total < NORM.remake)) {
    action = "opnieuw maken";
    why = lowBeeld ? `Ander moment nodig: ${scores.beeld.reasons.join("; ")}` : contentNote ? `Milan: "${f.reviewNote!.slice(0, 80)}" — ander moment nodig` : `Totaal ${total} (onder ${NORM.remake}); zwakst: ${SCORE_LABEL[weakest]} (${scores[weakest].reasons[0]})`;
  } else if (blocker || (total !== null && total < NORM.keep)) {
    const k = blocker ?? weakest;
    action = "verbeteren";
    why = `${SCORE_LABEL[k]} ${scores[k].value}: ${scores[k].reasons[0]}`;
  } else {
    action = "behouden";
    why = `Totaal ${total}; geen meetbaar probleem`;
  }
  // 23-11-2026, first real run: archived productions without a measurable problem are not "behouden": Milan rejected or
  // replaced them for reasons the measurements cannot see (the moment itself). They only come back on his choice.
  if (f.status === "archived" && action === "behouden") {
    action = "afgekeurd (archief)";
    why = `Metingen in orde (totaal ${total}), maar staat onder Afgekeurd${f.reviewNote ? `: "${f.reviewNote.slice(0, 80)}"` : ""}. Alleen opnieuw maken als jij dat kiest.`;
  }
  return { ...base, scores, total, action, why, control: action === "behouden" || action === "afgekeurd (archief)" ? "afgerond" : "open" };
}

export type Register = { builtAt: string; measuredAt: string | null; entries: Entry[]; counts: Record<Action, number>; running?: { done: number; total: number } | null };

export function summarize(entries: Entry[], builtAt: string): Register {
  const counts = { behouden: 0, verbeteren: 0, "opnieuw maken": 0, "niet beoordeeld": 0, "live (alleen info)": 0, "afgekeurd (archief)": 0 } as Record<Action, number>;
  for (const e of entries) counts[e.action] += 1;
  return { builtAt, measuredAt: builtAt, entries, counts };
}

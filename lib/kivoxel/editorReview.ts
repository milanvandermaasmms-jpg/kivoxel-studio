// 23-11-2026 (Milan): the eindredacteur. After every full export (also after a re-montage) a separate step judges the
// file Milan will get. First blind: only what is measured in the export itself (picture and the final sound track):
// black or frozen picture, the stretch where nothing changes (attention drops), silence, digital clipping, captions that
// do not fit. Then it compares with what the montage intended: is the peak there before the viewer leaves (~8 s for our
// Shorts, docs/viral-check-2026-11-23.md), and does the outcome stay in view long enough? One status per version.
// What it cannot judge (how natural the voice sounds) is never a green tick: "Menselijke luistercheck nodig" with the time.
// Pure, tested; the measuring is in worker/editorMeasure.ts.

export type Span = { startMs: number; endMs: number };
export type ExportMeasure = {
  durationMs: number;
  black: Span[];
  frozen: Span[];
  silence: Span[];
  /** Peak level of the final mix (dBFS) and how many samples hit full scale. */
  peakDb: number | null;
  clippedSamples: number;
  /** Picture change per second (mean luma difference between frames), for "where attention drops". */
  motion: number[];
  /** Caption cues of this export (from its .srt). */
  captions: Span[];
};
export type Intent = {
  short: boolean;
  peakOutMs: number | null;
  voiceLines: { atMs: number; text: string }[];
  hasVoice: boolean;
  /** Share of the source frames used in this export that show gameplay (Minecraft HUD in view, no menu panel); null = not measurable (other game). */
  gameplayShare?: number | null;
  /** How many moments the analysis measured inside the footage used (the chosen one included). */
  measuredEvents?: number | null;
};
export type Finding = { atMs: number; kind: "beeld" | "geluid" | "captions" | "uitkomst" | "opening" | "aandacht" | "stem" | "briefing"; severity: "blokkeert" | "verbeteren" | "controle"; text: string; fix?: string };
export type EditorStatus = "Klaar voor Milan" | "Correctie nodig" | "Handmatige controle nodig";
export type EditorReport = { status: EditorStatus; blind: string[]; findings: Finding[]; main: string; checkedAt: string };

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const len = (s: Span) => s.endMs - s.startMs;
/** The viewer of our Shorts leaves after about 8 s (median, own data 13–16 Nov). */
export const ATTENTION_MS = 8000;
/** The outcome must stay in view at least this long after the peak. */
export const OUTCOME_MS = 2500;

/** The longest stretch where the picture hardly changes (motion below `low`), as a span. */
export function quietestStretch(motion: number[], low = 1.2): Span | null {
  let best: Span | null = null;
  let start = -1;
  for (let i = 0; i <= motion.length; i++) {
    const quiet = i < motion.length && motion[i] < low;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if (!best || i - start > (best.endMs - best.startMs) / 1000) best = { startMs: start * 1000, endMs: i * 1000 };
      start = -1;
    }
  }
  return best;
}

export function reviewExport(m: ExportMeasure, intent: Intent, now = new Date()): EditorReport {
  const findings: Finding[] = [];
  const blind: string[] = [];
  // 1. Blind: what the export itself shows and sounds like.
  const busiest = m.motion.length ? m.motion.indexOf(Math.max(...m.motion)) : -1;
  if (busiest >= 0) blind.push(`De meeste beweging zit rond ${clock(busiest * 1000)}.`);
  const quiet = quietestStretch(m.motion);
  if (quiet && len(quiet) >= 3000) {
    blind.push(`Van ${clock(quiet.startMs)} tot ${clock(quiet.endMs)} verandert het beeld nauwelijks.`);
    findings.push({ atMs: quiet.startMs, kind: "aandacht", severity: "verbeteren", text: `${(len(quiet) / 1000).toFixed(0)} s waarin het beeld nauwelijks verandert (${clock(quiet.startMs)}–${clock(quiet.endMs)}): hier zakt de aandacht in.`, fix: "Inkorten of versnellen; of een moment met meer actie kiezen." });
  }
  for (const b of m.black.filter((x) => len(x) >= 300)) findings.push({ atMs: b.startMs, kind: "beeld", severity: "blokkeert", text: `Zwart beeld van ${clock(b.startMs)} tot ${clock(b.endMs)}.`, fix: "Dat stuk eruit knippen." });
  for (const f of m.frozen.filter((x) => len(x) >= 1000)) findings.push({ atMs: f.startMs, kind: "beeld", severity: "blokkeert", text: `Bevroren beeld van ${clock(f.startMs)} tot ${clock(f.endMs)} (${(len(f) / 1000).toFixed(1)} s).`, fix: "Bevroren stuk eruit, of een ander fragment." });
  if (m.clippedSamples > 50 || (m.peakDb !== null && m.peakDb > -0.1)) findings.push({ atMs: 0, kind: "geluid", severity: "blokkeert", text: `Het geluid vervormt digitaal (piek ${m.peakDb?.toFixed(1) ?? "?"} dBFS, ${m.clippedSamples} samples op volle schaal).`, fix: "De mix zachter zetten en opnieuw normaliseren." });
  for (const s of m.silence.filter((x) => len(x) >= 1500 && x.startMs > 300 && x.endMs < m.durationMs - 300)) findings.push({ atMs: s.startMs, kind: "geluid", severity: "verbeteren", text: `Onverwachte stilte van ${clock(s.startMs)} tot ${clock(s.endMs)}.`, fix: "Gamegeluid of muziek doorlaten, of bewust houden als het een spanningsstilte is." });
  // 2. Compared with the intent of the montage.
  if (intent.peakOutMs !== null) {
    const after = m.durationMs - intent.peakOutMs;
    const frozenAfter = m.frozen.concat(m.black).some((x) => x.startMs < intent.peakOutMs! + OUTCOME_MS && x.endMs > intent.peakOutMs!);
    if (after < OUTCOME_MS || frozenAfter) findings.push({ atMs: intent.peakOutMs, kind: "uitkomst", severity: "blokkeert", text: after < OUTCOME_MS ? `Na het hoogtepunt (${clock(intent.peakOutMs)}) staat de uitkomst maar ${(after / 1000).toFixed(1)} s in beeld.` : `Rond de uitkomst (${clock(intent.peakOutMs)}) staat het beeld stil of is het zwart.`, fix: "De uitkomst langer laten doorlopen (payoff)." });
    if (intent.short && intent.peakOutMs > ATTENTION_MS) findings.push({ atMs: intent.peakOutMs, kind: "opening", severity: "verbeteren", text: `Het hoogtepunt komt pas op ${clock(intent.peakOutMs)}; de helft van onze kijkers is na ~8 s weg.`, fix: "Korter aanlopen of een teaser van het hoogtepunt in de eerste seconde." });
  }
  // Content, measured on the source frames this export uses (the eindredacteur cannot see what happens, only whether it is gameplay).
  if (typeof intent.gameplayShare === "number" && intent.gameplayShare < 0.6) findings.push({ atMs: 0, kind: "beeld", severity: "blokkeert", text: `Maar ${Math.round(intent.gameplayShare * 100)}% van deze export is gameplay; de rest is menu of inventaris.`, fix: "Volledige hermontage met een ander moment uit de opname." });
  if (intent.measuredEvents !== undefined && intent.measuredEvents !== null && intent.measuredEvents <= 1) findings.push({ atMs: intent.peakOutMs ?? 0, kind: "aandacht", severity: "controle", text: `De analyse meet in deze export alleen het gekozen moment. Of er zichtbaar iets gebeurt, kan zij niet zien: kijk vanaf ${clock(intent.peakOutMs ?? 0)}.` });
  if (intent.hasVoice) {
    if (!m.captions.length) findings.push({ atMs: intent.voiceLines[0]?.atMs ?? 0, kind: "captions", severity: "blokkeert", text: "Er is een voice-over, maar de export heeft geen ondertitels.", fix: "Ondertitels opnieuw uit de werkelijk gesproken woorden maken." });
    const late = m.captions.filter((c) => c.endMs > m.durationMs + 200);
    if (late.length) findings.push({ atMs: late[0].startMs, kind: "captions", severity: "blokkeert", text: `Een ondertitel loopt door na het einde van de video (${clock(late[0].startMs)}).`, fix: "Ondertiteltijden na de laatste knip opnieuw berekenen." });
    const first = intent.voiceLines[0];
    findings.push({ atMs: first?.atMs ?? 0, kind: "stem", severity: "controle", text: `Menselijke luistercheck nodig: klinkt de stem natuurlijk en past hij bij het beeld? Luister vanaf ${clock(first?.atMs ?? 0)}${first ? ` ("${first.text.slice(0, 60)}")` : ""}.` });
  }
  const blocks = findings.filter((f) => f.severity === "blokkeert");
  const status: EditorStatus = blocks.length ? "Correctie nodig" : findings.some((f) => f.severity === "controle") ? "Handmatige controle nodig" : "Klaar voor Milan";
  const top = blocks[0] ?? findings.find((f) => f.severity === "verbeteren") ?? findings[0];
  const main = top ? `${clock(top.atMs)}: ${top.text}${top.fix ? ` Verbetering: ${top.fix}` : ""}` : "Geen problemen gemeten in beeld en geluid.";
  return { status, blind, findings: findings.sort((a, b) => a.atMs - b.atMs), main, checkedAt: now.toISOString() };
}

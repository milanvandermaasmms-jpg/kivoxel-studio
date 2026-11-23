// 23-11-2026 (Milan, executive producer): one document per production that producer, editor and Milan can work from:
// status and reason, the promise and the deciding end image, three openings, a shot table with running timecodes,
// the voice-over as readable text with speaking time and planned silences, the seconds with the highest swipe risk,
// an editor brief, a viewing test, one variant that changes one factor, and a measuring plan.
// Built only from what the studio really has (script, montage plan, producer gate, eindredacteur, render). Nothing is
// predicted: no views, no retention, no chance to go viral. Pure, tested.
import type { Segment } from "../youtube/analysis";
import type { EditorReport } from "./editorReview";
import type { GateResult } from "./producerGate";

export type DossierInput = {
  format: "short" | "long";
  title: string;
  titles?: string[];
  topLine: string | null;
  hook: string;
  hooks?: { type: string; first_line: string; overlay: string; cold_open: boolean }[];
  chosenHook?: number | null;
  lines: { at_ms: number; text: string }[];
  plan: Segment[];
  targetMs: number;
  loopLine?: string | null;
  gate?: GateResult | null;
  editor?: EditorReport | null;
  voice: boolean;
  audioLabel?: string | null;
  music?: string | null;
  thumbnails?: { label?: string; text?: string }[];
};
export type Shot = { id: string; startMs: number; endMs: number; image: string; vo: string; text: string; sound: string; cut: string; essential: boolean };
export type Dossier = {
  status: string;
  reason: string;
  promise: string;
  endImage: string;
  openings: { label: string; firstImage: string; firstLine: string; why: string; chosen: boolean }[];
  packaging: { title: string; thumbnail: string; chosen: boolean }[];
  shots: Shot[];
  voText: { atMs: number; text: string; seconds: number }[];
  silences: { startMs: number; endMs: number }[];
  speakingSeconds: number;
  risks: { atMs: number; risk: string; solution: string }[];
  editor: string[];
  viewingTest: string[];
  variant: { hypothesis: string; a: string; b: string; compare: string };
  measure: string[];
};

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
/** Spoken English at a natural pace: about 2.6 words per second. */
export const speakSeconds = (text: string) => Math.round((text.trim().split(/\s+/).filter(Boolean).length / 2.6) * 10) / 10;
const outEnd = (s: Segment) => s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / (s.speed || 1));
const PART: Record<string, string> = { teaser: "Flits van het hoogtepunt", cold_open: "Cold open: flits van het hoogtepunt", build: "Aanloop", payoff: "Hoogtepunt en uitkomst", search: "Zoeken", discovery: "Vondst", aftermath: "Afloop", goals: "Doel", chapter: "Hoofdstuk", hook: "Opening" };

export function buildDossier(i: DossierInput): Dossier {
  const shots: Shot[] = i.plan.map((s, k) => {
    const a = s.out_start_ms;
    const b = outEnd(s);
    const vo = i.lines.filter((l) => l.at_ms >= a && l.at_ms < b).map((l) => `"${l.text}"`).join(" ");
    const fx = [s.speed !== 1 ? (s.speed < 1 ? `slow-motion ${s.speed}×` : `versneld ${s.speed}×`) : "", ...(s.effects ?? []).filter((e) => e !== "slowmo").map((e) => (e === "zoom" ? "zoom" : e === "zoom_strong" ? "sterke zoom" : e))].filter(Boolean).join(", ");
    return {
      id: `S${k + 1}`,
      startMs: a,
      endMs: b,
      image: `${PART[s.part] ?? s.part}: ${s.note || "–"} (bron ${clock(s.src_start_ms)}–${clock(s.src_end_ms)})`,
      vo: vo || "—",
      text: k === 0 && i.topLine ? i.topLine : s.text ?? "—",
      sound: i.voice ? "gamegeluid onder de stem" : i.audioLabel === "Alleen gamegeluid" ? "alleen gamegeluid" : `gamegeluid + ${i.music ?? "muziek"}`,
      cut: k === 0 ? `begin${fx ? `, ${fx}` : ""}` : `harde knip${fx ? `, ${fx}` : ""}`,
      essential: s.part === "payoff" || s.part === "teaser" || s.part === "cold_open",
    };
  });
  const payoff = i.plan.filter((s) => s.part === "payoff");
  const peakSeg = payoff.find((s) => s.effects?.includes("slowmo")) ?? payoff[0];
  const peakOut = peakSeg ? (peakSeg.effects?.includes("slowmo") ? outEnd(peakSeg) : peakSeg.out_start_ms) : null;
  const last = payoff[payoff.length - 1] ?? i.plan[i.plan.length - 1];
  const endImage = last ? `${clock(last.out_start_ms)}–${clock(outEnd(last))}: ${last.note || "de uitkomst"}` : "Geen uitkomst in het montageplan.";
  const promise = i.gate?.checks.find((c) => c.key === "belofte")?.reason ?? (peakSeg?.note || i.title);

  const voText = i.lines.map((l) => ({ atMs: l.at_ms, text: l.text, seconds: speakSeconds(l.text) }));
  const silences: { startMs: number; endMs: number }[] = [];
  let cursor = 0;
  for (const l of [...voText].sort((a, b) => a.atMs - b.atMs)) {
    if (l.atMs - cursor >= 1000) silences.push({ startMs: cursor, endMs: l.atMs });
    cursor = Math.max(cursor, l.atMs + l.seconds * 1000);
  }
  if (i.voice && i.targetMs - cursor >= 1000) silences.push({ startMs: cursor, endMs: i.targetMs });

  const hooks = i.hooks ?? [];
  const chosen = typeof i.chosenHook === "number" ? i.chosenHook : -1;
  const openings = (hooks.length ? hooks : [{ type: "", first_line: i.hook, overlay: i.topLine ?? "", cold_open: false }]).slice(0, 3).map((h, k) => ({
    label: `Opening ${k + 1}`,
    firstImage: h.cold_open || shots[0]?.image.startsWith("Flits") ? `Flits van het hoogtepunt (${shots[0]?.image ?? ""})` : shots[0]?.image ?? "",
    firstLine: h.first_line || "(geen gesproken zin)",
    why: h.overlay ? `Tekst in beeld: ${h.overlay}` : "",
    chosen: k === chosen || (chosen < 0 && k === 0),
  }));
  const packaging = i.format === "long" ? (i.titles?.length ? i.titles : [i.title]).slice(0, 3).map((t, k) => ({ title: t, thumbnail: i.thumbnails?.[k] ? `${i.thumbnails[k].label ?? `Thumbnail ${k + 1}`}${i.thumbnails[k].text ? `, tekst "${i.thumbnails[k].text}"` : ""}` : "Nog geen thumbnail gemaakt", chosen: k === 0 })) : [];

  const risks: { atMs: number; risk: string; solution: string }[] = [{ atMs: 0, risk: "Eerste seconde: begrijpt de kijker zonder geluid wat er op het spel staat?", solution: shots[0]?.image.startsWith("Flits") ? "Opent al met het hoogtepunt; check of het beeld zonder geluid leesbaar is." : "Open met het hoogtepunt (teaser) in plaats van de aanloop." }];
  if (i.format === "short" && peakOut !== null && peakOut > 8000) risks.push({ atMs: peakOut, risk: `Hoogtepunt pas op ${clock(peakOut)}; de mediane kijker is na ~8 s weg (eigen data).`, solution: "Aanloop inkorten tot het hoogtepunt vóór 8 s valt." });
  for (const f of i.editor?.findings ?? []) if (f.kind === "aandacht" || f.kind === "uitkomst" || f.kind === "opening") risks.push({ atMs: f.atMs, risk: f.text, solution: f.fix ?? "Zie eindredacteur." });

  const failing = (i.gate?.checks ?? []).filter((c) => c.verdict !== "GESLAAGD").map((c) => `${c.label}: ${c.verdict.toLowerCase()} — ${c.reason}`);
  const editor = [
    `Essentieel: ${shots.filter((s) => s.essential).map((s) => `${s.id} (${clock(s.startMs)}–${clock(s.endMs)})`).join(", ") || "—"}. Deze shots dragen de belofte; niet inkorten.`,
    `Mag weg als het te lang is: ${shots.filter((s) => !s.essential).map((s) => s.id).join(", ") || "—"}.`,
    i.voice ? "Stem: laat de belangrijkste gamecue (voetstappen, de klap, de onthulling) hoorbaar; de verteller zwijgt tijdens het hoogtepunt." : "Geen stem: het gamegeluid en de muziek dragen het moment; muziek zakt onder de belangrijke cues.",
    `Export: ${i.format === "short" ? "1080×1920 (9:16), controleren op een telefoon, mét en zonder geluid" : "1920×1080 (16:9)"}.`,
    ...(failing.length ? [`Producer-aandachtspunten: ${failing.join(" · ")}`] : []),
  ];
  const viewingTest = i.format === "short"
    ? ["Laat iemand uit de doelgroep alleen de eerste 2 seconden zien (zonder uitleg). Vraag: wat denk je dat er gaat gebeuren?", `Laat daarna de hele Short zien. Vraag: waar viel je aandacht weg, en welk beeld loste de belofte in? Verwacht antwoord: ${endImage}.`, "Wijzig de opening als de verwachting na 2 s niet overeenkomt met de uitkomst; wijzig de knip als de aandacht wegvalt vóór het hoogtepunt."]
    : ["Laat alleen titel, thumbnail en de eerste 30 seconden zien. Vraag: wat verwacht je in deze video?", "Laat daarna de hele video zien. Vraag: waar verloor je de draad, en welk moment was het antwoord op de titel?", "Wijzig titel of thumbnail als de verwachting niet past bij de eerste scène."];
  const alt = hooks.find((_, k) => k !== (chosen < 0 ? 0 : chosen));
  const variant = alt
    ? { hypothesis: "Een andere eerste zin bij hetzelfde beeld verandert hoeveel kijkers na de eerste seconden blijven.", a: `Opening A: "${openings.find((o) => o.chosen)?.firstLine ?? i.hook}"`, b: `Opening B: "${alt.first_line}" (alles verder gelijk)`, compare: "Publiceer A en B niet tegelijk; vergelijk elk 48 uur na publicatie met de mediaan van vergelijkbare eigen Shorts. Geen gecontroleerde test: tijdstip en onderwerp kunnen het verschil ook verklaren." }
    : { hypothesis: i.voice ? "Met of zonder voice-over bij hetzelfde fragment verandert de kijkduur." : "Met of zonder teaser van het hoogtepunt verandert hoeveel kijkers na de eerste seconden blijven.", a: i.voice ? "Versie A: met stem" : "Versie A: met teaser", b: i.voice ? "Versie B: zelfde montage zonder stem (gamegeluid + muziek)" : "Versie B: zelfde montage zonder teaser", compare: "Vergelijk elk 48 uur na publicatie met de mediaan van vergelijkbare eigen Shorts; geen gecontroleerde test." };
  const measure = i.format === "short"
    ? ["Na 48 uur en na 7 dagen: bekeken versus weggeveegd, engaged views, gemiddelde kijkduur, gemiddeld % bekeken, retentie rond 0–3 s en rond het hoogtepunt.", "Referentie: mediaan van eigen Shorts 13–16 nov (7,9 s gemiddelde kijkduur, 24% bekeken, n=15). Met minder dan 5 vergelijkbare Shorts is het verschil een aanwijzing, geen bewijs.", "Als kijkers vóór het hoogtepunt wegvegen: de aanloop inkorten. Als ze tot het einde blijven maar niet opnieuw kijken: het einde dichter bij het begin laten aansluiten."]
    : ["Na 48 uur en 7 dagen: impressies en CTR per verkeersbron, retentie in de eerste 30 s, gemiddelde kijkduur, retentie rond sleutelscènes.", "Als de CTR laag is maar de opening houdt: verpakking wijzigen. Als de opening daalt: de eerste scène dichter bij de titel brengen."];

  return { status: i.gate?.status ?? "Niet beoordeeld", reason: i.gate?.summary ?? "Geen producer-oordeel bij deze productie (gemaakt vóór 23-11-2026 of lange video).", promise, endImage, openings, packaging, shots, voText, silences, speakingSeconds: Math.round(voText.reduce((s, l) => s + l.seconds, 0) * 10) / 10, risks, editor, viewingTest, variant, measure };
}

/** The dossier as plain text, to copy into a document for the team. */
export function dossierText(d: Dossier, title: string): string {
  const L: string[] = [`PRODUCERDOSSIER — ${title}`, `Status: ${d.status}. ${d.reason}`, `Kijkbelofte: ${d.promise}`, `Beslissend eindbeeld: ${d.endImage}`, "", "OPENINGEN"];
  for (const o of d.openings) L.push(`${o.chosen ? "✓ " : "  "}${o.label}: ${o.firstLine} — eerste beeld: ${o.firstImage}${o.why ? ` — ${o.why}` : ""}`);
  if (d.packaging.length) {
    L.push("", "TITEL EN THUMBNAIL");
    for (const p of d.packaging) L.push(`${p.chosen ? "✓ " : "  "}${p.title} — ${p.thumbnail}`);
  }
  L.push("", "SHOTS (start–eind | shot | beeld | VO | tekst | geluid | knip)");
  for (const s of d.shots) L.push(`${clock(s.startMs)}–${clock(s.endMs)} | ${s.id}${s.essential ? " *" : ""} | ${s.image} | ${s.vo} | ${s.text} | ${s.sound} | ${s.cut}`);
  L.push("", `VOICE-OVER (${d.speakingSeconds} s gesproken)`);
  for (const v of d.voText) L.push(`${clock(v.atMs)} (${v.seconds} s) ${v.text}`);
  for (const s of d.silences) L.push(`stilte ${clock(s.startMs)}–${clock(s.endMs)}`);
  L.push("", "RISICO OP WEGVEGEN");
  for (const r of d.risks) L.push(`${clock(r.atMs)}: ${r.risk} → ${r.solution}`);
  L.push("", "EDITOR", ...d.editor, "", "KIJKPROEF", ...d.viewingTest, "", "VARIANT", d.variant.hypothesis, d.variant.a, d.variant.b, d.variant.compare, "", "MEETPLAN", ...d.measure);
  return L.join("\n");
}

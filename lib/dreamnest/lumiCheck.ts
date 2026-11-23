// 23-11-2026 (Milan, superprompt V5 fase 17 en V6 fase 30): the check of Dreamnest/LUMI productions, with its own matrix
// (rest, atmosphere, sleep suitability), minimum 8.0. Measured in the export by the pc (no AI, no costs):
// - levendigheid: is there gentle movement (rain, fire, breathing), or is the picture fully still for long stretches?
// - rust: no restless picture (sudden jumps in movement, jitter between frames);
// - overgangen: no abrupt cuts (a sudden change in brightness from one second to the next);
// - geluid: no clipping, no unexpected gaps in the music loop, no sudden loud peaks;
// - techniek: no black or frozen picture.
// What the pc cannot judge (is Lumi recognisable, is it fairy-tale warm) stays open for Milan. Pure, tested.

import type { ExportMeasure } from "../kivoxel/editorReview.ts";

export type LumiPart = { key: "levendigheid" | "rust" | "overgangen" | "geluid" | "techniek" | "karakter_sfeer"; label: string; weight: number; score: number | null; evidence: string[] };
export type LumiResult = { parts: LumiPart[]; total: number | null; status: "voldoet (8,0+)" | "onder 8,0" | "oordeel nodig"; summary: string };

const r1 = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
const clock = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`; };
const len = (s: { startMs: number; endMs: number }) => s.endMs - s.startMs;

export function lumiCheck(m: ExportMeasure, opts: { short: boolean; milan?: number | null }): LumiResult {
  // The first and last second are the intended fade in and fade out (measured on the four Shorts, 23-11-2026: the
  // brightness change of a fade reads as "movement"); they are left out of the picture checks.
  const sec = m.motion.length > 4 ? m.motion.slice(1, -1) : m.motion;
  // Levendigheid: share of seconds with gentle movement (above "fully still"), and the longest fully still stretch.
  const alive = sec.length ? sec.filter((x) => x >= 0.15).length / sec.length : 0;
  let still = 0;
  let run = 0;
  for (const x of sec) (run = x < 0.15 ? run + 1 : 0), (still = Math.max(still, run));
  const lev: string[] = [`${Math.round(alive * 100)}% van de seconden met zachte beweging`];
  let ls = 10 - Math.max(0, 0.9 - alive) * 12;
  if (still >= (opts.short ? 5 : 60)) (ls -= 3), lev.push(`${still} s achter elkaar volledig stil beeld`);
  // Rust: big jumps in movement from one second to the next (restless, flickering, jittery picture).
  const jumps = sec.slice(1).filter((x, i) => Math.abs(x - sec[i]) > 6).length;
  const busy = sec.filter((x) => x > 8).length;
  const rust: string[] = [];
  let rs = 10;
  if (jumps) (rs -= Math.min(5, jumps * (opts.short ? 1 : 0.2))), rust.push(`${jumps} plotselinge sprong(en) in beweging`);
  if (busy) (rs -= Math.min(4, (busy / Math.max(1, sec.length)) * 40)), rust.push(`${busy} s met veel beweging (onrustig voor slapen)`);
  if (!rust.length) rust.push("Rustig beeld, geen sprongen");
  // Overgangen: a measured "sudden jump" larger than a soft cross-fade.
  const offset = sec === m.motion ? 0 : 1000;
  const hard = sec.slice(1).map((x, i) => ({ at: (i + 1) * 1000 + offset, d: x - sec[i] })).filter((x) => x.d > 10);
  const ov: string[] = hard.length ? [`Harde overgang op ${hard.slice(0, 4).map((x) => clock(x.at)).join(", ")}`] : ["Zachte overgangen"];
  const os = 10 - Math.min(6, hard.length * 1.5);
  // Geluid.
  const geluid: string[] = [];
  let gs = 10;
  if (m.clippedSamples > 50 || (m.peakDb !== null && m.peakDb > -1)) (gs -= 4), geluid.push(`Pieken tot ${m.peakDb?.toFixed(1) ?? "?"} dBFS (te hard voor slapen)`);
  const gaps = m.silence.filter((x) => len(x) >= 1500 && x.startMs > 300 && x.endMs < m.durationMs - 300);
  if (gaps.length) (gs -= Math.min(5, gaps.length * 2)), geluid.push(`Gat in de muziek op ${gaps.slice(0, 4).map((x) => clock(x.startMs)).join(", ")}`);
  if (!geluid.length) geluid.push("Geen pieken, geen gaten in de muziek");
  // Techniek.
  const tech: string[] = [];
  let ts = 10;
  const black = m.black.filter((b) => len(b) >= 500);
  if (black.length) (ts -= 4), tech.push(`Zwart beeld op ${black.slice(0, 3).map((b) => clock(b.startMs)).join(", ")}`);
  if (!tech.length) tech.push("Geen zwart beeld");
  const parts: LumiPart[] = [
    { key: "levendigheid", label: "Levendigheid (regen, vuur, ademen)", weight: 0.2, score: r1(ls), evidence: lev },
    { key: "rust", label: "Rust (niet onrustig of trillend)", weight: 0.2, score: r1(rs), evidence: rust },
    { key: "overgangen", label: "Zachte overgangen", weight: 0.15, score: r1(os), evidence: ov },
    { key: "geluid", label: "Geluid en muziekloop", weight: 0.2, score: r1(gs), evidence: geluid },
    { key: "techniek", label: "Techniek", weight: 0.1, score: r1(ts), evidence: tech },
    { key: "karakter_sfeer", label: "Lumi herkenbaar, warm en sprookjesachtig", weight: 0.15, score: typeof opts.milan === "number" ? r1(opts.milan) : null, evidence: typeof opts.milan === "number" ? ["Jouw oordeel"] : ["Kan de pc niet beoordelen: jouw oordeel nodig"] },
  ];
  const scored = parts.filter((p) => p.score !== null);
  const w = scored.reduce((a, p) => a + p.weight, 0);
  const total = w ? Math.round((scored.reduce((a, p) => a + p.score! * p.weight, 0) / w) * 10) / 10 : null;
  const status: LumiResult["status"] = total !== null && total < 8 ? "onder 8,0" : parts.some((p) => p.score === null) ? "oordeel nodig" : "voldoet (8,0+)";
  const weakest = scored.filter((p) => p.score! < 8).sort((a, b) => a.score! - b.score!);
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const summary = status === "onder 8,0" ? `${fmt(total!)} — onder 8,0. Zwakst: ${weakest.slice(0, 2).map((p) => `${p.label} ${fmt(p.score!)} (${p.evidence[0]})`).join("; ")}` : status === "oordeel nodig" ? `${total !== null ? fmt(total) : "—"} op het gemeten deel; jouw oordeel nodig voor: Lumi en sfeer` : `${fmt(total!)} — voldoet`;
  return { parts, total, status, summary };
}

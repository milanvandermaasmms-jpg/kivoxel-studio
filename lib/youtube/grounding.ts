// Studio 2.0, mijlpaal 3: the gameplay is the source of truth. Before the narration is written, frames from the REAL
// recording (full quality, from the montage plan) go to Gemini, which only reports what is visible: light, health bar,
// mobs, actions, events. The script must lean on that evidence; a second pass removes or rewrites every line without
// support. Plus a speaking-time target, so long videos are not 80% silent. Pure functions, tested.
import type { Format, ScriptLine, Segment } from "./analysis.ts";

export type FramePick = { index: number; srcMs: number; outMs: number; segment: number };
export type Light = "day" | "night" | "cave_dark" | "cave_lit" | "underwater" | "nether" | "unknown";
export type Health = "full" | "most" | "half" | "low" | "not_visible";
export type FrameFact = { i: number; light: Light; health: Health; mobs: string[]; action: string; events: string[] };
export type Evidence = { frames: FrameFact[]; summary: string; uncertain: string[] };

const LIGHTS: Light[] = ["day", "night", "cave_dark", "cave_lit", "underwater", "nether", "unknown"];
const HEALTHS: Health[] = ["full", "most", "half", "low", "not_visible"];
export const WPS = 2.6;

/** Frames spread over every segment of the final video (source time), at most `max` in total, at least one per segment. */
export function framePlan(segments: Segment[], max = 40): FramePick[] {
  const per = segments.map((s) => {
    const len = s.src_end_ms - s.src_start_ms;
    const n = Math.max(1, Math.min(6, Math.floor(len / 2500)));
    return Array.from({ length: n }, (_, k) => {
      const src = Math.round(s.src_start_ms + ((k + 0.5) * len) / n);
      return { srcMs: src, outMs: Math.round(s.out_start_ms + (src - s.src_start_ms) / s.speed) };
    });
  });
  let total = per.reduce((n, p) => n + p.length, 0);
  // Too many: take from the segments with the most frames first, never below one per segment.
  while (total > max) {
    const biggest = per.reduce((bi, p, i) => (p.length > per[bi].length ? i : bi), 0);
    if (per[biggest].length <= 1) break;
    per[biggest].splice(Math.floor(per[biggest].length / 2), 1);
    total--;
  }
  const out: FramePick[] = [];
  per.forEach((p, segment) => p.forEach((f) => out.push({ index: out.length, segment, ...f })));
  return out;
}

const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

export function evidencePrompt(frames: FramePick[]): string {
  return [
    `You get ${frames.length} frames from a Minecraft (PS5, Bedrock) gameplay recording, in time order. Frame k is at ${frames.map((f) => `k=${f.index}: ${mmss(f.outMs)}`).join(", ")} of the final video.`,
    "Report ONLY what is clearly visible in each frame. Never guess what happens between frames. If the health bar (hearts) is not clearly readable, use not_visible.",
    `light: one of ${LIGHTS.join(", ")} (cave_dark = really dark, hard to see; cave_lit = underground but clearly visible).`,
    `health: one of ${HEALTHS.join(", ")} from the hearts in the HUD (full = 10 hearts, most = 7-9, half = 4-6, low = 1-3).`,
    "mobs: visible mobs (creeper, zombie, skeleton, spider, enderman, ...). action: what the player does (mining, walking, fighting, falling, building, swimming, in menu/inventory). events: only clear events (explosion, damage taken, death screen, item found, fall, block placed).",
    "Then summary: 2-3 sentences about what really happens over the whole clip, and uncertain: things you cannot tell from the frames.",
    'Answer with JSON only: {"frames":[{"i":0,"light":"...","health":"...","mobs":[],"action":"...","events":[]}],"summary":"...","uncertain":["..."]}',
  ].join("\n");
}

export function parseEvidence(raw: unknown, count: number): Evidence | { error: string } {
  const r = raw as { frames?: unknown; summary?: unknown; uncertain?: unknown };
  if (!Array.isArray(r?.frames)) return { error: "geen frames in het antwoord" };
  const frames: FrameFact[] = [];
  for (const f of r.frames as Record<string, unknown>[]) {
    const i = Number(f?.i);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 8) : []);
    frames.push({
      i,
      light: LIGHTS.includes(f.light as Light) ? (f.light as Light) : "unknown",
      health: HEALTHS.includes(f.health as Health) ? (f.health as Health) : "not_visible",
      mobs: list(f.mobs),
      action: String(f.action ?? "").slice(0, 80),
      events: list(f.events),
    });
  }
  if (frames.length < Math.min(3, count)) return { error: "te weinig frames beschreven" };
  return { frames: frames.sort((a, b) => a.i - b.i), summary: String(r.summary ?? "").slice(0, 600), uncertain: Array.isArray(r.uncertain) ? r.uncertain.map((x) => String(x).slice(0, 160)).slice(0, 6) : [] };
}

/** How many words the narration should have: Shorts are mostly spoken, long videos about half, with room for game sound. */
export function targetWords(format: Format, durationMs: number): number {
  const share = format === "C" ? 0.5 : 0.7;
  return Math.round((durationMs / 1000) * WPS * share);
}

export const coverage = (lines: ScriptLine[], durationMs: number) => (durationMs > 0 ? lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0) / WPS / (durationMs / 1000) : 0);

/** The longest stretch without narration (estimating each line at WPS). */
export function longestSilenceMs(lines: ScriptLine[], durationMs: number): number {
  const sorted = [...lines].sort((a, b) => a.at_ms - b.at_ms);
  let gap = sorted.length ? sorted[0].at_ms : durationMs;
  sorted.forEach((l, i) => {
    const end = l.at_ms + (l.text.split(/\s+/).filter(Boolean).length / WPS) * 1000;
    gap = Math.max(gap, (i + 1 < sorted.length ? sorted[i + 1].at_ms : durationMs) - end);
  });
  return Math.max(0, Math.round(gap));
}

/** Added to the existing script prompt: the evidence per moment of the final video and the hard rules that follow from it. */
export function groundingBlock(e: Evidence, frames: FramePick[], format: Format, durationMs: number): string {
  const at = new Map(frames.map((f) => [f.index, f.outMs]));
  const healthSeen = e.frames.some((f) => f.health !== "not_visible");
  const dark = e.frames.some((f) => f.light === "cave_dark" || f.light === "night");
  const words = targetWords(format, durationMs);
  const maxGap = format === "C" ? 12 : 5;
  return [
    "",
    "VERIFIED EVIDENCE from frames of the real recording (this overrides anything above when they disagree):",
    ...e.frames.map((f) => `- ${mmss(at.get(f.i) ?? 0)}: light ${f.light}; health ${f.health}; ${f.mobs.length ? `mobs ${f.mobs.join(", ")}; ` : ""}action ${f.action || "-"}${f.events.length ? `; events ${f.events.join(", ")}` : ""}`),
    `Overall: ${e.summary}`,
    ...(e.uncertain.length ? [`Not visible / uncertain: ${e.uncertain.join("; ")}`] : []),
    "HARD RULES:",
    "- Every factual statement (mobs, damage, health, darkness, falls, deaths, finds, numbers) must match the evidence at that time. Jokes and excitement are fine; invented events are not.",
    healthSeen ? "- Mention health only as the evidence shows it (full/most/half/low); never say 'one heart' or 'half a heart' unless health is low." : "- Health is never clearly visible: do NOT mention hearts or health at all (also not in top_line, hooks or titles).",
    dark ? "- Only call it dark where the evidence says cave_dark or night." : "- It is never really dark: do NOT call it dark.",
    "- No falls, deaths, explosions or kills unless they are in the events.",
    "- Write full, lively sentences of 6-14 words (a narrator telling the story to a friend), not 2-3 word shouts; vary the rhythm.",
    `- Length: about ${words} words in total (±10%), spread over the whole video, the line at_ms on the moment it talks about; no stretch longer than ${maxGap} s without narration unless it is a deliberate pause before a payoff.`,
  ].join("\n");
}

export function verifyPrompt(lines: ScriptLine[], e: Evidence, frames: FramePick[], extra: { topLine?: string; hook?: string } = {}): string {
  const at = new Map(frames.map((f) => [f.index, f.outMs]));
  return [
    "Check a Minecraft narration against the evidence from the real frames. A line is supported when every factual claim in it is visible in the evidence near its time (a few seconds before or after). Excitement, humour and opinions are fine.",
    "Evidence:",
    ...e.frames.map((f) => `- ${mmss(at.get(f.i) ?? 0)}: light ${f.light}; health ${f.health}; mobs ${f.mobs.join(", ") || "-"}; action ${f.action || "-"}; events ${f.events.join(", ") || "-"}`),
    `Summary: ${e.summary}`,
    "Lines:",
    ...lines.map((l, i) => `${i}. [${mmss(l.at_ms)}] ${l.text}`),
    ...(extra.topLine ? [`top_line: ${extra.topLine}`] : []),
    ...(extra.hook ? [`hook: ${extra.hook}`] : []),
    "For every unsupported line give a rewrite with the same energy and roughly the same length that IS supported (or an empty rewrite to drop it). Also fix top_line and hook when they claim something unsupported.",
    'Answer with JSON only: {"lines":[{"index":0,"supported":true,"issue":"","rewrite":""}],"top_line":"... or empty when fine","hook":"... or empty when fine"}',
  ].join("\n");
}

export type Verified = { lines: ScriptLine[]; rewritten: number; dropped: number; issues: string[]; topLine: string | null; hook: string | null };

/** Applies the check: unsupported lines are rewritten, or dropped when no supported rewrite exists. */
export function applyVerification(lines: ScriptLine[], raw: unknown): Verified {
  const r = raw as { lines?: unknown; top_line?: unknown; hook?: unknown };
  const verdicts = new Map<number, { supported: boolean; issue: string; rewrite: string }>();
  if (Array.isArray(r?.lines))
    for (const v of r.lines as Record<string, unknown>[]) {
      const i = Number(v?.index);
      if (Number.isInteger(i)) verdicts.set(i, { supported: v.supported !== false, issue: String(v.issue ?? "").slice(0, 200), rewrite: String(v.rewrite ?? "").replace(/[<>]/g, "").trim().slice(0, 300) });
    }
  let rewritten = 0;
  let dropped = 0;
  const issues: string[] = [];
  const out: ScriptLine[] = [];
  lines.forEach((l, i) => {
    const v = verdicts.get(i);
    if (!v || v.supported) return void out.push(l);
    if (v.issue) issues.push(`${mmss(l.at_ms)}: ${v.issue}`);
    if (v.rewrite) {
      rewritten++;
      out.push({ ...l, text: v.rewrite });
    } else dropped++;
  });
  const fix = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/[<>]/g, "").trim().slice(0, 300) : null);
  return { lines: out, rewritten, dropped, issues: issues.slice(0, 12), topLine: fix(r?.top_line), hook: fix(r?.hook) };
}

// ---------- Moment keuring (Studio 2.0) ----------

export type Strength = { score: number; verdict: "strong" | "ok" | "weak"; reasons: string[] };
const MENU = /\b(menu|inventory|inventaris|chest|crafting table|pause|settings|map screen|loading)\b/i;

/**
 * How strong is the material for a video, from the evidence alone: real threat or find, events, variety. Menus and
 * idle walking make it weak. A rubric, not a prediction of views.
 */
export function contentStrength(e: Evidence): Strength {
  const n = Math.max(1, e.frames.length);
  const menus = e.frames.filter((f) => MENU.test(f.action) || f.events.some((x) => MENU.test(x))).length;
  const withMobs = e.frames.filter((f) => f.mobs.length).length;
  const events = e.frames.reduce((s, f) => s + f.events.filter((x) => !MENU.test(x)).length, 0);
  const actions = new Set(e.frames.map((f) => f.action.toLowerCase().split(/\s+/)[0]).filter(Boolean)).size;
  const reasons: string[] = [];
  let score = 50;
  score += Math.min(25, Math.round((withMobs / n) * 40));
  score += Math.min(20, events * 5);
  score += Math.min(10, (actions - 1) * 3);
  score -= Math.round((menus / n) * 60);
  if (menus / n >= 0.25) reasons.push(`${menus} van ${n} beelden zijn menu's of inventaris`);
  if (!withMobs) reasons.push("geen vijanden of dieren in beeld");
  if (!events) reasons.push("geen duidelijke gebeurtenis (schade, ontploffing, vondst, val)");
  if (withMobs / n >= 0.4) reasons.push(`dreiging in ${withMobs} van ${n} beelden`);
  if (events >= 2) reasons.push(`${events} gebeurtenissen`);
  score = Math.max(0, Math.min(100, score));
  return { score, verdict: score >= 70 ? "strong" : score >= 50 ? "ok" : "weak", reasons };
}

// ---------- Filling silence with supported lines ----------

/** Gaps (in the final video) longer than `minMs` without narration. */
export function silentGaps(lines: ScriptLine[], durationMs: number, minMs: number): [number, number][] {
  const sorted = [...lines].sort((a, b) => a.at_ms - b.at_ms);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const l of sorted) {
    if (l.at_ms - cursor >= minMs) gaps.push([cursor, l.at_ms]);
    cursor = Math.max(cursor, Math.round(l.at_ms + (l.text.split(/\s+/).filter(Boolean).length / WPS) * 1000));
  }
  if (durationMs - cursor >= minMs) gaps.push([cursor, durationMs]);
  return gaps;
}

export function expandPrompt(lines: ScriptLine[], e: Evidence, frames: FramePick[], gaps: [number, number][], extraWords: number): string {
  const at = new Map(frames.map((f) => [f.index, f.outMs]));
  return [
    "Add narration lines to fill silent gaps in a Minecraft video, in the same energetic narrator voice (English). Only say what the evidence supports near that time; reactions, tension and humour are welcome.",
    "Evidence:",
    ...e.frames.map((f) => `- ${mmss(at.get(f.i) ?? 0)}: light ${f.light}; health ${f.health}; mobs ${f.mobs.join(", ") || "-"}; action ${f.action || "-"}; events ${f.events.join(", ") || "-"}`),
    "Current lines:",
    ...lines.map((l) => `[${mmss(l.at_ms)}] ${l.text}`),
    `Silent gaps to fill (start-end): ${gaps.map(([a, b]) => `${mmss(a)}-${mmss(b)}`).join(", ")}.`,
    `Add about ${extraWords} words in total, as short lines placed inside those gaps (at_ms inside a gap, at least 1.5 s after the previous line). Do not repeat what is already said.`,
    'Answer with JSON only: {"lines":[{"at_ms":0,"text":"..."}]}',
  ].join("\n");
}

/** Merges added lines that fall inside a gap; never on top of an existing line. */
export function mergeAdded(lines: ScriptLine[], raw: unknown, gaps: [number, number][], durationMs: number): ScriptLine[] {
  const added = Array.isArray((raw as { lines?: unknown })?.lines) ? ((raw as { lines: unknown[] }).lines as Record<string, unknown>[]) : [];
  const ok = added
    .map((l) => ({ at_ms: Math.round(Number(l.at_ms)), text: String(l.text ?? "").replace(/[<>]/g, "").trim().slice(0, 300) }))
    .filter((l) => Number.isFinite(l.at_ms) && l.at_ms >= 0 && l.at_ms < durationMs && l.text && gaps.some(([a, b]) => l.at_ms >= a && l.at_ms < b));
  return [...lines, ...ok].sort((a, b) => a.at_ms - b.at_ms);
}

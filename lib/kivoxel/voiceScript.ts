// KIVOXEL fase 1, sections 1b and 1c: a voice-over written against the Event Timeline, and the hard sync gate.
// - Every line belongs to an event (by its moment in the recording, so cold opens and cuts can move it safely).
// - Anticipation rule: a line about event X ENDS 0.3-1.5 s before X's peak. Around a big peak: 0.5 s silence,
//   then at most one short reaction.
// - The gate places lines with their REAL spoken length (after TTS). Too long -> a shorter version, never faster
//   than 1.08x. Still failing after the attempts -> the line is dropped and the video is flagged for review.
import templatesJson from "../../config/kivoxel/script_templates.json" with { type: "json" };
import type { Segment, ScriptLine } from "../youtube/analysis.ts";
import { persona, type EventType, type Language, type Settings } from "./config.ts";
import type { EventTimeline, GameEvent } from "./events.ts";
import { withLearned, type Learned } from "./learn.ts";

export type LineKind = "hook" | "anticipation" | "reaction" | "open_loop" | "bridge" | "loop";
export type TtsStyle = "spannend" | "fluisterend" | "schreeuw" | "lachend" | "normaal";
/** A script line (stored in yt_scripts.lines, jsonb) with the extra fields of fase 1. Old lines have only at_ms and text. */
export type VoLine = ScriptLine & {
  kind?: LineKind;
  /** The peak of the event this line is about, as a moment in the recording. */
  event_src_ms?: number;
  event_id?: string;
  style?: TtsStyle;
  /** Shorter versions, shortest last; the gate uses them instead of speeding up. */
  alts?: string[];
};

type Templates = {
  opener: Record<EventType, string[]>;
  anticipation: Record<EventType, string[]>;
  open_loop: string[];
  bridge: string[];
  /** Tension fillers for a long stretch before the next moment. */
  build: string[];
  /** Long video: right after the cold open (the best moment first), back to the start. */
  cold_open_bridge: string[];
  loop_end: string[];
  /** Section 7.3: short text on a freeze-frame right after a fail (ENGLISH, explosive, rotates). */
  freeze_text: string[];
};
export const templates = templatesJson as unknown as Templates;

const BIG_PEAK = 50;
const GAP_MS = 120;

/** The same moment in the montage; the first real occurrence (a cold open or teaser shows the peak twice). */
export function sourceToOut(segments: Segment[], srcMs: number): number | null {
  const hits = segments
    .filter((s) => srcMs >= s.src_start_ms && srcMs <= s.src_end_ms)
    .map((s) => ({ s, out: Math.round(s.out_start_ms + (srcMs - s.src_start_ms) / s.speed) }))
    .sort((a, b) => a.out - b.out);
  const real = hits.find((h) => h.s.part !== "cold_open" && h.s.part !== "teaser") ?? hits[0];
  return real ? real.out : null;
}

/** Events the montage really shows, with their peak in montage time. */
export function eventsInMontage(segments: Segment[], timeline: EventTimeline | null): (GameEvent & { peak_out: number })[] {
  return (timeline?.events ?? [])
    .map((e) => ({ ...e, peak_out: sourceToOut(segments, e.t_peak) }))
    .filter((e): e is GameEvent & { peak_out: number } => e.peak_out !== null)
    .sort((a, b) => a.peak_out - b.peak_out);
}

/** Spoken length before TTS: about 3 words per second for an energetic voice, plus the pauses of "…" and full stops. */
export function estimateMs(text: string): number {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const pauses = (text.match(/…|\.\.\./g) ?? []).length * 280 + (text.match(/[.!?](\s|$)/g) ?? []).length * 140;
  return Math.round(words * 330 + pauses + 150);
}

/** Small, seeded random: the same video gets the same script, different videos get different ones. */
export function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks a phrase that was not used recently (rotation, section 2 and 7.8); falls back to the least recent. */
export function pick(options: string[], recent: string[], rnd: () => number): string {
  const fresh = options.filter((o) => !recent.includes(o));
  const pool = fresh.length ? fresh : [...options].sort((a, b) => recent.indexOf(a) - recent.indexOf(b));
  return pool[Math.floor(rnd() * pool.length)] ?? options[0];
}

/** {hearts} -> the number of hearts of the event, in English ("3.5"). The event description itself is a Dutch note for Milan. */
export const fill = (text: string, e?: GameEvent) => {
  const m = e ? /([\d,]+) hartjes/.exec(e.description) : null;
  return text.replace("{hearts}", m ? m[1].replace(",", ".") : "a few");
};

/** Shorter alternatives from the same list (same event type), shortest last. */
function shorterAlts(main: string, options: string[], e?: GameEvent): string[] {
  return options
    .map((o) => fill(o, e))
    .filter((o) => o !== main && o.length < main.length)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

const styleFor = (kind: LineKind, type: EventType | null): TtsStyle => {
  if (kind === "reaction") return type === "geluk" || type === "bouw" || type === "grap" ? "lachend" : "schreeuw";
  if (kind === "anticipation") return type === "jumpscare" ? "fluisterend" : "spannend";
  return "normaal";
};

export type FreeScriptInput = {
  /** Lines from scripts Milan approved (section 8): they join the pools with double weight. */
  learned?: Learned;
  segments: Segment[];
  targetMs: number;
  timeline: EventTimeline | null;
  /** Always "en": KIVOXEL videos are English. */
  language?: Language;
  settings: Settings;
  seed: string;
  /** Phrases used in recent videos (rotation). */
  recent?: string[];
  /** Short (<= 60 s) or long video. */
  short: boolean;
};

/**
 * The free script engine (section 8): a voice-over from templates, written against the timeline.
 * Hook first, an open loop if there is room, per event an anticipation line before and a short reaction after
 * the peak, bridges between events in long videos, and a line that loops back to the start.
 */
export function freeScript(input: FreeScriptInput): { hook: string; lines: VoLine[]; mainType: EventType; used: string[] } {
  const { settings, short } = input;
  const rnd = seeded(input.seed);
  const recent = [...(input.recent ?? [])];
  const used: string[] = [];
  const take = (options: string[], e?: GameEvent) => {
    const t = fill(pick(options, recent, rnd), e);
    recent.push(t);
    used.push(t);
    return t;
  };
  const events = eventsInMontage(input.segments, input.timeline).filter((e) => e.peak_out < input.targetMs - 800);
  // Shorts: the strongest events, at least ~6 s apart. Long videos: every typed event, at least ~15 s apart.
  const spacing = short ? 6000 : 15_000;
  const chosen: typeof events = [];
  for (const e of [...events].filter((x) => x.type || x.payoff >= 70).sort((a, b) => b.payoff - a.payoff)) {
    if (chosen.some((c) => Math.abs(c.peak_out - e.peak_out) < spacing)) continue;
    chosen.push(e);
    if (short && chosen.length >= 3) break;
  }
  chosen.sort((a, b) => a.peak_out - b.peak_out);
  const main = [...chosen].sort((a, b) => b.payoff - a.payoff)[0];
  const mainType: EventType = main?.type ?? "fail";

  const lines: VoLine[] = [];
  const hook = take(templates.opener[mainType]);
  lines.push({ at_ms: 0, text: hook, kind: "hook", style: "schreeuw", alts: shorterAlts(hook, templates.opener[mainType]) });

  // Long video (section 7.9): the cold open shows the best moment first; then "but how did we get here?".
  const cold = !short ? input.segments.find((sg) => sg.part === "cold_open") : undefined;
  if (cold) {
    const coldEnd = cold.out_start_ms + Math.round((cold.src_end_ms - cold.src_start_ms) / cold.speed);
    const bridge = take(templates.cold_open_bridge);
    lines.push({ at_ms: coldEnd + 200, text: bridge, kind: "bridge", style: "spannend", alts: shorterAlts(bridge, templates.cold_open_bridge) });
  }
  const first = chosen[0];
  if (first && first.peak_out > 9000 && !cold) {
    const loopPool = withLearned(templates.open_loop, input.learned?.open_loop);
    const loop = take(loopPool);
    lines.push({ at_ms: 2600, text: loop, kind: "open_loop", style: "spannend", alts: shorterAlts(loop, loopPool) });
  }

  const reactions = persona.expressions;
  for (const [i, e] of chosen.entries()) {
    const type = e.type ?? mainType;
    if (!short && i > 0) {
      const bridge = take(templates.bridge);
      lines.push({ at_ms: Math.max(0, e.peak_out - 9000), text: bridge, kind: "bridge", style: "normaal" });
    }
    const options = withLearned(templates.anticipation[type], input.learned?.anticipation[type]);
    const text = take(options, e);
    lines.push({ at_ms: Math.max(0, e.peak_out - 600 - estimateMs(text)), text, kind: "anticipation", event_src_ms: e.t_peak, event_id: e.id, style: styleFor("anticipation", type), alts: shorterAlts(text, options, e) });
    // After the peak at most one short reaction, then on to the next arc.
    // Bad things get shocked reactions, good things hyped ones (never "UNREAL!" after a death).
    const good = type === "geluk" || type === "bouw";
    // "…GONE." / "Rest in pixels" only after a real death, never after a hit the player survives.
    const base = good ? [...reactions.reaction_good, ...reactions.after_win] : e.kind === "death" ? [...reactions.reaction, ...reactions.after_fail] : type === "grap" ? [...reactions.reaction, ...reactions.reaction_good] : reactions.reaction;
    const pool = withLearned(base, good ? input.learned?.reaction_good : input.learned?.reaction_bad);
    const shortPool = pool.filter((r) => r.split(/\s+/).length <= 5);
    const reaction = take(shortPool);
    lines.push({ at_ms: e.peak_out + settings.sync.peak_quiet_ms / 2, text: reaction, kind: "reaction", event_src_ms: e.t_peak, event_id: e.id, style: styleFor("reaction", type), alts: shorterAlts(reaction, shortPool) });
  }

  // The loop line only when there is room after the last reaction (a Short that ends on its payoff needs none).
  const lastPeak = chosen.length ? chosen[chosen.length - 1].peak_out : -Infinity;
  const loopRoom = input.targetMs - (lastPeak + settings.sync.peak_quiet_ms / 2 + 1200);
  if (settings.features.loop_ending && input.targetMs > 8000 && loopRoom >= 2200) {
    const endPool = withLearned(templates.loop_end, input.learned?.loop);
    const end = take(endPool);
    lines.push({ at_ms: Math.max(0, input.targetMs - estimateMs(end) - 400), text: end, kind: "loop", style: "spannend", alts: shorterAlts(end, endPool) });
  }
  lines.sort((a, b) => a.at_ms - b.at_ms);

  return { hook, lines: fillSilences(lines, take, rnd, input.targetMs), mainType, used };
}

/** The tension fillers: interjections and build-up lines (never a description of what is on screen). */
export const fillerOptions = () => [...persona.expressions.interjection.map((x) => `${x[0].toUpperCase()}${x.slice(1)}${/[!?.…—]$/.test(x) ? "" : "…"}`), ...templates.build];

/**
 * Keep the tension up: no stretch of more than ~6 s without a word before the next line (an explosive narrator does
 * not go quiet for 14 s). Used for the free engine and for the AI script. `take` picks a phrase (with rotation).
 */
export function fillSilences(lines: VoLine[], take: (options: string[]) => string, rnd: () => number, /** Video length: the stretch after the last line counts too. */ targetMs?: number): VoLine[] {
  const MAX_GAP = 6000;
  const STEP = 1500 + 1800 + 2500; // a filler with its pause, as placed before 17-11-2026
  const sorted = [...lines].sort((a, b) => a.at_ms - b.at_ms);
  const interjections = persona.expressions.interjection.map((x) => `${x[0].toUpperCase()}${x.slice(1)}${/[!?.…—]$/.test(x) ? "" : "…"}`);
  // Every filler at most once per video (Milan 17-11-2026, "gekke tekst!": a long video said "I don't like this. At ALL."
  // seven times). Once they are used up the game sound carries the gap.
  const said = new Set(sorted.map((l) => l.text));
  const unused = (options: string[]) => options.filter((o) => !said.has(o));
  // Where a filler could go (every quiet stretch, also the end), then spread the few unique ones over the whole video
  // instead of spending them all in the first minute and a half.
  const slots: number[] = [];
  for (const [i, l] of sorted.entries()) {
    const next = sorted[i + 1];
    let cursor = l.at_ms + estimateMs(l.text) + 1500;
    const until = next ? next.at_ms - 800 : targetMs !== undefined ? targetMs - 1500 : -Infinity;
    while (until - cursor > MAX_GAP - 2000) {
      slots.push(Math.round(cursor + 1500));
      cursor += STEP;
    }
  }
  const budget = unused([...interjections, ...templates.build]).length;
  const chosen = slots.length <= budget ? slots : Array.from({ length: budget }, (_, k) => slots[Math.floor(((k + 0.5) * slots.length) / budget)]);
  const added: VoLine[] = [];
  for (const at of chosen) {
    const fresh = unused(rnd() < 0.35 ? interjections : templates.build);
    const options = fresh.length ? fresh : unused([...interjections, ...templates.build]);
    if (!options.length) break;
    const text = take(options);
    if (said.has(text)) break;
    said.add(text);
    added.push({ at_ms: at, text, kind: "bridge", style: "spannend" });
  }
  return [...sorted, ...added].sort((a, b) => a.at_ms - b.at_ms);
}

export type GateItem = { index: number; text: string; ok: boolean; reason: string | null; atMs: number; ms: number; speed: number };
export type GateResult = { ok: boolean; items: GateItem[] };

/**
 * The hard sync gate (section 1c). `durations[i]` is the real spoken length of line i (from the TTS audio).
 * Places every line, at most 1.08x faster, and reports per line whether it fits the rules.
 */
export function syncGate(lines: VoLine[], durations: number[], segments: Segment[], timeline: EventTimeline | null, targetMs: number, settings: Settings): GateResult {
  const { lead_min_ms, lead_max_ms, peak_quiet_ms, max_speed } = settings.sync;
  const half = peak_quiet_ms / 2;
  const quiet = eventsInMontage(segments, timeline).filter((e) => e.payoff >= BIG_PEAK).map((e) => [e.peak_out - half, e.peak_out + half] as const);
  const items: GateItem[] = [];
  let prevEnd = -GAP_MS;
  const order = lines.map((l, i) => ({ l, i })).sort((a, b) => a.l.at_ms - b.l.at_ms);
  for (const { l, i } of order) {
    const d = Math.max(1, durations[i]);
    const peak = l.event_src_ms !== undefined ? sourceToOut(segments, l.event_src_ms) : null;
    let start: number;
    let speed = 1;
    let reason: string | null = null;
    const earliest = Math.max(0, prevEnd + GAP_MS);
    if (l.kind === "anticipation" && peak !== null) {
      // Aim to finish 0.6 s before the peak, inside the 0.3-1.5 s window.
      const latestEnd = peak - lead_min_ms;
      const earliestEnd = peak - lead_max_ms;
      start = Math.max(earliest, Math.min(peak - 600, latestEnd) - d);
      let end = start + d;
      if (end > latestEnd) {
        const fast = Math.min(max_speed, d / Math.max(1, latestEnd - start));
        if (start + d / max_speed <= latestEnd) {
          speed = Math.round(fast * 100) / 100;
          end = start + d / speed;
        } else reason = `te lang: ${(d / 1000).toFixed(1)} s, er is ${(Math.max(0, latestEnd - start) / 1000).toFixed(1)} s tot ${(lead_min_ms / 1000).toFixed(1)} s vóór de piek`;
      }
      if (!reason && end < earliestEnd - 4000) reason = "zin staat te ver van zijn moment";
    } else if (l.kind === "reaction" && peak !== null) {
      start = Math.max(earliest, peak + half);
      if (start > peak + 2500) reason = "reactie komt te laat na de piek";
    } else {
      start = Math.max(earliest, l.at_ms);
      if (l.kind === "hook" && start > settings.shorts.first_action_max_ms) reason = "eerste woord pas na 0,5 s";
    }
    const end = start + d / speed;
    if (!reason && end > targetMs + 200) reason = "zin loopt over het einde van de video";
    const covered = quiet.find(([a, b]) => start < b && end > a);
    if (!reason && covered) reason = "stem valt over de stilte rond een grote piek";
    items.push({ index: i, text: l.text, ok: !reason, reason, atMs: Math.round(start), ms: Math.round(d / speed), speed });
    if (!reason) prevEnd = end;
  }
  items.sort((a, b) => a.index - b.index);
  return { ok: items.every((x) => x.ok), items };
}

/**
 * Next attempt after a failed gate: every failing line takes its next shorter version. Returns null for a line
 * that has no shorter version left (it will be dropped).
 */
export function shortenFailing(lines: VoLine[], gate: GateResult): { lines: (VoLine | null)[]; changed: number[] } {
  const changed: number[] = [];
  const next = lines.map((l, i) => {
    const item = gate.items[i];
    if (!item || item.ok) return l;
    const [alt, ...rest] = l.alts ?? [];
    changed.push(i);
    return alt ? { ...l, text: alt, alts: rest } : null;
  });
  return { lines: next, changed };
}

/** Short Dutch summary for the QC list and the review. */
export function gateSummary(g: GateResult, attempts: number, dropped: string[]): string {
  const ok = g.items.filter((i) => i.ok).length;
  const faster = g.items.filter((i) => i.ok && i.speed > 1).length;
  return `${ok}/${g.items.length} zinnen op tijd na ${attempts} ${attempts === 1 ? "poging" : "pogingen"}${faster ? `, ${faster} iets sneller (max 1,08×)` : ""}${dropped.length ? `; weggelaten: ${dropped.map((d) => `"${d}"`).join(", ")}` : ""}`;
}

export type GateRun = { lines: VoLine[]; durations: number[]; gate: GateResult; attempts: number; dropped: string[]; flagged: boolean };

/**
 * Runs the gate with real audio: speak every line, place, shorten the failing lines, speak only those again.
 * `speak(line, index)` makes the audio and returns its length in ms. After `max_attempts` the lines that still
 * fail are dropped (better silence than a voice over the peak) and the video is flagged for Milan's review.
 */
export async function runGate(input: { lines: VoLine[]; segments: Segment[]; timeline: EventTimeline | null; targetMs: number; settings: Settings; speak: (line: VoLine, index: number) => Promise<number> }): Promise<GateRun> {
  let lines = [...input.lines];
  let durations = await Promise.all(lines.map((l, i) => input.speak(l, i)));
  const dropped: string[] = [];
  let attempts = 1;
  let gate = syncGate(lines, durations, input.segments, input.timeline, input.targetMs, input.settings);
  while (!gate.ok && attempts < input.settings.sync.max_attempts) {
    attempts++;
    const next = shortenFailing(lines, gate);
    const kept: VoLine[] = [];
    const keptDur: number[] = [];
    for (const [i, l] of next.lines.entries()) {
      if (!l) {
        dropped.push(lines[i].text);
        continue;
      }
      kept.push(l);
      keptDur.push(next.changed.includes(i) ? await input.speak(l, kept.length - 1) : durations[i]);
    }
    lines = kept;
    durations = keptDur;
    gate = syncGate(lines, durations, input.segments, input.timeline, input.targetMs, input.settings);
  }
  const flagged = !gate.ok || dropped.length > 0;
  if (!gate.ok) {
    // Last resort: leave out what still does not fit, so the voice never talks over a peak.
    const keep = gate.items.filter((g) => g.ok).map((g) => g.index);
    dropped.push(...gate.items.filter((g) => !g.ok).map((g) => g.text));
    lines = keep.map((i) => lines[i]);
    durations = keep.map((i) => durations[i]);
    gate = syncGate(lines, durations, input.segments, input.timeline, input.targetMs, input.settings);
  }
  return { lines, durations, gate, attempts, dropped, flagged };
}

/** Stored in yt_scripts.model when the free template engine wrote the script (no AI credits used). */
export const FREE_ENGINE_MODEL = "gratis-engine";

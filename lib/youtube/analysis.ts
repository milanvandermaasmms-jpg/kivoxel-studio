// Pakket 52: from analysed moments to formats, edit plans and scripts. Pure functions (only the hook rules imported), so both the
// dashboard and the worker (plain Node with type stripping) can use them. Formats and timings: docs/youtube-onderzoek.md, chapter 5.
import { HOOK_TYPES, parseHooks, type Hook } from "./hooks.ts";

export type Format = "A" | "B" | "C";
export const MOMENT_KINDS = ["near_death", "rescue", "mistake", "rare_find", "discovery", "escape", "surprise", "build_result"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const PRIVACY_FLAGS = ["gamertag", "chat", "voice", "notification", "face", "real_name"] as const;
export type PrivacyFlag = (typeof PRIVACY_FLAGS)[number];

export const KIND_LABEL: Record<MomentKind, string> = {
  near_death: "Bijna dood",
  rescue: "Redding",
  mistake: "Fout",
  rare_find: "Zeldzame vondst",
  discovery: "Ontdekking",
  escape: "Ontsnapping",
  surprise: "Verrassende afloop",
  build_result: "Bouwresultaat",
};
export const PRIVACY_LABEL: Record<PrivacyFlag, string> = {
  gamertag: "gamertag",
  chat: "chat in beeld",
  voice: "stem te horen",
  notification: "melding in beeld",
  face: "gezicht",
  real_name: "echte naam",
};

/** Which Short format a kind of moment suits. A build result only works inside a long video (format C). */
export const FORMAT_FOR_KIND: Record<MomentKind, Format> = {
  near_death: "A",
  escape: "A",
  rescue: "A",
  mistake: "A",
  surprise: "A",
  rare_find: "B",
  discovery: "B",
  build_result: "C",
};

export type Moment = {
  id?: string;
  kind: MomentKind;
  startMs: number;
  endMs: number;
  peakMs: number;
  reason: string;
  score: number;
  hasContext: boolean;
  contextNote: string | null;
  hasPayoff: boolean;
  payoffNote: string | null;
  privacyFlags: PrivacyFlag[];
  suggestedFormat: Format;
};

/** A moment needs at least this much lead-in before the peak (context) and this much after it (payoff). */
export const MIN_CONTEXT_MS = 3000;
export const MIN_PAYOFF_MS = 1500;
/** When a moment is cut too tight, it is widened to this much before and after the peak (if the recording has it). */
export const LEAD_IN_MS = 6000;
export const AFTER_PEAK_MS = 4000;
/** Format A and B are built from one continuous piece of raw footage of at most about 60 s. */
export const MAX_SHORT_SOURCE_MS = 60_000;
/** Format C needs a recording of at least 8 minutes and at least three usable story moments. */
export const MIN_LONG_RECORDING_MS = 8 * 60_000;
export const MIN_LONG_MOMENTS = 3;

const isKind = (v: unknown): v is MomentKind => typeof v === "string" && (MOMENT_KINDS as readonly string[]).includes(v);
const isFlag = (v: unknown): v is PrivacyFlag => typeof v === "string" && (PRIVACY_FLAGS as readonly string[]).includes(v);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/**
 * A time from the analysis service: "MM:SS", "H:MM:SS" (optionally with tenths) or, as before, a number of
 * milliseconds. Gemini is far more exact with MM:SS than with millisecond numbers in long videos.
 */
export function parseTime(v: unknown): number | null {
  if (typeof v === "number") return int(v);
  if (typeof v !== "string") return null;
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(v);
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s >= 60 || (m[1] !== undefined && min >= 60)) return null;
  const fraction = m[4] ? Math.round(Number(`0.${m[4]}`) * 1000) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + fraction;
}

/** Long recordings go to the service in parts of this length (with overlap), so its times stay exact. */
export const ANALYSIS_CHUNK_MS = 8 * 60_000;
export const ANALYSIS_OVERLAP_MS = 20_000;
export type Chunk = { index: number; count: number; startMs: number; endMs: number };

/** The parts of a recording for the analysis; one part when it is short enough. */
export function analysisChunks(durationMs: number): Chunk[] {
  if (durationMs <= ANALYSIS_CHUNK_MS + 60_000) return [{ index: 0, count: 1, startMs: 0, endMs: durationMs }];
  const step = ANALYSIS_CHUNK_MS - ANALYSIS_OVERLAP_MS;
  const starts: number[] = [];
  for (let s = 0; s < durationMs - ANALYSIS_OVERLAP_MS; s += step) starts.push(s);
  // A very short last part is merged into the one before.
  if (starts.length > 1 && durationMs - starts[starts.length - 1] < 90_000) starts.pop();
  return starts.map((s, i) => ({ index: i, count: starts.length, startMs: s, endMs: i === starts.length - 1 ? durationMs : Math.min(durationMs, s + ANALYSIS_CHUNK_MS) }));
}

/**
 * Checks one moment as the analysis service reported it. The service's own yes/no on context and payoff only counts
 * when the timecodes back it up: enough lead-in before the peak and a visible outcome after it.
 */
export function checkMoment(raw: unknown, durationMs: number): { moment: Moment } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "geen object" };
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return { error: `onbekend soort moment: ${String(r.kind)}` };
  const rawStart = parseTime(r.start ?? r.start_ms);
  const endMs = parseTime(r.end ?? r.end_ms);
  if (rawStart === null || endMs === null) return { error: "tijdcode ontbreekt" };
  if (rawStart < 0 || endMs <= rawStart) return { error: "tijdcodes kloppen niet" };
  let startMs = rawStart;
  if (endMs > durationMs + 1000) return { error: "tijdcode ligt na het einde van de opname" };
  let end = Math.min(endMs, durationMs);
  const peak = parseTime(r.peak ?? r.peak_ms);
  const peakMs = peak !== null && peak >= startMs && peak <= end ? peak : Math.round((startMs + end) / 2);
  const reason = text(r.reason, 500);
  if (!reason) return { error: "reden ontbreekt" };
  const score = Math.max(0, Math.min(100, int(r.score) ?? 0));

  let contextNote = text(r.context_note, 300);
  let hasContext = r.has_context === true;
  // The service often cuts the window tight around the peak (for example a PvP death right at end_ms). When the
  // recording itself has room, the window is widened: the montage takes build-up and outcome from around the moment
  // anyway. Only when the recording really starts or stops too close to the peak is the moment not usable.
  if (hasContext && peakMs - startMs < MIN_CONTEXT_MS) {
    if (peakMs >= MIN_CONTEXT_MS) startMs = Math.max(0, peakMs - LEAD_IN_MS);
    else {
      hasContext = false;
      contextNote = `Te weinig aanloop: de opname begint ${formatTimecode(peakMs)} vóór het hoogtepunt (minimaal ${MIN_CONTEXT_MS / 1000} s).`;
    }
  }
  let payoffNote = text(r.payoff_note, 300);
  let hasPayoff = r.has_payoff === true;
  if (hasPayoff && end - peakMs < MIN_PAYOFF_MS) {
    if (durationMs - peakMs >= MIN_PAYOFF_MS) end = Math.min(durationMs, peakMs + AFTER_PEAK_MS);
    else {
      hasPayoff = false;
      payoffNote = `De afloop is niet te zien: de opname stopt ${formatTimecode(durationMs - peakMs)} na het hoogtepunt.`;
    }
  }
  const privacyFlags = Array.isArray(r.privacy_flags) ? [...new Set(r.privacy_flags.filter(isFlag))] : [];
  const suggested = r.suggested_format === "A" || r.suggested_format === "B" || r.suggested_format === "C" ? r.suggested_format : FORMAT_FOR_KIND[r.kind];
  return { moment: { kind: r.kind, startMs, endMs: end, peakMs, reason, score, hasContext, contextNote, hasPayoff, payoffNote, privacyFlags, suggestedFormat: suggested } };
}

/** Parses the JSON the analysis service returns ({ "moments": [...] }); keeps what is valid and says what was dropped. */
export function parseAnalysis(raw: unknown, durationMs: number, chunk?: Chunk): { moments: Moment[]; rejected: string[] } {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { moments?: unknown }).moments) ? (raw as { moments: unknown[] }).moments : null;
  if (!list) return { moments: [], rejected: ["antwoord bevat geen lijst met momenten"] };
  const moments: Moment[] = [];
  const rejected: string[] = [];
  const part = chunk && chunk.count > 1 ? ` (deel ${chunk.index + 1})` : "";
  list.forEach((item, i) => {
    // Times in a part are counted from the start of that part: move them to the time of the whole recording.
    const shifted = chunk ? toRecordingTime(item, chunk) : item;
    if (typeof shifted === "string") {
      rejected.push(`moment ${i + 1}${part}: ${shifted}`);
      return;
    }
    const checked = checkMoment(shifted, durationMs);
    if ("error" in checked) rejected.push(`moment ${i + 1}${part}: ${checked.error}`);
    else moments.push(checked.moment);
  });
  moments.sort((a, b) => a.startMs - b.startMs);
  return { moments, rejected };
}

/** start/peak/end of one answer of a part, moved to the time of the whole recording; a text says why not. */
function toRecordingTime(item: unknown, chunk: Chunk): Record<string, unknown> | string {
  if (!item || typeof item !== "object") return "geen object";
  const r = item as Record<string, unknown>;
  const length = chunk.endMs - chunk.startMs;
  const out: Record<string, unknown> = { ...r };
  for (const key of ["start", "peak", "end"] as const) {
    const v = parseTime(r[key] ?? r[`${key}_ms`]);
    delete out[key];
    delete out[`${key}_ms`];
    if (v === null) continue;
    if (v > length + 2000) return `tijd ${String(r[key] ?? r[`${key}_ms`])} valt buiten dit deel van ${formatTimecode(length)}`;
    out[`${key}_ms`] = chunk.startMs + Math.min(v, length);
  }
  return out;
}

/** Moments of overlapping parts: the same kind with peaks less than 10 s apart is one moment (the best score stays). */
export function mergeMoments(lists: Moment[][]): Moment[] {
  const out: Moment[] = [];
  for (const m of lists.flat().sort((a, b) => b.score - a.score)) {
    if (out.some((o) => o.kind === m.kind && Math.abs(o.peakMs - m.peakMs) < 10_000)) continue;
    out.push(m);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export const isUsable = (m: Pick<Moment, "hasContext" | "hasPayoff">) => m.hasContext && m.hasPayoff;

const overlap = (a: Moment, b: Moment) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

export type PlannedVideo = { planKey: string; format: Format; moments: Moment[]; promise: string; /** Set for one part of a long recording told in full (Deel 1..N). */ part?: SeriesPart };

/**
 * A long recording is told in full, as consecutive long videos (parts): together they cover the recording from the
 * first to the last second, without overlap and without gaps. Each part is about SERIES_PART_MS of footage and ends at
 * a natural story break: in the quiet stretch between two moments, never in the middle of one.
 */
export const SERIES_MIN_MS = 15 * 60_000;
export const SERIES_PART_MS = 7.5 * 60_000;
export const MIN_PART_MS = 3 * 60_000;
export type SeriesPart = { index: number; count: number; startMs: number; endMs: number };

/** "C:part:2/5:448000-901000": stable per part, and the script step reads the part's range back from it. */
export const seriesKey = (p: SeriesPart) => `C:part:${p.index + 1}/${p.count}:${p.startMs}-${p.endMs}`;
export function parseSeriesKey(planKey: string | null | undefined): SeriesPart | null {
  const m = /(?:^|:)C:part:(\d+)\/(\d+):(\d+)-(\d+)$/.exec(planKey ?? "");
  if (!m) return null;
  const [index, count, startMs, endMs] = [Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])];
  return index >= 0 && index < count && endMs > startMs ? { index, count, startMs, endMs } : null;
}

/** Where a part may end: just before the build-up of the next moment, in the quiet stretch after the previous one. */
function storyBreaks(moments: Moment[]): { at: number; gap: number }[] {
  const sorted = [...moments].sort((a, b) => a.startMs - b.startMs);
  const out: { at: number; gap: number }[] = [];
  let reach = 0;
  for (let i = 1; i < sorted.length; i++) {
    reach = Math.max(reach, sorted[i - 1].endMs);
    const b = sorted[i];
    if (b.startMs <= reach) continue;
    const lo = Math.min(b.startMs, reach + 5000);
    out.push({ at: Math.max(lo, Math.min(b.startMs, b.peakMs - CHAPTER_BEFORE_MS)), gap: b.startMs - reach });
  }
  return out;
}

/** Splits a recording into parts at story breaks; every part holds at least one moment. One part when it is short. */
export function seriesParts(moments: Moment[], durationMs: number): SeriesPart[] {
  const whole = [{ index: 0, count: 1, startMs: 0, endMs: durationMs }];
  if (durationMs < SERIES_MIN_MS || !moments.length) return whole;
  const wanted = Math.max(2, Math.round(durationMs / SERIES_PART_MS));
  const partMs = durationMs / wanted;
  const breaks = storyBreaks(moments);
  const cuts: number[] = [];
  for (let k = 1; k < wanted; k++) {
    const ideal = k * partMs;
    const prev = cuts[cuts.length - 1] ?? 0;
    const fits = breaks.filter((b) => b.at >= prev + MIN_PART_MS && b.at <= durationMs - MIN_PART_MS && Math.abs(b.at - ideal) <= 0.35 * partMs);
    // Close to the even split, but a longer quiet stretch (a real break in the story) may pull the cut a little.
    const best = fits.sort((a, b) => Math.abs(a.at - ideal) - Math.min(a.gap, 120_000) / 2 - (Math.abs(b.at - ideal) - Math.min(b.gap, 120_000) / 2) || a.at - b.at)[0];
    if (best) cuts.push(best.at);
  }
  // A part without any moment has nothing to tell: it joins the part before it.
  const bounds = [0, ...cuts, durationMs];
  const kept: number[] = [0];
  for (let i = 1; i < bounds.length; i++) {
    const start = kept[kept.length - 1];
    const end = bounds[i];
    const last = i === bounds.length - 1;
    const has = moments.some((m) => m.peakMs >= start && (last ? m.peakMs <= end : m.peakMs < end));
    if (has || last) kept.push(end);
  }
  // The last part had no moment: it joins the one before as well.
  if (kept.length > 2 && !moments.some((m) => m.peakMs >= kept[kept.length - 2])) kept.splice(kept.length - 2, 1);
  const count = kept.length - 1;
  if (count < 2) return whole;
  return kept.slice(0, -1).map((startMs, index) => ({ index, count, startMs, endMs: kept[index + 1] }));
}

/** The moments whose peak lies in the part (the last part includes the very end). */
export const momentsInPart = (moments: Moment[], p: SeriesPart) =>
  moments.filter((m) => m.peakMs >= p.startMs && (p.index === p.count - 1 ? m.peakMs <= p.endMs : m.peakMs < p.endMs)).sort((a, b) => a.startMs - b.startMs);

/** Every title of a part says which part it is, so viewers find the parts in order. */
export function seriesTitles(titles: string[], p: SeriesPart): string[] {
  const tag = ` (Part ${p.index + 1})`;
  return titles.map((t) => (/\bpart\s*\d/i.test(t) ? t : `${t.slice(0, 100 - tag.length).trimEnd()}${tag}`));
}

const PROMISE: Record<Format, string> = {
  A: "Je ziet in 20 seconden of hij het overleeft.",
  B: "Kijk wat hij vond, en waar.",
  C: "Eén survival-avontuur van begin tot eind, verteld als een verhaal.",
};

/**
 * Turns the usable moments of one recording into videos. Every Short gets its own moment (its own promise and payoff);
 * a moment that overlaps more than half with a better one of the same format is skipped. A long video (format C) is
 * only planned when the recording is long enough and has at least three usable moments.
 * `key` makes the plan stable: analysing the same recording again yields the same plan keys.
 */
export function planVideos(moments: Moment[], durationMs: number, key: (m: Moment) => string): PlannedVideo[] {
  // Superprompt (fase C): per recording one long video and at most MAX_SHORTS Shorts, the best moments first.
  const usable = moments.filter(isUsable);
  const plans: PlannedVideo[] = [];
  const taken: Moment[] = [];
  for (const m of [...usable].sort((a, b) => b.score - a.score || a.startMs - b.startMs)) {
    if (m.suggestedFormat === "C" || m.endMs - m.startMs > MAX_SHORT_SOURCE_MS) continue;
    const clash = taken.some((t) => t.suggestedFormat === m.suggestedFormat && overlap(t, m) > 0.5 * Math.min(t.endMs - t.startMs, m.endMs - m.startMs));
    if (clash) continue;
    if (taken.length >= MAX_SHORTS) break;
    taken.push(m);
    plans.push({ planKey: `${m.suggestedFormat}:${key(m)}`, format: m.suggestedFormat, moments: [m], promise: PROMISE[m.suggestedFormat] });
  }
  if (durationMs >= MIN_LONG_RECORDING_MS && usable.length >= MIN_LONG_MOMENTS) {
    // A long recording: the whole story, in parts. All moments of a part are linked (also the less usable ones),
    // so the montage knows every privacy flag in its footage.
    const parts = seriesParts(moments, durationMs);
    if (parts.length > 1) {
      for (const part of parts) plans.push({ planKey: seriesKey(part), format: "C", moments: momentsInPart(moments, part), promise: `Deel ${part.index + 1} van ${part.count}: ${PROMISE.C}`, part });
      return plans;
    }
    const story = [...usable].sort((a, b) => b.score - a.score).slice(0, MAX_LONG_MOMENTS).sort((a, b) => a.startMs - b.startMs);
    plans.push({ planKey: "C", format: "C", moments: story, promise: PROMISE.C });
  }
  return plans;
}

export type Segment = {
  part: "hook" | "build" | "payoff" | "teaser" | "search" | "discovery" | "aftermath" | "cold_open" | "goals" | "chapter";
  src_start_ms: number;
  src_end_ms: number;
  out_start_ms: number;
  speed: number;
  effects: string[];
  note: string;
  /** Text shown in the picture during this segment (editor, fase C3). */
  text?: string;
};
export type EditPlan = { segments: Segment[]; targetMs: number; warnings: string[] };

/** Target lengths from the research (start values to test, not a proven optimum). */
export const TARGET: Record<Format, { minMs: number; maxMs: number }> = {
  A: { minMs: 30_000, maxMs: 45_000 },
  B: { minMs: 30_000, maxMs: 45_000 },
  C: { minMs: 8 * 60_000, maxMs: 15 * 60_000 },
};
/** One part of a recording told in full: about 7.5 minutes of footage plus the cold open. */
export const PART_TARGET = { minMs: 5 * 60_000, maxMs: 15 * 60_000 };
/** The target length of a video: a part of a story told in parts has its own. */
export const targetFor = (format: Format, planKey?: string | null) => (format === "C" && parseSeriesKey(planKey) ? PART_TARGET : TARGET[format]);
/** "Deel 2 van 5" for a part, null for any other video. */
export function partLabel(planKey: string | null | undefined): string | null {
  const p = parseSeriesKey(planKey);
  return p ? `Deel ${p.index + 1} van ${p.count}` : null;
}

/** Builds the segment list; speeds up a piece when it does not fit its slot (at most 2x, so it stays readable). */
function assemble(parts: Array<Omit<Segment, "out_start_ms" | "speed"> & { slotMs?: number }>): Segment[] {
  let out = 0;
  const segments: Segment[] = [];
  for (const p of parts) {
    const len = p.src_end_ms - p.src_start_ms;
    if (len <= 0) continue;
    const speed = p.slotMs && len > p.slotMs ? Math.min(2, Math.round((len / p.slotMs) * 100) / 100) : 1;
    const { slotMs: _slot, ...rest } = p;
    segments.push({ ...rest, out_start_ms: out, speed });
    out += Math.round(len / speed);
  }
  return segments;
}
const outLength = (s: Segment[]) => (s.length ? s[s.length - 1].out_start_ms + Math.round((s[s.length - 1].src_end_ms - s[s.length - 1].src_start_ms) / s[s.length - 1].speed) : 0);

/** A chapter of a long video takes this much footage around its moment: 1:45 in total, within the 1.5-3 minutes of the research. */
export const CHAPTER_BEFORE_MS = 60_000;
export const CHAPTER_AFTER_MS = 45_000;
/** A Short takes up to this much build-up before the peak, also when the analysis cut the moment tighter. */
export const SHORT_LEAD_IN_MS = 30_000;
/** At most this many Shorts per recording (superprompt: 3-6). */
export const MAX_SHORTS = 6;
/** A long video tells at most this many moments as chapters (about 1:45 each, so 8-15 minutes). */
export const MAX_LONG_MOMENTS = 7;

/**
 * Builds the edit plan. `durationMs` (length of the recording) lets the plan take build-up and outcome from just outside
 * the moment the analysis reported, so a Short reaches its target length; without it the plan stays inside the moment.
 */
export function buildEditPlan(format: Format, moments: Moment[], durationMs = Number.POSITIVE_INFINITY, part?: SeriesPart | null): EditPlan {
  const warnings: string[] = [];
  let segments: Segment[];
  if (format === "C" && part) {
    // One part of the whole story: every second of its footage, in order, one chapter per moment. Only the cold open
    // (the best moment of this part, 15 s) is shown twice, as a teaser.
    const ordered = momentsInPart(moments, part);
    if (!ordered.length) warnings.push("Dit deel heeft geen momenten.");
    const best = [...ordered].sort((a, b) => Number(isUsable(b)) - Number(isUsable(a)) || b.score - a.score)[0];
    const starts = ordered.map((m, i) => {
      if (i === 0) return part.startMs;
      const prevEnd = Math.max(...ordered.slice(0, i).map((p) => p.endMs));
      return Math.max(part.startMs, Math.min(m.startMs, Math.max(prevEnd, m.peakMs - CHAPTER_BEFORE_MS)));
    });
    for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1]);
    const chapters = ordered.length
      ? ordered.map((m, i) => ({ part: "chapter" as const, src_start_ms: starts[i], src_end_ms: i === ordered.length - 1 ? part.endMs : starts[i + 1], effects: ["captions", "day_label"], note: `Hoofdstuk ${i + 1}: ${KIND_LABEL[m.kind]}` }))
      : [{ part: "chapter" as const, src_start_ms: part.startMs, src_end_ms: part.endMs, effects: ["captions"], note: "Het verhaal gaat verder" }];
    const recap = part.index > 0 ? ", daarna in één zin wat er in het vorige deel gebeurde" : "";
    segments = assemble([
      ...(best ? [{ part: "cold_open" as const, src_start_ms: Math.max(part.startMs, best.peakMs - 7500), src_end_ms: Math.min(part.endMs, best.peakMs + 7500), effects: ["captions"], note: `Het spannendste moment van deel ${part.index + 1}${recap}` }] : []),
      ...chapters,
    ]);
    const targetMs = outLength(segments);
    if (segments.length && targetMs < PART_TARGET.minMs) warnings.push(`Korter dan de richtlengte van een deel (${formatTimecode(targetMs)}, richtlengte ${formatTimecode(PART_TARGET.minMs)}-${formatTimecode(PART_TARGET.maxMs)}).`);
    if (targetMs > PART_TARGET.maxMs) warnings.push(`Langer dan de richtlengte van een deel (${formatTimecode(targetMs)}).`);
    return { segments, targetMs, warnings };
  }
  if (format === "A" || format === "B") {
    const m = moments[0];
    if (!m) return { segments: [], targetMs: 0, warnings: ["Geen moment gekozen."] };
    // How far the plan may run after the peak: the end of the recording when known, otherwise the end of the moment.
    const limit = Number.isFinite(durationMs) ? durationMs : m.endMs;
    if (format === "A") {
      // 0-1 s dreiging plus hook; 1-23 s opbouw (versneld); 23-33 s afloop; abrupt einde zodat de Short opnieuw begint (30-45 s).
      const hookStart = Math.max(m.startMs, m.peakMs - 1000);
      segments = assemble([
        { part: "hook", src_start_ms: hookStart, src_end_ms: m.peakMs, effects: ["top_line", "zoom"], note: "Dreiging in beeld, eerste woorden van de hook" },
        { part: "build", src_start_ms: Math.max(0, Math.min(m.startMs, m.peakMs - SHORT_LEAD_IN_MS)), src_end_ms: m.peakMs, slotMs: 22_000, effects: ["captions", "zoom_hearts"], note: "Opbouw; saaie stukken versneld" },
        { part: "payoff", src_start_ms: m.peakMs, src_end_ms: Math.min(limit, m.peakMs + 10_000), effects: ["sfx", "captions"], note: "Afloop; abrupt eindigen voor een naadloze herhaling" },
      ]);
    } else {
      // 0-1 s teaser van de vondst; 1-15 s zoeken (versneld); 15-25 s ontdekking met zoom en tekst; 25-35 s wat hij ermee doet (30-45 s).
      const findEnd = Math.min(limit, m.peakMs + 10_000);
      segments = assemble([
        { part: "teaser", src_start_ms: m.peakMs, src_end_ms: Math.min(limit, m.peakMs + 1000), effects: ["blur", "top_line"], note: "Flits van de vondst, half verborgen" },
        { part: "search", src_start_ms: Math.max(0, Math.min(m.startMs, m.peakMs - 24_000)), src_end_ms: m.peakMs, slotMs: 14_000, effects: ["captions"], note: "Het zoeken in sneltreinvaart" },
        { part: "discovery", src_start_ms: m.peakMs, src_end_ms: findEnd, effects: ["zoom", "text", "sfx"], note: "De ontdekking met zoom en tekst" },
        { part: "aftermath", src_start_ms: findEnd, src_end_ms: Math.min(limit, findEnd + 10_000), effects: ["captions"], note: "Wat hij ermee doet" },
      ]);
    }
  } else {
    if (moments.length < MIN_LONG_MOMENTS) warnings.push(`Een lange video vraagt minstens ${MIN_LONG_MOMENTS} bruikbare momenten.`);
    const best = [...moments].sort((a, b) => b.score - a.score)[0];
    const ordered = [...moments].sort((a, b) => a.startMs - b.startMs);
    // Chapters of 1.5-3 minutes (research chapter 5): a window around each moment, without overlapping the previous one.
    let previousEnd = 0;
    const chapters = ordered.map((m, i) => {
      const start = Math.max(previousEnd, m.peakMs - CHAPTER_BEFORE_MS, 0);
      const end = Math.max(start, Math.min(durationMs, m.peakMs + CHAPTER_AFTER_MS));
      previousEnd = end;
      return { part: "chapter" as const, src_start_ms: start, src_end_ms: end, effects: ["captions", "day_label"], note: `Hoofdstuk ${i + 1}: ${KIND_LABEL[m.kind]}` };
    });
    segments = best
      ? assemble([
          { part: "cold_open", src_start_ms: Math.max(0, best.peakMs - 7500), src_end_ms: Math.min(durationMs, best.peakMs + 7500), effects: ["captions"], note: "Het spannendste moment, daarna: \"But let's start at the beginning.\"" },
          { part: "goals", src_start_ms: 0, src_end_ms: Math.min(15_000, chapters[0].src_start_ms || 15_000), effects: ["text"], note: "Regel en twee of drie doelen benoemen vóór 30 s" },
          ...chapters,
        ])
      : [];
  }
  const targetMs = outLength(segments);
  const t = TARGET[format];
  if (segments.length && targetMs < t.minMs) warnings.push(`Korter dan de richtlengte (${formatTimecode(targetMs)}, richtlengte ${formatTimecode(t.minMs)}-${formatTimecode(t.maxMs)}).`);
  if (targetMs > t.maxMs) warnings.push(`Langer dan de richtlengte (${formatTimecode(targetMs)}); de montage moet meer wegknippen.`);
  return { segments, targetMs, warnings };
}

export type ScriptLine = { at_ms: number; text: string };
/** hooks and loopLine: hook-first production (fase C2); empty for scripts written before. */
export type ScriptDraft = { topLine: string; hook: string; lines: ScriptLine[]; hooks: Hook[]; loopLine: string | null; /** Fase C: 3 title variants (keyword, curiosity, challenge/number). */ titles?: string[] };
/** Fase C: Milan sent the previous version back with a comment; the new version changes only what he asks. */
export type ScriptFeedback = { note: string; previous: { hook: string; topLine: string | null; lines: ScriptLine[] } };

/**
 * Placeholder script for recordings labelled as test data, so the chain can be tested without a paid service.
 * Real scripts come from the AI and must be built on what happens in the footage (research 6.5: no template text).
 */
export function testScript(plan: EditPlan, moments: Moment[]): ScriptDraft {
  const main = moments[0];
  const kind = main ? KIND_LABEL[main.kind].toUpperCase() : "MOMENT";
  return {
    topLine: `[TEST] ${kind}`.slice(0, 60),
    hook: `[TESTDATA] Hook for ${kind.toLowerCase()} — the real hook comes from the analysis service.`,
    lines: plan.segments.map((s) => ({ at_ms: s.out_start_ms, text: `[TESTDATA] ${s.part}: ${s.note}` })),
    // Three placeholder variants so the hook choice can be tested for free; clearly marked as test data.
    hooks: [
      { type: "challenge", first_line: "[TESTDATA] Hook 1: uitdaging", overlay: "[TEST] HOOK 1", cold_open: false },
      { type: "cold_open", first_line: "[TESTDATA] Hook 2: hoogtepunt eerst", overlay: "[TEST] HOOK 2", cold_open: true },
      { type: "curiosity_gap", first_line: "[TESTDATA] Hook 3: nieuwsgierigheid", overlay: "[TEST] HOOK 3", cold_open: false },
    ],
    loopLine: "[TESTDATA] Slotzin die aansluit op het begin",
    titles: ["[TEST] Minecraft maar het is een test", "[TEST] Wat gebeurt er hier?", "[TEST] 3 testmomenten in 1 video"],
  };
}

/** Instructions for the analysis service (Gemini, after approval). The answer must be JSON that parseAnalysis accepts. */
export function analysisPrompt(durationMs: number, chunk?: Chunk): string {
  const clipMs = chunk ? chunk.endMs - chunk.startMs : durationMs;
  return [
    "You analyse raw Minecraft (PS5, Bedrock) survival gameplay for a faceless YouTube channel.",
    chunk && chunk.count > 1
      ? `This clip is part ${chunk.index + 1} of ${chunk.count} of a longer recording and is ${formatTimecode(clipMs)} long. Give every time as "MM:SS" counted from the start of THIS clip (00:00), never from the whole recording.`
      : `The recording is ${formatTimecode(clipMs)} long. Give every time as "MM:SS" counted from the start (00:00).`,
    "Times must point at what is really on screen at that second; check each one against the picture before you answer. Report every usable moment.",
    `Kinds: ${MOMENT_KINDS.join(", ")}. Look especially for low health, mobs, falls or lava, rare blocks or items, and finished builds.`,
    "Only report moments a viewer would find exciting or surprising. Routine actions (sleeping, walking, crafting, building) are not moments unless something unexpected happens.",
    "start is where the build-up starts (usually 10-20 seconds before the peak), end is where the outcome is clearly visible (at least 3 seconds after the peak). peak is the single most intense instant and lies before end.",
    "PvP fights against other players count too (near_death or escape); report each fight once, not every hit. Never write real names or gamertags in reason or notes: say \"the opponent\".",
    "For each moment give: kind, start, peak, end (all \"MM:SS\"), reason (what happens on screen, one sentence), score 0-100,",
    "has_context (is it clear what is going on before the peak?) with context_note, has_payoff (is the outcome visible?) with payoff_note,",
    `privacy_flags (any of ${PRIVACY_FLAGS.join(", ")} that is visible or audible), suggested_format (A near-death Short, B rare-find Short, C long story).`,
    "Only describe what is visible or audible. Do not invent story elements. Answer with JSON only: {\"moments\": [...]}",
  ].join("\n");
}

/** Estimated cost of analysing a recording, in whole euro cents, rounded up. Default: 35 cents per hour (research chapter 9, high resolution). */
export function estimateAnalysisCents(durationMs: number, centsPerHour = 35): number {
  return Math.max(1, Math.ceil((durationMs / 3_600_000) * centsPerHour));
}

/** Moments for a recording labelled as test data: fixed positions, no AI, no costs. Clearly marked TESTDATA. */
export function testMoments(durationMs: number): Moment[] {
  const at = (f: number) => Math.round(durationMs * f);
  const raw = [
    { kind: "near_death", start_ms: at(0.1), end_ms: at(0.6), peak_ms: at(0.45), reason: "TESTDATA: vaste positie, geen echte analyse", score: 70, has_context: true, has_payoff: true },
    { kind: "rare_find", start_ms: at(0.55), end_ms: at(0.95), peak_ms: at(0.75), reason: "TESTDATA: vaste positie, geen echte analyse", score: 60, has_context: true, has_payoff: true },
  ];
  return parseAnalysis({ moments: raw }, durationMs).moments;
}

/** What a recording must show before a format is possible (research chapter 5, "benodigde beeldmomenten"). */
export const FOOTAGE_NEEDED: Record<Format, string> = {
  A: "Bijna-dood-moment: zichtbaar lage gezondheid of een dreiging (mob, lava, val), de actie en een duidelijke afloop, binnen ongeveer een minuut doorlopend beeld.",
  B: "Zeldzame vondst: het zoeken (mijnen, verkennen), het moment van de vondst en wat hij ermee doet.",
  C: "Survival-verhaal: minstens 8 minuten beeld met 3 bruikbare momenten, liefst met een duidelijk begin en een eindresultaat.",
};

/** Formats the planned videos of a recording do not cover yet, so the dashboard can say which gameplay is needed. */
export function missingFormats(plannedFormats: Format[]): Format[] {
  return (["A", "B", "C"] as const).filter((f) => !plannedFormats.includes(f));
}

/** Recordings longer than this are refused for analysis (context limit of Flash-Lite at low resolution, with margin). */
export const MAX_ANALYSIS_MS = 2 * 3_600_000;

const FORMAT_RULES: Record<Format, string> = {
  A: "Format A, near-death Short (vertical, 30-45 s). No intro: the first words are the threat. Build tension, show the outcome, end abruptly so the Short loops.",
  B: "Format B, rare-find Short (vertical, 30-45 s). Open with a teaser of the find, race through the search, reveal the find, then what he does with it.",
  C: "Format C, long survival story (horizontal). Cold open with the most exciting moment, then name the goal(s) before 30 s, then tell it from the beginning (\"It all started...\"), one short chapter per moment. Give the first payoff before 0:45, end every chapter with a re-hook (\"But then...\"), and end with a teaser for the next episode.",
};

/**
 * The narrator's voice (14-11-2026, Milan): the viewers are kids, so the voice-over is an excited gaming buddy, not a
 * calm documentary voice. The excitement is about what really happens on screen; nothing is invented.
 */
export const NARRATOR_VOICE = [
  "Audience: kids who love Minecraft (about 8-12 years old). Narrate like their most excited gaming buddy: high energy, warm and friendly, real reactions to what happens.",
  "Use short punchy sentences, simple words and exclamation marks where the action is; talk to the viewer (\"Look at that!\", \"Watch out!\", \"No way!\"), and let the energy rise toward every payoff.",
  "Vary the rhythm: a quick burst in the action, one short quieter line before a big moment, then the reaction. Never flat, never sarcastic, never mean, no swearing, nothing gory; no fake hype about things that are not on screen.",
];

/** Shorts live or die in the first seconds: what the first line, the overlay and the first second must do. */
export const SHORT_OPENING = [
  "The first 2 seconds decide whether a kid keeps watching. The very first spoken words start at 0 ms and are the threat or the find itself, as an exclamation (for example \"Three creepers. One heart!\").",
  "Never open with a greeting, \"in this video\", \"today\", \"so\", a question about the viewer's day, or any setup: the first line is at most 7 words and can be said in under 2 seconds.",
  "Every hook's first_line follows this rule too, and its overlay is at most 4 words. Put the strongest hook first.",
];

/** Instructions for the script writer. Every story element must come from the moments (research 6.5: no template text). */
/** For one part of a story told in parts: what the part before ended with and what the next part starts with. */
export type SeriesContext = { part: SeriesPart; previous: Moment[]; next: Moment[] };

function seriesRules(s: SeriesContext): string[] {
  const n = s.part.index + 1;
  const say = (ms: Moment[]) => ms.map((m) => `${KIND_LABEL[m.kind]}: ${m.reason}`).join(" ");
  return [
    `This video is part ${n} of ${s.part.count} of ONE continuous survival story. Together the parts tell the whole recording from beginning to end; this part covers ${formatTimecode(s.part.startMs)}-${formatTimecode(s.part.endMs)} of it. Narrate everything in this part, also the calmer travel in between the moments.`,
    n > 1 && s.previous.length
      ? `Right after the cold open, recap part ${n - 1} in one or two sentences ("In part ${n - 1}..."). Part ${n - 1} ended with: ${say(s.previous)}`
      : n > 1
        ? `Right after the cold open, say in one sentence that this continues from part ${n - 1}.`
        : `This is the first part: no recap, start the story at the beginning.`,
    n < s.part.count
      ? `End with a teaser for part ${n + 1} instead of a generic one${s.next.length ? `; it starts with: ${say(s.next)}` : ""}. Do not reveal how it ends.`
      : `This is the last part: finish the story (show how it ends) and invite viewers who missed it to start at part 1.`,
    `Every title ends with " (Part ${n})".`,
  ];
}

export function scriptPrompt(format: Format, promise: string | null, moments: Moment[], plan: EditPlan, language: "en" | "nl", feedback?: ScriptFeedback, series?: SeriesContext): string {
  return [
    `You write narration for a faceless Minecraft (PS5, Bedrock) YouTube channel, in ${language === "en" ? "English" : "Dutch"}.`,
    FORMAT_RULES[format],
    ...NARRATOR_VOICE,
    ...(format === "C" ? [] : SHORT_OPENING),
    ...(series ? seriesRules(series) : []),
    promise ? `Viewer promise: ${promise}` : "",
    "What happens on screen (from the analysis; use only this, invent nothing, never mention real names, gamertags or the player's age):",
    ...moments.map((m) => `- ${formatTimecode(m.startMs)}-${formatTimecode(m.endMs)} ${m.kind}: ${m.reason}${m.payoffNote ? ` Outcome: ${m.payoffNote}` : ""}`),
    `Edit plan of the final video (${formatTimecode(plan.targetMs)} long):`,
    ...plan.segments.map((s) => `- at ${s.out_start_ms} ms: ${s.part} (${s.note})`),
    "Work hook-first: first decide the payoff (the strongest moment that is really visible), then the opening. No intro, no greeting, no calm establishing line: the first second shows action or the promise of the payoff, and the payoff must really come.",
    "Write: top_line (fixed text at the top of a Short, at most 6 words, capitals). It must name the concrete threat or find of THIS moment (for example how many mobs, how many hearts, which item);",
    "never a generic phrase such as 'survives or dies' that would fit any video. Then hook (the first sentence, at most 15 words, also specific to this moment).",
    `Then hooks: exactly 3 alternative openings of DIFFERENT types from: ${HOOK_TYPES.join(", ")}. Each: {"type", "first_line" (at most 10 words, about what is on screen in the first second), "overlay" (at most 6 words, capitals, specific), "cold_open" (true when the video should open with a 1.5 s glimpse of the payoff)}.`,
    "Then loop_line: one short last sentence that leads straight back into the first second, so viewers watch again. For videos longer than 30 s, put a second small hook or open question halfway in the lines.",
    `And lines: narration as [{"at_ms": number, "text": string}] on the timeline of the final video, between 0 and ${plan.targetMs} ms, about 2.5 words per second, short sentences.`,
    "Then titles: exactly 3 YouTube titles of at most 70 characters, each a different kind: 1) keyword first (starts with \"Minecraft\", for search), 2) curiosity (makes viewers want to know what happens), 3) challenge or number (for example \"3 creepers, 1 heart\"). Title, thumbnail and first 30 seconds make the same promise; no clickbait that the video does not deliver, no real names.",
    ...(feedback
      ? [
          `The owner sent the previous version back with this comment: "${feedback.note.replace(/"/g, "'")}". Change only what the comment asks; keep everything else as it was.`,
          `Previous version: top_line "${feedback.previous.topLine ?? ""}", hook "${feedback.previous.hook}", lines ${JSON.stringify(feedback.previous.lines)}`,
        ]
      : []),
    'Answer with JSON only: {"top_line": "...", "hook": "...", "hooks": [...], "loop_line": "...", "lines": [...], "titles": ["...", "...", "..."]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Checks the script the service returns; lines outside the video are dropped, the rest is sorted. */
export function parseScript(raw: unknown, targetMs: number): { draft: ScriptDraft; dropped: number } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "geen object" };
  const r = raw as Record<string, unknown>;
  const hook = text(r.hook, 300);
  if (!hook) return { error: "hook ontbreekt" };
  const topLine = text(r.top_line, 60) ?? "";
  if (!Array.isArray(r.lines)) return { error: "scriptregels ontbreken" };
  const lines: ScriptLine[] = [];
  for (const l of r.lines as unknown[]) {
    const item = l && typeof l === "object" ? (l as Record<string, unknown>) : null;
    const at = item ? int(item.at_ms) : null;
    const t = item ? text(item.text, 400) : null;
    if (at !== null && t && at >= 0 && at <= targetMs) lines.push({ at_ms: at, text: t });
  }
  if (!lines.length) return { error: "geen bruikbare scriptregels" };
  lines.sort((a, b) => a.at_ms - b.at_ms);
  const titles = Array.isArray(r.titles) ? (r.titles as unknown[]).map((t) => text(t, 100)?.replace(/[<>]/g, "")).filter((t): t is string => !!t).slice(0, 3) : [];
  return { draft: { topLine, hook, lines, hooks: parseHooks(r.hooks), loopLine: text(r.loop_line, 200), titles }, dropped: (r.lines as unknown[]).length - lines.length };
}

/** 83_400 -> "1:23"; 3_725_000 -> "1:02:05". */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

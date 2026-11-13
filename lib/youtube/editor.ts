// Fase C3: the editor. The montage plan (segments with timecodes) and the narration are data; every edit makes a new
// state, and saving makes a new script version (source "manual"). Nothing is overwritten (2.2, chapter 5 and 16).
import type { ScriptLine, Segment } from "./analysis.ts";

export type EditorState = { topLine: string; lines: ScriptLine[]; segments: Segment[] };

export const MIN_SEGMENT_MS = 300;
export const ZOOM = "zoom";

const round = (n: number) => Math.round(n);

/** Puts the segments one after the other again: each starts where the previous one ends (at its own speed). */
export function relayout(segments: Segment[]): Segment[] {
  let out = 0;
  return segments.map((s) => {
    const next = { ...s, out_start_ms: out };
    out += round((s.src_end_ms - s.src_start_ms) / s.speed);
    return next;
  });
}

export const totalMs = (segments: Segment[]) => segments.reduce((sum, s) => sum + round((s.src_end_ms - s.src_start_ms) / s.speed), 0);

const update = (state: EditorState, segments: Segment[]): EditorState => ({ ...state, segments: relayout(segments) });

export function trimSegment(state: EditorState, i: number, srcStart: number, srcEnd: number): EditorState {
  return update(state, state.segments.map((s, k) => (k === i ? { ...s, src_start_ms: round(srcStart), src_end_ms: round(srcEnd) } : s)));
}

export function removeSegment(state: EditorState, i: number): EditorState {
  return update(state, state.segments.filter((_, k) => k !== i));
}

export function moveSegment(state: EditorState, i: number, dir: -1 | 1): EditorState {
  const j = i + dir;
  if (j < 0 || j >= state.segments.length) return state;
  const list = [...state.segments];
  [list[i], list[j]] = [list[j], list[i]];
  return update(state, list);
}

/** Splits a segment at a point in the final video (ms from its own start), in two pieces with the same settings. */
export function splitSegment(state: EditorState, i: number, outOffsetMs: number): EditorState {
  const s = state.segments[i];
  if (!s) return state;
  const at = round(s.src_start_ms + outOffsetMs * s.speed);
  if (at - s.src_start_ms < MIN_SEGMENT_MS || s.src_end_ms - at < MIN_SEGMENT_MS) return state;
  const first = { ...s, src_end_ms: at };
  const second = { ...s, src_start_ms: at, text: undefined, note: `${s.note} (vervolg)`.trim() };
  return update(state, [...state.segments.slice(0, i), first, second, ...state.segments.slice(i + 1)]);
}

export function setSpeed(state: EditorState, i: number, speed: number): EditorState {
  const v = Math.min(2, Math.max(0.5, Math.round(speed * 100) / 100));
  return update(state, state.segments.map((s, k) => (k === i ? { ...s, speed: v } : s)));
}

export function toggleZoom(state: EditorState, i: number): EditorState {
  return update(
    state,
    state.segments.map((s, k) => (k !== i ? s : { ...s, effects: s.effects.includes(ZOOM) ? s.effects.filter((e) => e !== ZOOM) : [...s.effects, ZOOM] })),
  );
}

export function setSegmentText(state: EditorState, i: number, text: string): EditorState {
  const t = text.slice(0, 60);
  return update(state, state.segments.map((s, k) => (k === i ? { ...s, text: t.trim() ? t : undefined } : s)));
}

export function setLine(state: EditorState, j: number, line: Partial<ScriptLine>): EditorState {
  const lines = state.lines.map((l, k) => (k === j ? { at_ms: round(line.at_ms ?? l.at_ms), text: (line.text ?? l.text).slice(0, 400) } : l));
  return { ...state, lines: [...lines].sort((a, b) => a.at_ms - b.at_ms) };
}

export function addLine(state: EditorState, atMs: number): EditorState {
  return { ...state, lines: [...state.lines, { at_ms: round(atMs), text: "" }].sort((a, b) => a.at_ms - b.at_ms) };
}

export function removeLine(state: EditorState, j: number): EditorState {
  return { ...state, lines: state.lines.filter((_, k) => k !== j) };
}

/** What still has to be fixed before saving; an empty list means the version can be saved. */
export function editorProblems(state: EditorState, recordingMs: number | null): string[] {
  const problems: string[] = [];
  if (!state.segments.length) problems.push("Er is geen enkel fragment over.");
  state.segments.forEach((s, i) => {
    if (s.src_end_ms - s.src_start_ms < MIN_SEGMENT_MS) problems.push(`Fragment ${i + 1} is korter dan 0,3 s.`);
    if (s.src_start_ms < 0 || (recordingMs !== null && s.src_end_ms > recordingMs)) problems.push(`Fragment ${i + 1} valt buiten de opname.`);
  });
  const end = totalMs(state.segments);
  if (state.lines.some((l) => !l.text.trim())) problems.push("Een tekstregel is leeg.");
  if (state.lines.some((l) => l.at_ms < 0 || l.at_ms >= end)) problems.push("Een tekstregel valt buiten de video.");
  if (state.topLine.length > 60) problems.push("De tekst bovenin is langer dan 60 tekens.");
  return problems;
}

/** Undo and redo: a simple history of states, at most 100 steps back. */
export type History = { past: EditorState[]; present: EditorState; future: EditorState[] };
export const startHistory = (s: EditorState): History => ({ past: [], present: s, future: [] });
export const commit = (h: History, next: EditorState): History => (next === h.present ? h : { past: [...h.past, h.present].slice(-100), present: next, future: [] });
export const undo = (h: History): History => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
export const redo = (h: History): History => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);

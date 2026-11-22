// 23-11-2026 (Milan): feedback on a moment of a montage, and what the next version does with it. Two ways:
// - "gericht" (targeted): the same moments and script; only what Milan pointed at changes in the timeline (crop of the
//   piece at that moment, more time after the peak, other or no music). Never an identical re-render: no fix, no job.
// - "volledig" (full): a new script version; with "verkeerde clip" or "zwakke opening" the worker picks another moment
//   from the recording.
// The old version, its timeline and the feedback stay (render rows, script versions, job payloads). Pure, tested.
import type { Segment } from "./analysis";

export const FEEDBACK_KINDS = ["clip", "opening", "payoff", "crop", "timing", "voice", "captions", "music", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_LABEL: Record<FeedbackKind, string> = {
  clip: "Verkeerde clip",
  opening: "Zwakke opening",
  payoff: "Payoff ontbreekt",
  crop: "Slechte crop",
  timing: "Timing",
  voice: "Voice-over",
  captions: "Captions",
  music: "Muziek",
  other: "Overig",
};
export type FeedbackItem = { atMs: number; kind: FeedbackKind; text: string; side?: "left" | "right"; music?: "other" | "none" };
export type RemountMode = "gericht" | "volledig";
export type Fixes = { crop?: { atMs: number; side: "left" | "right" }[]; payoffExtraMs?: number; music?: "other" | "none" };

/** How far the vertical crop moves to a side (−1 = left edge of the picture, 1 = right edge). */
export const CROP_SHIFT = 0.8;
/** "Payoff ontbreekt": this much more footage after the peak (on top of the planned outcome). */
export const PAYOFF_EXTRA_MS = 2500;

/** "rechts uit beeld" → right; "links" → left; else the side Milan picked, else nothing. */
export function sideOf(item: FeedbackItem): "left" | "right" | null {
  if (item.side) return item.side;
  if (/\brechts|right\b/i.test(item.text)) return "right";
  if (/\blinks|left\b/i.test(item.text)) return "left";
  return null;
}

/** Feedback that asks for another moment: a targeted fix cannot solve that. */
export const needsNewMoment = (items: FeedbackItem[]) => items.some((i) => i.kind === "clip" || i.kind === "opening");

/** The timeline fixes a targeted correction makes from Milan's feedback. */
export function fixesFrom(items: FeedbackItem[]): Fixes {
  const out: Fixes = {};
  const crop = items.filter((i) => i.kind === "crop").map((i) => ({ atMs: i.atMs, side: sideOf(i) })).filter((c): c is { atMs: number; side: "left" | "right" } => !!c.side);
  if (crop.length) out.crop = crop;
  if (items.some((i) => i.kind === "payoff")) out.payoffExtraMs = PAYOFF_EXTRA_MS;
  const music = items.find((i) => i.kind === "music");
  if (music) out.music = music.music ?? (/\b(geen|uit|zonder|none|off)\b/i.test(music.text) ? "none" : "other");
  return out;
}

/** What a targeted correction will do, in Dutch, or why it cannot (then a full montage is needed). */
export function plannedChanges(items: FeedbackItem[], fixes: Fixes): { changes: string[]; unsupported: string[] } {
  const changes: string[] = [];
  for (const c of fixes.crop ?? []) changes.push(`Uitsnede bij ${clock(c.atMs)} naar ${c.side === "right" ? "rechts" : "links"}`);
  if (fixes.payoffExtraMs) changes.push(`${(fixes.payoffExtraMs / 1000).toFixed(1)} s langer na het hoogtepunt`);
  if (fixes.music) changes.push(fixes.music === "none" ? "Zonder muziek" : "Andere muziek");
  const unsupported = items
    .filter((i) => (i.kind === "crop" && !sideOf(i)) || ["clip", "opening", "timing", "voice", "captions", "other"].includes(i.kind))
    .map((i) => (i.kind === "crop" ? `Slechte crop bij ${clock(i.atMs)}: kies links of rechts` : `${FEEDBACK_LABEL[i.kind]} bij ${clock(i.atMs)}`));
  return { changes, unsupported };
}

export const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** Where a piece of the montage starts and ends in the video (ms). */
const outRange = (s: Segment) => ({ a: s.out_start_ms, b: s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / (s.speed || 1)) });

/**
 * The timeline of the next version. Crop: the piece playing at that moment moves to the side, and so does the piece next
 * to it when the moment is within 0.8 s of the cut (the subject crosses the cut). Payoff: the last piece runs on.
 */
export function applyFixes<T extends { segments: Segment[]; targetMs: number }>(cut: T, fixes: Fixes | null | undefined, recordingMs: number): { cut: T; changes: string[] } {
  if (!fixes) return { cut, changes: [] };
  const segments = cut.segments.map((s) => ({ ...s }));
  const changes: string[] = [];
  for (const c of fixes.crop ?? []) {
    const x = c.side === "right" ? CROP_SHIFT : -CROP_SHIFT;
    segments.forEach((s, k) => {
      const { a, b } = outRange(s);
      if ((c.atMs >= a && c.atMs < b) || Math.abs(c.atMs - a) <= 800 || Math.abs(c.atMs - b) <= 800) {
        segments[k] = { ...s, crop_x: x };
        changes.push(`stuk ${k + 1} (${clock(a)}–${clock(b)}): uitsnede ${c.side === "right" ? "rechts" : "links"}`);
      }
    });
  }
  let targetMs = cut.targetMs;
  if (fixes.payoffExtraMs && segments.length) {
    const last = segments[segments.length - 1];
    const end = Math.min(recordingMs, last.src_end_ms + fixes.payoffExtraMs);
    if (end > last.src_end_ms) {
      targetMs += Math.round((end - last.src_end_ms) / (last.speed || 1));
      changes.push(`laatste stuk ${((end - last.src_end_ms) / 1000).toFixed(1)} s langer (uitkomst)`);
      segments[segments.length - 1] = { ...last, src_end_ms: end };
    }
  }
  if (fixes.music) changes.push(fixes.music === "none" ? "muziek uit" : "andere muziek");
  return { cut: { ...cut, segments, targetMs }, changes: [...new Set(changes)] };
}

/** One key per feedback, so a double click, a refresh or a retry never makes a second job. */
export function feedbackKey(scriptId: string, items: FeedbackItem[], mode: RemountMode): string {
  const text = JSON.stringify([mode, items.map((i) => [i.atMs, i.kind, i.text.trim(), i.side ?? "", i.music ?? ""])]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return `render:${scriptId}:fb:${h.toString(36)}`;
}

/** Milan's feedback as one short note (the video keeps it as its review note, max 500 characters). */
export function feedbackNote(items: FeedbackItem[], version: number | null): string {
  const head = version ? `v${version}: ` : "";
  return (head + items.map((i) => `${clock(i.atMs)} ${FEEDBACK_LABEL[i.kind].toLowerCase()}${i.text.trim() ? `: ${i.text.trim()}` : ""}`).join(" · ")).slice(0, 500);
}

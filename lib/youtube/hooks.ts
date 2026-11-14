// Fase C2: hook-first productie (2.2, chapter 24.2). The AI first picks the payoff, then writes three hook variants of
// different types; Milan chooses one in the review. The chosen hook decides the first second of the montage.
import type { ScriptLine, Segment } from "./analysis";

export const HOOK_TYPES = ["curiosity_gap", "pattern_break", "bold_claim", "cold_open", "challenge", "relatable"] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export const HOOK_TYPE_LABEL: Record<HookType, string> = {
  curiosity_gap: "Nieuwsgierigheid",
  pattern_break: "Patroondoorbreking",
  bold_claim: "Stellige bewering",
  cold_open: "Cold open (hoogtepunt eerst)",
  challenge: "Uitdaging of inzet",
  relatable: "Herkenbaar scenario",
};

/** One hook variant: the first spoken sentence, the text at the top, and whether the video opens on the climax. */
export type Hook = { type: HookType; first_line: string; overlay: string; cold_open: boolean };

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

/** Checks the hook variants the AI returns; keeps at most three valid ones. */
export function parseHooks(raw: unknown): Hook[] {
  if (!Array.isArray(raw)) return [];
  const out: Hook[] = [];
  for (const h of raw) {
    const r = h && typeof h === "object" ? (h as Record<string, unknown>) : null;
    const type = r && HOOK_TYPES.includes(r.type as HookType) ? (r.type as HookType) : null;
    const first = r ? text(r.first_line, 120) : null;
    const overlay = r ? text(r.overlay, 60) : null;
    if (type && first && overlay) out.push({ type, first_line: first, overlay: overlay.toUpperCase(), cold_open: r?.cold_open === true || type === "cold_open" });
    if (out.length === 3) break;
  }
  return out;
}

/** How long a cold open shows the climax before the video continues with the build-up. */
export const COLD_OPEN_MS = 1500;

/**
 * The montage for a chosen hook: its text at the top, its first sentence at 0 ms, the loop line just before the end,
 * and with a cold open a short glimpse of the climax first. Pure: the stored script itself never changes.
 */
export function applyHook(
  script: { top_line: string | null; hook: string; lines: ScriptLine[]; edit_plan: Segment[]; target_ms: number; loop_line?: string | null },
  hook: Hook | null,
  peakMs: number | null,
): { topLine: string | null; hook: string; lines: ScriptLine[]; segments: Segment[]; targetMs: number } {
  if (!hook) return { topLine: script.top_line, hook: script.hook, lines: script.lines, segments: script.edit_plan, targetMs: script.target_ms };
  const shift = hook.cold_open && peakMs !== null ? COLD_OPEN_MS : 0;
  const segments: Segment[] = shift
    ? [
        { part: "cold_open", src_start_ms: peakMs!, src_end_ms: peakMs! + COLD_OPEN_MS, out_start_ms: 0, speed: 1, effects: ["top_line", "zoom"], note: "Cold open: een flits van het hoogtepunt" },
        ...script.edit_plan.map((s) => ({ ...s, out_start_ms: s.out_start_ms + shift })),
      ]
    : script.edit_plan;
  const targetMs = script.target_ms + shift;
  // The chosen first sentence replaces whatever the script said in the first 1.5 seconds.
  const body = script.lines.filter((l) => l.at_ms >= 1500).map((l) => ({ ...l, at_ms: l.at_ms + shift }));
  const lines: ScriptLine[] = [{ at_ms: 0, text: hook.first_line }, ...body];
  if (script.loop_line && targetMs > 6000) {
    const at = targetMs - 2500;
    while (lines.length > 1 && lines[lines.length - 1].at_ms >= at - 1200) lines.pop();
    lines.push({ at_ms: at, text: script.loop_line });
  }
  return { topLine: hook.overlay, hook: hook.first_line, lines, segments, targetMs };
}

/** A Short opening that wastes the first seconds: a greeting or setup, or too long to say in about 2 seconds. */
export function weakOpening(line: string): string | null {
  const t = line.trim().toLowerCase();
  if (/^(hey|hi|hello|yo|welcome|what'?s up|today|so[ ,]|in this (video|short)|let'?s|did you know|have you ever)/.test(t)) return "begint met een begroeting of aanloop";
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words > 9) return `${words} woorden: te lang voor de eerste 2 seconden`;
  return null;
}

/** For a Short the first hook is chosen by default: strong openings first, weak ones after (order kept otherwise). */
export function rankShortHooks(hooks: Hook[]): Hook[] {
  return [...hooks.filter((h) => !weakOpening(h.first_line)), ...hooks.filter((h) => weakOpening(h.first_line))];
}

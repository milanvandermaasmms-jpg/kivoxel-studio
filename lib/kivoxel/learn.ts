// KIVOXEL fase 1, section 8 ("kwaliteit vastleggen"): every script Milan approves is an example. The free engine
// learns from them: their lines join the template pools (with double weight), so the style he likes comes back
// without AI. Only lines that fit any video are taken: no mobs, items, numbers or names of one particular video.
import { hookFile, looksDutch, type EventType } from "./config.ts";
import { hookType } from "./hookText.ts";

export type Learned = {
  anticipation: Partial<Record<EventType, string[]>>;
  reaction_bad: string[];
  reaction_good: string[];
  open_loop: string[];
  loop: string[];
  /** How many approved scripts it came from. */
  from: number;
};

export const EMPTY_LEARNED: Learned = { anticipation: {}, reaction_bad: [], reaction_good: [], open_loop: [], loop: [], from: 0 };

/** Words that tie a line to one particular video (and would be false in another one). */
const SPECIFIC = /\b(creeper|zombie|skeleton|spider|enderman|witch|slime|blaze|ghast|piglin|warden|dragon|wither|villager|golem|lava|tnt|diamond|iron|gold|emerald|netherite|nether|end|portal|cave|chest|house|base|bed|sword|pickaxe|bow|elytra|night|day|watcher|diary|sign|\d+)\b/i;

/** A line from an approved script that could fit another video of the same kind. */
export function genericLine(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 14 && !SPECIFIC.test(t) && !looksDutch(t);
}

type ApprovedLine = { text?: unknown; kind?: unknown };
export type ApprovedScript = { top_line: string | null; lines: unknown };

/** Sorts the lines of approved scripts into the free engine's pools. Newest scripts first; at most `perPool` per pool. */
export function learnFrom(scripts: ApprovedScript[], perPool = 24): Learned {
  const out: Learned = { anticipation: {}, reaction_bad: [], reaction_good: [], open_loop: [], loop: [], from: 0 };
  const add = (list: string[], text: string) => {
    if (list.length < perPool && !list.some((x) => x.toLowerCase() === text.toLowerCase())) list.push(text);
  };
  for (const s of scripts) {
    if (!Array.isArray(s.lines)) continue;
    const type = s.top_line ? hookType(s.top_line, hookFile) : null;
    let used = false;
    for (const l of s.lines as ApprovedLine[]) {
      if (typeof l?.text !== "string" || typeof l.kind !== "string" || !genericLine(l.text)) continue;
      const text = l.text.trim();
      if (l.kind === "anticipation" && type) add((out.anticipation[type] ??= []), text);
      else if (l.kind === "reaction") add(type === "geluk" || type === "bouw" ? out.reaction_good : out.reaction_bad, text);
      else if (l.kind === "open_loop") add(out.open_loop, text);
      else if (l.kind === "loop") add(out.loop, text);
      else continue;
      used = true;
    }
    if (used) out.from++;
  }
  return out;
}

/** The template pool plus the learned lines, each learned line twice (Milan approved it: more likely to be picked). */
export const withLearned = (pool: string[], learned: string[] | undefined) => (learned?.length ? [...pool, ...learned, ...learned] : pool);

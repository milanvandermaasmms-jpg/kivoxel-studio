// KIVOXEL fase 1, section 5: the hook text at the top of a Short. 2-4 words, CAPITALS, big, inside the Shorts safe
// zone, chosen from the library for the REAL event type (no clickbait), never more than once per 10 Shorts.
// Animation: pop-in with a scale bounce in the first 0.3 s, a short shake at the payoff.
import { HEADER, assColour } from "./brand.ts";
import { hookFile, words, type EventType, type HookFile, type Settings } from "./config.ts";
import { assText, assTime, type Size } from "../youtube/render.ts";

const norm = (h: string) => h.trim().toUpperCase();

/**
 * The hook for one Short. `recent` = the hooks of the latest Shorts, newest last.
 * A hook used in the last `noRepeatWithin` Shorts is skipped; if all are, the one used longest ago wins.
 */
export function chooseHook(type: EventType, recent: string[], rnd: () => number, noRepeatWithin = 10, file: HookFile = hookFile, isDeath = false): { hook: string; repeated: boolean } {
  const deathOnly = (file.death_only ?? []).map(norm);
  // "GAME OVER" on a Short where nobody dies is clickbait: those hooks only for a real death.
  const options = file.hooks[type].filter((h) => isDeath || !deathOnly.includes(norm(h)));
  const window = recent.slice(-noRepeatWithin).map(norm);
  const fresh = options.filter((h) => !window.includes(norm(h)));
  if (fresh.length) return { hook: fresh[Math.floor(rnd() * fresh.length)], repeated: false };
  const lastUse = (h: string) => window.lastIndexOf(norm(h));
  return { hook: [...options].sort((a, b) => lastUse(a) - lastUse(b))[0], repeated: true };
}

/** The type of a hook text, by looking it up in the library (null = not from the library, e.g. typed by Milan). */
export function hookType(hook: string, file: HookFile = hookFile): EventType | null {
  for (const [t, list] of Object.entries(file.hooks) as [EventType, string[]][]) if (list.some((h) => norm(h) === norm(hook))) return t;
  return null;
}

/** Libass on Windows has no colour emoji: they would show as empty boxes, so the picture gets the hook without them. */
export const stripEmoji = (text: string) => text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

export type HookCheck = { key: string; label: string; ok: boolean; value: string; note: string };

/** Section 9: hook <= 4 words, fits the event type, not recently used, inside the safe zone. */
export function hookChecks(hook: string, eventType: EventType | null, recent: string[], settings: Settings, isDeath = false): HookCheck[] {
  const n = words(hook).length;
  const t = hookType(hook);
  const fakeDeath = !isDeath && (hookFile.death_only ?? []).map(norm).includes(norm(hook));
  const window = recent.slice(-settings.hooks.no_repeat_within).map(norm);
  const layout = hookLayout({ width: settings.shorts.width, height: settings.shorts.height }, settings);
  return [
    { key: "hook_words", label: "Hook 2-4 woorden", ok: n >= settings.hooks.min_words && n <= settings.hooks.max_words, value: `${n} woorden`, note: hook },
    { key: "hook_type", label: "Hook past bij het event", ok: (!eventType || !t || t === eventType) && !fakeDeath, value: t ?? "eigen tekst", note: fakeDeath ? "zegt dat hij doodgaat, maar dat gebeurt niet" : eventType ? `event: ${eventType}` : "geen event bekend" },
    { key: "hook_fresh", label: "Hook niet recent gebruikt", ok: !window.includes(norm(hook)), value: window.includes(norm(hook)) ? "herhaald" : "nieuw", note: `laatste ${settings.hooks.no_repeat_within} Shorts` },
    { key: "hook_safe", label: "Hook binnen de safe zone", ok: layout.top >= settings.shorts.safe_zone.top_px && layout.right >= settings.shorts.safe_zone.right_px, value: `${layout.top} px van boven`, note: "niet onder de knoppen van YouTube" },
  ];
}

/** Where the hook sits: top centre, below the Shorts top bar, away from the buttons on the right. */
export function hookLayout(size: Size, settings: Settings) {
  const z = settings.shorts.safe_zone;
  // Big: about 6% of the height (115 px on 1920); a 4-word hook wraps to two lines inside the safe zone.
  const fontSize = Math.round(size.height * 0.06);
  return { x: Math.round((size.width + z.left_px - z.right_px) / 2), top: z.top_px, left: z.left_px, right: z.right_px, fontSize };
}

/** ASS style line for the animated hook: the brand yellow and font of the thumbnail header. */
export function hookStyle(size: Size, settings: Settings): string {
  const l = hookLayout(size, settings);
  const c = assColour(HEADER.color_hex);
  return `Style: Hook,${HEADER.font.family},${l.fontSize},${c},${c},${assColour(HEADER.outline_hex)},${assColour(HEADER.shadow_hex, HEADER.shadow_alpha)},-1,0,0,0,100,100,0,0,1,7,3,8,${l.left},${l.right},${l.top},1`;
}

/**
 * The hook as ASS events: pop-in (small -> 115% -> 100% in `pop_in_ms`), then still, a shake of ~0.4 s at the payoff,
 * and still again until the end.
 */
export function hookEvents(text: string, durationMs: number, peakMs: number | null, size: Size, settings: Settings): string[] {
  const t = assText(stripEmoji(text).toUpperCase());
  if (!t) return [];
  const { x, top } = hookLayout(size, settings);
  const pop = settings.hooks.pop_in_ms;
  const at = (dx: number, dy: number) => `\\an8\\pos(${x + dx},${top + dy})`;
  const line = (start: number, end: number, tags: string) => (end > start ? [`Dialogue: 3,${assTime(start)},${assTime(end)},Hook,,0,0,0,,{${tags}}${t}`] : []);
  const out: string[] = [];
  const shake = settings.hooks.shake_on_payoff && peakMs !== null && peakMs > pop && peakMs < durationMs - 100;
  const firstEnd = shake ? peakMs! : durationMs;
  out.push(...line(0, firstEnd, `${at(0, 0)}\\fscx30\\fscy30\\t(0,${Math.round(pop * 0.6)},\\fscx115\\fscy115)\\t(${Math.round(pop * 0.6)},${pop},\\fscx100\\fscy100)`));
  if (shake) {
    const jolts: [number, number][] = [[-14, 6], [12, -7], [-10, 5], [9, -4], [-6, 3], [4, -2], [-2, 1], [0, 0]];
    let s = peakMs!;
    for (const [dx, dy] of jolts) {
      const e = Math.min(durationMs, s + 50);
      out.push(...line(s, e, `${at(dx, dy)}\\fscx108\\fscy108`));
      s = e;
    }
    out.push(...line(s, durationMs, at(0, 0)));
  }
  return out;
}

// Publication screen (fase D2): metadata for YouTube with the limits from the official documentation (12-11-2026,
// docs/youtube-koppeling.md). Saving a draft only writes to the database; uploading comes in D3 and is always a click.
import type { Hook } from "./hooks";

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX = 500;
/** YouTube ignores all hashtags of a video with more than 60; 2.2 chapter 24.9 asks for 3 to 5. */
export const HASHTAGS_ADVICE = 5;
/** Category "Gaming" in the YouTube category list. */
export const GAMING_CATEGORY = "20";

export type Visibility = "private" | "unlisted" | "public";
export const VISIBILITY_LABEL: Record<Visibility, string> = { private: "Privé", unlisted: "Niet vermeld (alleen met link)", public: "Openbaar" };

export type PublicationDraft = {
  title: string;
  description: string;
  tags: string[];
  category_id: string;
  language: "en" | "nl";
  /** null until Milan chooses himself (never a default). */
  made_for_kids: boolean | null;
  contains_synthetic_media: boolean | null;
  visibility: Visibility;
  /** ISO time for scheduling (only with visibility private); null = no schedule. */
  publish_at: string | null;
};

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** How YouTube counts the tag limit: the commas between tags count, and a tag with a space gets quotes (+2). */
export function tagsLength(tags: string[]): number {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  return clean.reduce((sum, t) => sum + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, clean.length - 1);
}

/** "minecraft, hardcore , creeper" -> ["minecraft", "hardcore", "creeper"], without doubles. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim().replace(/\s+/g, " ").replace(/^#/, "");
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

export const hashtags = (text: string) => text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;

/** Problems that block saving (the database refuses these too). */
export function draftProblems(d: PublicationDraft): string[] {
  const p: string[] = [];
  if (d.title.length > TITLE_MAX) p.push(`De titel is ${d.title.length} tekens; YouTube staat hoogstens ${TITLE_MAX} toe.`);
  if (/[<>]/.test(d.title)) p.push("De titel mag geen < of > bevatten.");
  if (utf8Bytes(d.description) > DESCRIPTION_MAX_BYTES) p.push(`De beschrijving is ${utf8Bytes(d.description)} bytes; YouTube staat hoogstens ${DESCRIPTION_MAX_BYTES} toe.`);
  if (/[<>]/.test(d.description)) p.push("De beschrijving mag geen < of > bevatten.");
  if (tagsLength(d.tags) > TAGS_MAX) p.push(`De tags zijn samen ${tagsLength(d.tags)} tekens; YouTube staat hoogstens ${TAGS_MAX} toe.`);
  if (d.tags.some((t) => /[<>]/.test(t))) p.push("Een tag mag geen < of > bevatten.");
  if (d.publish_at && d.visibility !== "private") p.push("Inplannen kan alleen met zichtbaarheid Privé: YouTube zet de video zelf openbaar op het gekozen moment.");
  return p;
}

/** Everything that must be right before an upload may start (D3 uses this; the screen shows it now). */
export function uploadProblems(d: PublicationDraft, now = Date.now()): string[] {
  const p = draftProblems(d);
  if (!d.title.trim()) p.push("Vul een titel in.");
  if (d.made_for_kids === null) p.push("Kies zelf of de video voor kinderen gemaakt is (verplicht bij YouTube).");
  if (d.contains_synthetic_media === null) p.push("Kies zelf of de video realistische AI-inhoud bevat.");
  if (d.publish_at) {
    const t = Date.parse(d.publish_at);
    if (!Number.isFinite(t)) p.push("Het publicatiemoment is ongeldig.");
    else if (t < now + 15 * 60_000) p.push("Plan minstens een kwartier vooruit, zodat YouTube de video eerst kan verwerken.");
  }
  return p;
}

/** Advice that does not block (2.2 chapter 24.9). */
export function draftAdvice(d: PublicationDraft, kind: "short" | "long"): string[] {
  const a: string[] = [];
  const n = hashtags(d.description);
  if (n > HASHTAGS_ADVICE) a.push(`${n} hashtags in de beschrijving; 3 tot 5 werkt beter (geen hashtag-spam).`);
  if (d.title.trim() && !/minecraft/i.test(d.title)) a.push("Zet het belangrijkste trefwoord (Minecraft) vooraan in de titel.");
  if (kind === "short" && d.title.length > 60) a.push("Op een telefoon is een Short-titel na ongeveer 60 tekens afgekapt.");
  return a;
}

/**
 * Starting points made from the chosen hook (no AI and nothing invented): Milan adapts them.
 * Formula 24.9: game + what happens + optional context, keyword first.
 */
export function titleSuggestions(hook: Pick<Hook, "first_line" | "overlay"> | null): string[] {
  if (!hook) return [];
  const line = hook.first_line.replace(/[<>]/g, "").trim().replace(/[.!]+$/, "");
  const overlay = hook.overlay.replace(/[<>]/g, "").trim();
  const capital = overlay ? overlay.charAt(0) + overlay.slice(1).toLowerCase() : "";
  const out = [line && `Minecraft: ${line}`, capital && `Minecraft: ${capital}`, line && capital && `${capital} in Minecraft (${line})`];
  return [...new Set(out.filter((t): t is string => !!t).map((t) => t.slice(0, TITLE_MAX)))];
}

export function descriptionSuggestion(hook: Pick<Hook, "first_line"> | null, kind: "short" | "long"): string {
  const tags = ["#minecraft", "#gaming", ...(kind === "short" ? ["#shorts"] : [])].join(" ");
  return [hook?.first_line.replace(/[<>]/g, "").trim(), tags].filter(Boolean).join("\n\n");
}

export const EMPTY_DRAFT = (language: "en" | "nl"): PublicationDraft => ({
  title: "",
  description: "",
  tags: [],
  category_id: GAMING_CATEGORY,
  language,
  made_for_kids: null,
  contains_synthetic_media: null,
  visibility: "private",
  publish_at: null,
});

// ---- Times in Europe/Amsterdam for <input type="datetime-local"> ----

function offsetMs(utc: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utc))
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utc;
}

/** "2026-11-20T18:30" in Amsterdam -> ISO in UTC. null for an empty or wrong value. */
export function amsterdamToIso(local: string, timeZone = "Europe/Amsterdam"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - offsetMs(guess, timeZone);
  utc = guess - offsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}

/** ISO -> "2026-11-20T18:30" in Amsterdam, for the input field. */
export function isoToAmsterdam(iso: string | null, timeZone = "Europe/Amsterdam"): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + offsetMs(t, timeZone)).toISOString().slice(0, 16);
}

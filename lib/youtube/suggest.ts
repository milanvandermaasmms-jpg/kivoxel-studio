// AI suggestions for the publication screen (fase 1.6): 10-15 tags, 3 titles and a description. Shared by the worker
// (prompt and parsing) and the dashboard (types and merging). Pure functions, so the rules are tested without Gemini.
// No browser imports here: the worker loads this file too.

export const TAG_MIN = 10;
export const TAG_MAX = 15;
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 4500;

export type SuggestInput = {
  language: "en" | "nl";
  kind: "short" | "long";
  channel: { name: string; audience?: string | null } | null;
  title: string;
  description: string;
  /** Narration of the approved script (the voice-over), in order. */
  narration: string[];
  hook: string | null;
  /** Tags Milan used before on this channel, most used first (the Studio learns from this in fase 2). */
  usedTags: string[];
  /** Words that may never appear (private words, banned words of the channel). */
  forbidden: string[];
  /** Fase 2: tags Milan keeps leaving out or removing, and titles he picked before (his style). */
  dislikedTags?: string[];
  likedTitles?: string[];
};

export type Suggestions = { tags: string[]; titles: string[]; description: string; source: "ai" | "test" };

const clean = (s: string) => s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

export function suggestPrompt(i: SuggestInput): string {
  const lang = i.language === "en" ? "English" : "Dutch";
  return [
    `You help a faceless Minecraft (PS5, Bedrock) YouTube channel${i.channel ? ` called "${i.channel.name}"` : ""} publish a ${i.kind === "short" ? "YouTube Short" : "long video (8-15 minutes)"}.`,
    i.channel?.audience ? `Audience: ${i.channel.audience}.` : "",
    `Write everything in ${lang}.`,
    `Current title: ${i.title || "(none yet)"}`,
    `Current description: ${i.description || "(none yet)"}`,
    i.hook ? `Hook (first seconds): ${i.hook}` : "",
    i.narration.length ? `Voice-over transcript:\n${i.narration.join("\n").slice(0, 3000)}` : "",
    i.usedTags.length ? `Tags the creator used on earlier videos (reuse the ones that fit): ${i.usedTags.slice(0, 30).join(", ")}` : "",
    i.dislikedTags?.length ? `The creator keeps removing these tags, so do not suggest them: ${i.dislikedTags.slice(0, 30).join(", ")}` : "",
    i.likedTitles?.length ? `Titles the creator picked before (match this style, do not copy them): ${i.likedTitles.map((t) => `"${t}"`).join("; ")}` : "",
    `Give ${TAG_MIN} to ${TAG_MAX} YouTube tags: specific first (what happens in this video), then broader (minecraft, game mode), lowercase, no hashtags, no duplicates, together under 450 characters.`,
    "Give exactly 3 titles of at most 70 characters, each a different kind: 1) keyword first (starts with \"Minecraft\"), 2) curiosity, 3) challenge or number. Only promise what the video really shows; no clickbait.",
    `Give a description of 2 to 4 short sentences that matches the video, then a blank line and 3 to 5 hashtags${i.kind === "short" ? " including #shorts" : ""}.`,
    "Never use real names, gamertags or personal data.",
    i.forbidden.length ? `Never use these words: ${i.forbidden.join(", ")}.` : "",
    'Answer with JSON only: {"tags": ["..."], "titles": ["...", "...", "..."], "description": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
}

const hasForbidden = (text: string, forbidden: string[]) => forbidden.some((w) => w.trim() && text.toLowerCase().includes(w.trim().toLowerCase()));

/** Checks the answer of Gemini: cleans, removes doubles and forbidden words, and keeps YouTube's limits. */
export function parseSuggestions(raw: unknown, forbidden: string[] = [], disliked: string[] = []): Suggestions | { error: string } {
  const avoid = new Set(disliked.map((t) => t.toLowerCase()));
  if (!raw || typeof raw !== "object") return { error: "geen JSON-object" };
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const tags: string[] = [];
  let length = 0;
  for (const t of Array.isArray(r.tags) ? r.tags : []) {
    if (typeof t !== "string") continue;
    const tag = clean(t).replace(/^#/, "").toLowerCase().slice(0, 60);
    if (!tag || seen.has(tag) || avoid.has(tag) || hasForbidden(tag, forbidden)) continue;
    const cost = tag.length + (/\s/.test(tag) ? 2 : 0) + (tags.length ? 1 : 0);
    if (length + cost > 450 || tags.length >= TAG_MAX) break;
    seen.add(tag);
    tags.push(tag);
    length += cost;
  }
  const titles = (Array.isArray(r.titles) ? r.titles : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => clean(t).slice(0, TITLE_LIMIT))
    .filter((t) => t && !hasForbidden(t, forbidden))
    .slice(0, 3);
  const description = typeof r.description === "string" && !hasForbidden(r.description, forbidden) ? r.description.replace(/[<>]/g, "").trim().slice(0, DESCRIPTION_LIMIT) : "";
  if (tags.length === 0 && titles.length === 0 && !description) return { error: "geen bruikbare tags, titels of beschrijving" };
  return { tags, titles, description, source: "ai" };
}

/** Test videos never cost money: fixed suggestions, clearly marked. */
export function testSuggestions(i: Pick<SuggestInput, "kind">): Suggestions {
  return {
    tags: ["test", "minecraft", "minecraft survival", "minecraft bedrock", "ps5", "gaming", "creeper", "minecraft moments", "minecraft funny", "minecraft shorts"].slice(0, i.kind === "short" ? 10 : 9),
    titles: ["[TEST] Minecraft: testtitel met zoekwoord", "[TEST] Wat gebeurt hier?", "[TEST] 3 momenten, 1 test"],
    description: `[TEST] Dit is een testbeschrijving.\n\n#minecraft #gaming${i.kind === "short" ? " #shorts" : ""}`,
    source: "test",
  };
}

/** Result of a finished suggest step as the dashboard reads it from yt_jobs.result. */
export function readSuggestions(result: unknown): Suggestions | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.tags) || !Array.isArray(r.titles)) return null;
  return {
    tags: r.tags.filter((t): t is string => typeof t === "string"),
    titles: r.titles.filter((t): t is string => typeof t === "string"),
    description: typeof r.description === "string" ? r.description : "",
    source: r.source === "test" ? "test" : "ai",
  };
}

/** Adds a tag to the list unless it is already there (case does not matter). */
export function addTag(tags: string[], tag: string): string[] {
  const t = clean(tag).replace(/^#/, "");
  if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return tags;
  return [...tags, t];
}

export const removeTag = (tags: string[], tag: string) => tags.filter((x) => x.toLowerCase() !== tag.toLowerCase());

/** What Milan types in the tag field: commas separate tags, and so does a space before a # ("minecraft #gaming" is two tags). */
export const splitTagInput = (value: string) => value.split(/,|\s+(?=#)/);

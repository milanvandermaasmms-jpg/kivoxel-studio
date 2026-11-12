// Fase C4: repetition check (2.2, chapter 24.8). A new video is compared with the last videos of the channel on top
// line (title idea), hook and narration. YouTube looks at the channel as a whole; too much sameness is a monetisation
// risk. Thresholds are starting values (DECISIONS.md). No AI and no cost: plain word comparison.

const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "on", "is", "it", "my", "his", "with", "for", "this", "that", "at", "de", "het", "een", "en", "van", "op", "in", "is"]);

/** Lower case words without punctuation and filler words. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[test(data)?\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Share of overlap between two word sets (Jaccard, 0-1). Two empty texts count as not similar. */
export function similarity(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export type ScriptText = { videoId: string; label: string; topLine: string | null; hook: string; narration: string };
export type Repetition = { videoId: string; label: string; field: "titel" | "hook" | "script"; share: number };

const LIMIT = { titel: 0.6, hook: 0.6, script: 0.5 } as const;

/** Which earlier videos look too much like this one, most similar first. */
export function repetitions(current: ScriptText, earlier: ScriptText[], max = 20): Repetition[] {
  const found: Repetition[] = [];
  for (const e of earlier.filter((x) => x.videoId !== current.videoId).slice(0, max)) {
    const checks: [Repetition["field"], number][] = [
      ["titel", similarity(current.topLine ?? "", e.topLine ?? "")],
      ["hook", similarity(current.hook, e.hook)],
      ["script", similarity(current.narration, e.narration)],
    ];
    for (const [field, share] of checks) if (share >= LIMIT[field]) found.push({ videoId: e.videoId, label: e.label, field, share });
  }
  return found.sort((a, b) => b.share - a.share);
}

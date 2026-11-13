// Viral-check (fase 3): a scorecard per montage on three parts (stem, voice-over/script, gameplay/montage), each 1-10
// with what goes well and 2-3 concrete fixes with timestamps. Rules on measured facts plus one Gemini judgement that
// listens to the voice-over. It is a prediction, never a guarantee. Pure functions (shared by worker and dashboard).
import type { ScriptLine, Segment } from "./analysis.ts";
import type { DeadSpan, Peak } from "./footage.ts";
import { relayout } from "./editor.ts";

/** src: for a cut, the part of the RECORDING to leave out (output times move when the hook changes the opening). */
export type Fix = { fromMs: number | null; toMs: number | null; text: string; auto?: "rewrite" | "cut"; src?: [number, number] };
export type Part = { score: number; good: string[]; fixes: Fix[] };
export type PartKey = "voice" | "script" | "gameplay";
export type ViralResult = {
  version: 1;
  overall: number;
  parts: Record<PartKey, Part>;
  /** What the reference videos in the niche do, for comparison (null when none were fetched yet). */
  reference: ReferenceSummary | null;
  /** Measured facts, kept so the Studio can learn later which ones matter on this channel. */
  features: Features;
};
export const PART_LABEL: Record<PartKey, string> = { voice: "Stemkeuze", script: "Voice-over en script", gameplay: "Gameplay en montage" };

export type Features = {
  kind: "short" | "long";
  durationMs: number;
  firstLineMs: number | null;
  hookWords: number;
  wordsPerSecond: number;
  longestSilenceMs: number;
  deadShare: number;
  cutsPerMinute: number;
  hasCta: boolean;
  voiceSameAsBefore: boolean | null;
  aiEnergy: number | null;
};

export type ViralInput = {
  kind: "short" | "long";
  language: "en" | "nl";
  audience: string | null;
  hook: string;
  lines: ScriptLine[];
  loopLine: string | null;
  segments: Segment[];
  durationMs: number;
  width: number;
  height: number;
  voiceName: string | null;
  speakingRate: number | null;
  /** Voices of earlier montages on this channel, newest first. */
  previousVoices: string[];
  /** Dead parts and loud peaks of the recording (FFmpeg signals); null when not measured. */
  dead: DeadSpan[] | null;
  peaks: Peak[] | null;
};

export type ReferenceVideo = { youtube_video_id?: string; title: string; tags: string[]; duration_s: number | null; is_short: boolean; published_at: string | null; views: number; ratio: number | null; hook: string | null };
export type ReferenceSummary = { count: number; medianTitleChars: number | null; medianDurationS: number | null; bestHours: number[]; topWords: string[]; examples: { title: string; views: number }[] };

// ---- Small helpers ----
const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(n * 10) / 10));
const nl1 = (n: number) => n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
export const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const segEnd = (s: Segment) => s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / s.speed);
const CTA = /\b(subscribe|abonneer|volg|follow|like|comment|reageer|laat (het )?weten|tell me|let me know)\b/i;

/** What the narration says in order, with the hook first when no line opens the video. */
export function spoken(hook: string, lines: ScriptLine[]): ScriptLine[] {
  const sorted = [...lines].sort((a, b) => a.at_ms - b.at_ms);
  return sorted.length && sorted[0].at_ms < 1500 ? sorted : hook.trim() ? [{ at_ms: 0, text: hook.trim() }, ...sorted] : sorted;
}

/** Parts of the montage (output time) that show dead footage (AFK, menu, black) of the recording. */
export function deadInOutput(segments: Segment[], dead: DeadSpan[]): { fromMs: number; toMs: number; kind: string; src: [number, number] }[] {
  const out: { fromMs: number; toMs: number; kind: string; src: [number, number] }[] = [];
  for (const s of segments) {
    for (const d of dead) {
      const a = Math.max(s.src_start_ms, d.startMs);
      const b = Math.min(s.src_end_ms, d.endMs);
      if (b - a < 1500) continue;
      out.push({ fromMs: s.out_start_ms + Math.round((a - s.src_start_ms) / s.speed), toMs: s.out_start_ms + Math.round((b - s.src_start_ms) / s.speed), kind: d.kind, src: [a, b] });
    }
  }
  return out.sort((x, y) => x.fromMs - y.fromMs);
}

// ---- The three parts on rules ----

export function scriptPart(i: ViralInput): { part: Part; f: Pick<Features, "firstLineMs" | "hookWords" | "wordsPerSecond" | "longestSilenceMs" | "hasCta"> } {
  const said = spoken(i.hook, i.lines);
  const good: string[] = [];
  const fixes: Fix[] = [];
  let score = 10;
  const first = said[0] ?? null;
  const hookWords = first ? words(first.text).length : 0;
  if (!first || first.at_ms > 1000) {
    score -= 3;
    fixes.push({ fromMs: 0, toMs: 3000, text: "In de eerste 3 seconden wordt niets gezegd. Begin meteen met de hook.", auto: "rewrite" });
  } else if (hookWords > 14) {
    score -= 2;
    fixes.push({ fromMs: 0, toMs: 3000, text: `De hook is ${hookWords} woorden: te lang voor 3 seconden. Maak hem korter (8-12 woorden) met één belofte.`, auto: "rewrite" });
  } else good.push(`Sterke start: de hook (${hookWords} woorden) valt binnen de eerste seconde.`);

  const totalWords = said.reduce((n, l) => n + words(l.text).length, 0);
  const wps = i.durationMs ? totalWords / (i.durationMs / 1000) : 0;
  const [lo, hi] = i.kind === "short" ? [1.8, 3.2] : [1.2, 2.8];
  if (wps < lo) {
    score -= 1.5;
    fixes.push({ fromMs: null, toMs: null, text: `Weinig tekst (${nl1(wps)} woorden per seconde). Vul de stille stukken met spanning of uitleg.`, auto: "rewrite" });
  } else if (wps > hi) {
    score -= 1.5;
    fixes.push({ fromMs: null, toMs: null, text: `Erg veel tekst (${nl1(wps)} woorden per seconde): kijkers kunnen het beeld niet volgen. Schrap bijzinnen.`, auto: "rewrite" });
  } else good.push(`Goed tempo: ${nl1(wps)} woorden per seconde.`);

  // Longest stretch without narration (between line starts, and after the last line).
  const marks = [...said.map((l) => l.at_ms), i.durationMs];
  let longest = { ms: 0, at: 0 };
  for (let k = 1; k < marks.length; k++) if (marks[k] - marks[k - 1] > longest.ms) longest = { ms: marks[k] - marks[k - 1], at: marks[k - 1] };
  const maxGap = i.kind === "short" ? 7000 : 20_000;
  if (longest.ms > maxGap) {
    score -= 1.5;
    fixes.push({ fromMs: longest.at, toMs: longest.at + longest.ms, text: `Lang stuk met maar één zin voice-over (${Math.round(longest.ms / 1000)} s). Voeg een zin toe die spanning opbouwt.`, auto: "rewrite" });
  }

  // Repetition: the same opening word in a row, or a sentence that is said twice.
  const texts = said.map((l) => l.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim());
  const doubles = texts.filter((t, k) => t && texts.indexOf(t) !== k).length;
  const sameStart = said.filter((l, k) => k > 0 && words(l.text)[0]?.toLowerCase() === words(said[k - 1].text)[0]?.toLowerCase()).length;
  if (doubles || sameStart >= 3) {
    score -= 1;
    fixes.push({ fromMs: null, toMs: null, text: doubles ? "Een zin wordt twee keer gezegd. Haal de herhaling weg." : "Veel zinnen beginnen met hetzelfde woord. Wissel af.", auto: "rewrite" });
  }

  const tail = said.filter((l) => l.at_ms >= i.durationMs * 0.75);
  const hasCta = tail.some((l) => CTA.test(l.text)) || (i.kind === "short" && !!i.loopLine);
  if (hasCta) good.push(i.kind === "short" && i.loopLine ? "Slotzin loopt terug naar het begin (goed voor herhaald kijken)." : "Duidelijke afsluiting met een oproep.");
  else if (i.kind === "long") {
    score -= 1;
    fixes.push({ fromMs: Math.round(i.durationMs * 0.85), toMs: i.durationMs, text: "Geen oproep aan het eind. Vraag kijkers te reageren of te abonneren.", auto: "rewrite" });
  }

  const late = said.filter((l) => l.at_ms > i.durationMs - 500);
  if (late.length) {
    score -= 1;
    fixes.push({ fromMs: late[0].at_ms, toMs: i.durationMs, text: "Er staat tekst na het einde van het beeld: die valt weg.", auto: "rewrite" });
  }
  return { part: { score: clamp(score), good, fixes: fixes.slice(0, 3) }, f: { firstLineMs: first?.at_ms ?? null, hookWords, wordsPerSecond: Math.round(wps * 100) / 100, longestSilenceMs: longest.ms, hasCta } };
}

export function gameplayPart(i: ViralInput, reference: ReferenceSummary | null): { part: Part; f: Pick<Features, "deadShare" | "cutsPerMinute"> } {
  const good: string[] = [];
  const fixes: Fix[] = [];
  let score = 10;
  const deadParts = i.dead ? deadInOutput(i.segments, i.dead) : [];
  const deadMs = deadParts.reduce((n, d) => n + d.toMs - d.fromMs, 0);
  if (i.dead === null) good.push("Saaie stukken niet gemeten (geen FFmpeg-meting van de opname).");
  else if (!deadParts.length) good.push("Geen stilstaande of lege stukken in de montage.");
  for (const d of deadParts.slice(0, 2)) {
    score -= 1.5;
    fixes.push({ fromMs: d.fromMs, toMs: d.toMs, text: `Hier gebeurt niets (${d.kind === "black" ? "zwart beeld" : d.kind === "afk" ? "speler staat stil" : "stilstaand beeld"}). Inkorten.`, auto: "cut", src: d.src });
  }

  // A segment that runs long without a peak feels slow.
  const maxSeg = i.kind === "short" ? 8000 : 30_000;
  const slow = i.segments.filter((s) => segEnd(s) - s.out_start_ms > maxSeg && !(i.peaks ?? []).some((p) => p.atMs >= s.src_start_ms && p.atMs <= s.src_end_ms));
  if (slow.length && fixes.length < 3) {
    score -= 1;
    const s = slow[0];
    // Keep the first and last part of the long stretch; the middle goes.
    const keep = (maxSeg / 2) * s.speed;
    fixes.push({ fromMs: s.out_start_ms, toMs: segEnd(s), text: `Lang stuk zonder actie (${Math.round((segEnd(s) - s.out_start_ms) / 1000)} s). Knip het korter of versnel het.`, auto: "cut", src: [Math.round(s.src_start_ms + keep), Math.round(s.src_end_ms - keep)] });
  }
  const minutes = i.durationMs / 60_000;
  const cpm = minutes ? i.segments.length / minutes : 0;
  if (i.kind === "short" && cpm < 4 && fixes.length < 3) {
    score -= 1;
    fixes.push({ fromMs: null, toMs: null, text: `Weinig wissels in beeld (${nl1(cpm)} per minuut). Shorts houden kijkers vast met een wissel elke 5-10 seconden.` });
  } else if (cpm >= 4 || i.kind === "long") good.push(`${i.segments.length} delen in beeld (${nl1(cpm)} per minuut).`);

  if (i.kind === "short") {
    if (i.height <= i.width) {
      score -= 3;
      fixes.unshift({ fromMs: null, toMs: null, text: "Deze Short is niet verticaal. Maak hem 9:16." });
    } else good.push("Verticaal beeld (9:16), geschikt voor Shorts.");
    if (i.durationMs > 60_000 && fixes.length < 3) {
      score -= 1;
      fixes.push({ fromMs: 60_000, toMs: i.durationMs, text: "Langer dan 60 seconden: korte Shorts worden vaker uitgekeken." });
    }
  }
  if (reference?.medianDurationS && fixes.length < 3) {
    const ratio = i.durationMs / 1000 / reference.medianDurationS;
    if (ratio > 1.6) {
      score -= 0.5;
      fixes.push({ fromMs: null, toMs: null, text: `Veel langer dan wat nu goed loopt in je niche (meestal ${mmss(reference.medianDurationS * 1000)}).` });
    }
  }
  const peak = (i.peaks ?? []).map((p) => ({ p, s: i.segments.find((s) => p.atMs >= s.src_start_ms && p.atMs <= s.src_end_ms) })).find((x) => x.s);
  if (peak?.s) good.push(`Thumbnail-moment: rond ${mmss(peak.s.out_start_ms + Math.round((peak.p.atMs - peak.s.src_start_ms) / peak.s.speed))} (hoogtepunt in geluid).`);
  return { part: { score: clamp(score), good, fixes: fixes.slice(0, 3) }, f: { deadShare: i.durationMs ? Math.round((deadMs / i.durationMs) * 100) / 100 : 0, cutsPerMinute: Math.round(cpm * 10) / 10 } };
}

export function voicePart(i: ViralInput): { part: Part; f: Pick<Features, "voiceSameAsBefore"> } {
  const good: string[] = [];
  const fixes: Fix[] = [];
  let score = 10;
  if (!i.voiceName) return { part: { score: 3, good: [], fixes: [{ fromMs: null, toMs: null, text: "Deze montage heeft geen stem. Zet Google TTS aan in worker/.env.local." }] }, f: { voiceSameAsBefore: null } };
  const lang = i.voiceName.slice(0, 2).toLowerCase();
  if (lang !== i.language) {
    score -= 4;
    fixes.push({ fromMs: null, toMs: null, text: `De stem is ${lang === "nl" ? "Nederlands" : "Engels"}, maar de video is ${i.language === "nl" ? "Nederlands" : "Engels"}. Kies een stem in dezelfde taal.` });
  } else good.push("Stem in de taal van de video.");
  const same = i.previousVoices.length ? i.previousVoices[0] === i.voiceName : null;
  if (same === false) {
    score -= 1;
    fixes.push({ fromMs: null, toMs: null, text: `Andere stem dan je vorige video (${i.previousVoices[0].replace(/^.*-HD-/, "")}). Een vaste stem maakt het kanaal herkenbaar.` });
  } else if (same) good.push("Dezelfde stem als je vorige video's: herkenbaar.");
  if (i.speakingRate !== null) {
    if (i.speakingRate < 1.0) {
      score -= 1;
      fixes.push({ fromMs: null, toMs: null, text: `Spreektempo ${i.speakingRate.toLocaleString("nl-NL")}× is rustig voor gaming. Probeer 1,1-1,2×.` });
    } else if (i.speakingRate > 1.3) {
      score -= 1;
      fixes.push({ fromMs: null, toMs: null, text: `Spreektempo ${i.speakingRate.toLocaleString("nl-NL")}× is erg snel. Probeer 1,1-1,2×.` });
    } else good.push(`Spreektempo ${i.speakingRate.toLocaleString("nl-NL")}× past bij gaming.`);
  }
  return { part: { score: clamp(score), good, fixes: fixes.slice(0, 3) }, f: { voiceSameAsBefore: same } };
}

// ---- Gemini: listens to the voice-over and reads the script ----

export function listenPrompt(i: ViralInput, rules: Record<PartKey, Part>): string {
  const said = spoken(i.hook, i.lines);
  return [
    `You review a ${i.kind === "short" ? "YouTube Short" : "long YouTube video"} of a faceless Minecraft channel before it is published. The attached audio is the AI voice-over with the game sound.`,
    i.audience ? `Audience: ${i.audience}.` : "",
    `Language of the video: ${i.language === "nl" ? "Dutch" : "English"}.`,
    "Script with timestamps (mm:ss):",
    ...said.map((l) => `${mmss(l.at_ms)} ${l.text}`),
    `Measured already: ${Object.entries(rules).map(([k, p]) => `${k} ${p.score}/10`).join(", ")}.`,
    "Listen and judge three things, each with a score 1-10, at most 2 strengths and at most 3 concrete fixes with a time range when it applies:",
    "1) voice: does the voice fit the audience and channel (energy, age group, clarity, natural or robotic)?",
    "2) script: is there a strong hook in the first 3 seconds, tension, pacing, pauses, repetition, a call to action, and does the speech fit what happens?",
    "3) gameplay: from the audio and script only, do parts sound boring or too long?",
    "Also give energy 1-10 for the voice. Write strengths and fixes in Dutch, short and concrete (for example \"0:12-0:25 te traag, inkorten\").",
    'Answer with JSON only: {"energy": 7, "voice": {"score": 7, "good": ["..."], "fixes": [{"from": "0:12", "to": "0:25", "text": "..."}]}, "script": {...}, "gameplay": {...}}',
  ]
    .filter(Boolean)
    .join("\n");
}

const parseMmss = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null;
};
const textOf = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[<>]/g, "").trim().slice(0, max) : "");

export type ListenResult = { energy: number | null; parts: Partial<Record<PartKey, Part>> };

export function parseListen(raw: unknown, durationMs: number): ListenResult | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "geen JSON-object" };
  const r = raw as Record<string, unknown>;
  const parts: Partial<Record<PartKey, Part>> = {};
  for (const key of ["voice", "script", "gameplay"] as PartKey[]) {
    const p = r[key] as Record<string, unknown> | undefined;
    const score = Number(p?.score);
    if (!p || !Number.isFinite(score)) continue;
    const fixes: Fix[] = (Array.isArray(p.fixes) ? p.fixes : [])
      .map((f) => {
        const x = (f ?? {}) as Record<string, unknown>;
        const from = parseMmss(x.from);
        const to = parseMmss(x.to);
        return { fromMs: from !== null && from <= durationMs ? from : null, toMs: to !== null && to <= durationMs + 1000 ? to : null, text: textOf(x.text, 200), ...(key === "script" ? { auto: "rewrite" as const } : {}) };
      })
      .filter((f) => f.text)
      .slice(0, 3);
    parts[key] = { score: clamp(score), good: (Array.isArray(p.good) ? p.good : []).map((g) => textOf(g, 200)).filter(Boolean).slice(0, 2), fixes };
  }
  if (!Object.keys(parts).length) return { error: "geen bruikbare beoordeling" };
  const energy = Number(r.energy);
  return { energy: Number.isFinite(energy) ? clamp(energy) : null, parts };
}

/** Rules and the listening judgement together: the average score, the strengths of both, and at most 3 fixes. */
function merge(rule: Part, ai: Part | undefined): Part {
  if (!ai) return rule;
  const fixes = [...rule.fixes];
  for (const f of ai.fixes) if (fixes.length < 3 && !fixes.some((x) => x.fromMs !== null && x.fromMs === f.fromMs)) fixes.push(f);
  return { score: clamp((rule.score + ai.score) / 2), good: [...new Set([...rule.good, ...ai.good])].slice(0, 4), fixes: fixes.slice(0, 3) };
}

export function buildViral(i: ViralInput, listen: ListenResult | null, reference: ReferenceSummary | null): ViralResult {
  const s = scriptPart(i);
  const g = gameplayPart(i, reference);
  const v = voicePart(i);
  const parts: Record<PartKey, Part> = { voice: merge(v.part, listen?.parts.voice), script: merge(s.part, listen?.parts.script), gameplay: merge(g.part, listen?.parts.gameplay) };
  // The opening decides most: script weighs a little more than the other two.
  const overall = clamp((parts.voice.score + parts.script.score * 1.5 + parts.gameplay.score) / 3.5);
  return { version: 1, overall, parts, reference, features: { kind: i.kind, durationMs: i.durationMs, ...s.f, ...g.f, ...v.f, aiEnergy: listen?.energy ?? null } };
}

/** Test videos never cost money: a fixed, clearly marked judgement instead of Gemini. */
export const testListen = (): ListenResult => ({ energy: 7, parts: { voice: { score: 7, good: ["[TEST] Vaste testbeoordeling, geen AI."], fixes: [] } } });

/** The FFmpeg arguments for a small mono audio file of the voice-over, for the listening check. */
export const listenAudioArgs = (input: string, output: string) => ["-hide_banner", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", output];

// ---- Reference videos (YouTube Data API) ----

export function summarizeReference(videos: ReferenceVideo[], kind: "short" | "long"): ReferenceSummary | null {
  // The same video can be found by two search terms: count it once.
  const seen = new Set<string>();
  const own = videos.filter((v) => v.is_short === (kind === "short") && !seen.has(v.youtube_video_id ?? v.title) && !!seen.add(v.youtube_video_id ?? v.title));
  if (own.length < 3) return null;
  const hours = new Map<number, number>();
  for (const v of own) if (v.published_at) {
    const h = Number(new Date(v.published_at).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }));
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  const stop = new Set(["the", "a", "in", "i", "of", "to", "and", "my", "is", "de", "het", "een", "en", "ik", "van", "minecraft", "shorts", "#shorts", "with", "for", "this", "on", "it"]);
  const counts = new Map<string, number>();
  for (const v of own) for (const w of new Set(words(v.title.toLowerCase().replace(/[^\p{L}\p{N}# ]/gu, " ")))) if (w.length > 2 && !stop.has(w) && !/^#(minecraft|shorts?|fyp|viral)/.test(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return {
    count: own.length,
    medianTitleChars: median(own.map((v) => v.title.length)),
    medianDurationS: median(own.map((v) => v.duration_s).filter((d): d is number => d !== null)),
    bestHours: [...hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h),
    topWords: [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w),
    examples: [...own].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 3).map((v) => ({ title: v.title, views: v.views })),
  };
}

/** Default search terms per channel language when Milan set none. */
export const defaultQueries = (language: "en" | "nl") => (language === "nl" ? ["minecraft nederlands", "minecraft shorts nederlands"] : ["minecraft survival", "minecraft shorts"]);

/** "PT1M5S" -> 65. */
export function isoSeconds(d: string | undefined): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
}

/** The first sentence of a description: the closest thing to a hook the API gives for someone else's video. */
export const firstSentence = (text: string) => text.replace(/https?:\/\/\S+/g, "").split(/(?<=[.!?])\s|\n/)[0]?.trim().slice(0, 300) || null;

// ---- Automatisch verbeteren ----

/**
 * Leaves the given parts of the recording out of the montage plan. Segments are trimmed or split, everything after a
 * cut moves forward, and narration lines move with the picture (a line inside a cut moves to the cut).
 */
export function cutPlan(segments: Segment[], lines: ScriptLine[], cuts: [number, number][]): { segments: Segment[]; lines: ScriptLine[]; removedMs: number } {
  let segs = [...segments];
  for (const [a, b] of cuts) {
    if (b - a < 300) continue;
    segs = segs.flatMap((s) => {
      if (b <= s.src_start_ms || a >= s.src_end_ms) return [s];
      const parts: Segment[] = [];
      if (a - s.src_start_ms >= 300) parts.push({ ...s, src_end_ms: a });
      if (s.src_end_ms - b >= 300) parts.push({ ...s, src_start_ms: b, effects: s.effects.filter((e) => e !== "zoom") });
      return parts;
    });
  }
  const next = relayout(segs);
  // Map an output time of the old plan to the new plan through the recording time.
  const toNew = (outMs: number): number => {
    const old = segments.find((s) => outMs >= s.out_start_ms && outMs < segEnd(s)) ?? segments[segments.length - 1];
    if (!old) return outMs;
    const src = old.src_start_ms + (outMs - old.out_start_ms) * old.speed;
    const hit = next.find((s) => src >= s.src_start_ms && src < s.src_end_ms);
    if (hit) return hit.out_start_ms + Math.round((src - hit.src_start_ms) / hit.speed);
    // Inside a cut: the first segment that starts after this moment in the recording.
    const after = next.filter((s) => s.src_start_ms >= src).sort((x, y) => x.out_start_ms - y.out_start_ms)[0];
    return after ? after.out_start_ms : next.length ? segEnd(next[next.length - 1]) : 0;
  };
  const total = (xs: Segment[]) => (xs.length ? segEnd(xs[xs.length - 1]) : 0);
  const moved = lines.map((l) => ({ ...l, at_ms: toNew(l.at_ms) })).filter((l, k, all) => l.at_ms < total(next) && !(k > 0 && all[k - 1].at_ms === l.at_ms && all[k - 1].text === l.text));
  return { segments: next, lines: moved, removedMs: total(segments) - total(next) };
}

/** The note for "Script laten herschrijven": the script fixes of the Viral-check, in Milan's own words for the AI. */
export function rewriteNote(r: ViralResult): string {
  const fixes = r.parts.script.fixes.filter((f) => f.auto === "rewrite").map((f) => (f.fromMs !== null && f.toMs !== null ? `${mmss(f.fromMs)}-${mmss(f.toMs)}: ${f.text}` : f.text));
  return `Viral-check: ${fixes.join(" ")}`.slice(0, 500);
}

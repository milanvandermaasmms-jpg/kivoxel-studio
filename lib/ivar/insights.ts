// Ivar learns and advises: once a week per channel he looks at what works in the niche (reference videos from the
// YouTube Data API), at our own numbers and at what Milan did with his proposals, and writes a few insights WITH
// evidence. An insight is advice; it only becomes a lasting preference when Milan clicks "Onthouden". Pure, tested.
import type { ChannelKind } from "./types";

export type RefVideo = { title: string; tags: string[]; duration_s: number | null; is_short: boolean; published_at: string | null; views: number; ratio: number | null; query: string };
export type OwnVideo = { title: string; is_short: boolean; views: number; avg_view_pct: number | null; published_at: string | null };
export type Behaviour = { appliedTitles: string[]; revertedTitles: string[]; droppedIdeas: string[]; madeProjects: string[]; reviewNotes: string[]; memory: string[] };
export type InsightKind = "trend" | "learning" | "tip";
export type Insight = { kind: InsightKind; title: string; body: string; suggestion: string | null; evidence: string[]; confidence: "low" | "medium" | "high" };

/** ISO week like 2026-W46 (Europe/Amsterdam is close enough to UTC for a weekly rhythm). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const STOP = new Set("the a an and or of in to for with on at my i you we is it this that how what from by be are was minecraft shorts short video videos new best vs de het een en van in op met voor is dat wat hoe ik je".split(" "));
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** What stands out in the niche: the best videos by views per subscriber and the words that are overrepresented there. */
export function trendSignals(videos: RefVideo[], now: number) {
  const usable = videos.filter((v) => v.views > 0);
  const byRatio = [...usable].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const top = byRatio.slice(0, Math.max(5, Math.ceil(usable.length / 4)));
  const count = (list: RefVideo[]) => {
    const m = new Map<string, number>();
    for (const v of list) for (const w of new Set([...words(v.title), ...v.tags.flatMap(words)])) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const all = count(usable);
  const inTop = count(top);
  const rising = [...inTop.entries()]
    .filter(([w, n]) => n >= 2 && n / top.length >= 1.5 * ((all.get(w) ?? 0) / Math.max(1, usable.length)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w, n]) => ({ word: w, inTop: n, top: top.length, inAll: all.get(w) ?? 0, all: usable.length }));
  const age = (iso: string | null) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 86_400_000)) : null);
  return {
    count: usable.length,
    queries: [...new Set(usable.map((v) => v.query))],
    medianViews: median(usable.map((v) => v.views)),
    shortsShareTop: top.length ? Math.round((100 * top.filter((v) => v.is_short).length) / top.length) : null,
    medianDurationTop: median(top.map((v) => v.duration_s ?? 0).filter(Boolean)),
    examples: top.slice(0, 8).map((v) => ({ title: v.title.slice(0, 100), views: v.views, ratio: v.ratio === null ? null : Math.round(v.ratio * 100) / 100, short: v.is_short, days_old: age(v.published_at) })),
    rising,
  };
}

/** Our own videos: best and weakest by views per day online (only with enough days to compare). */
export function ownSignals(videos: OwnVideo[], now: number) {
  const rated = videos
    .filter((v) => v.published_at && now - Date.parse(v.published_at) > 2 * 86_400_000)
    .map((v) => ({ ...v, perDay: Math.round(v.views / Math.max(1, (now - Date.parse(v.published_at!)) / 86_400_000)) }))
    .sort((a, b) => b.perDay - a.perDay);
  const row = (v: (typeof rated)[number]) => ({ title: v.title.slice(0, 100), short: v.is_short, views: v.views, views_per_day: v.perDay, viewed_pct: v.avg_view_pct });
  return { count: rated.length, best: rated.slice(0, 3).map(row), weakest: rated.length > 3 ? rated.slice(-3).map(row) : [], tooFew: rated.length < 4 };
}

const KIND_RULES: Record<ChannelKind, string> = {
  kivoxel: "KIVOXEL: faceless Minecraft-gameplay van eigen opnames, Shorts en lange video's, Engelse voice-over voor kinderen. Nooit Maes (het kind) noemen of tonen.",
  dreamnest: "Dreamnest/Lumi: rustgevende slaapvideo's met het personage Lumi. Geen medische claims over slaap, baby's of frequenties; rust en veiligheid gaan voor.",
  other: "Volg de kanaalrichtlijnen.",
};

export function insightPrompt(input: { channel: string; kind: ChannelKind; language: string; trend: ReturnType<typeof trendSignals>; own: ReturnType<typeof ownSignals>; behaviour: Behaviour; previous: string[] }): string {
  return [
    `Je bent Ivar, de assistent van YouTube-kanaal ${input.channel}. ${KIND_RULES[input.kind]}`,
    "Schrijf in het Nederlands, kort en concreet, voor Milan (geen programmeur). Gebruik ALLEEN de data hieronder; verzin geen cijfers. Beloof nooit views of viraliteit.",
    "",
    "Maak hooguit 6 inzichten, elk met bewijs uit de data (noem de getallen of voorbeelden):",
    '- kind "trend": wat nu opvallend goed werkt in de niche (onderwerpen, woorden, formaat, lengte) en hoe wij dat op onze eigen manier kunnen gebruiken. Kopieer geen video\'s van anderen.',
    '- kind "learning": wat Ivar leert uit Milans keuzes (toegepaste vs. teruggedraaide titels, laten vallen ideeën, afkeur-notities) en uit onze eigen cijfers. suggestion = een korte voorkeur die Milan kan onthouden.',
    '- kind "tip": één concrete volgende stap (bijv. een video-idee met werktitel en opening).',
    'confidence: "low" bij weinig data (minder dan 10 referentievideo\'s of minder dan 4 eigen video\'s), anders "medium", alleen "high" bij duidelijke en ruime data.',
    "Herhaal geen inzichten van eerdere weken (zie de lijst). Is er te weinig data voor een soort, laat die soort dan weg.",
    "",
    'Antwoord als JSON: {"insights":[{"kind":"trend|learning|tip","title":"max 100 tekens","body":"max 600 tekens","suggestion":"max 300 tekens of null","evidence":["kort bewijs met getallen"],"confidence":"low|medium|high"}]}',
    "",
    `Kanaaltaal: ${input.language}`,
    `Niche (referentievideo's, zoektermen ${input.trend.queries.join(", ") || "geen"}): ${JSON.stringify(input.trend)}`,
    `Onze eigen video's: ${JSON.stringify(input.own)}`,
    `Milans keuzes: ${JSON.stringify(input.behaviour)}`,
    `Eerdere inzichten (niet herhalen): ${JSON.stringify(input.previous.slice(0, 20))}`,
  ].join("\n");
}

const KINDS: InsightKind[] = ["trend", "learning", "tip"];
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[<>]/g, "").trim().slice(0, n) : "");

/** Only well-formed insights with evidence survive; at most 6, no repeats of earlier titles. */
export function parseInsights(raw: unknown, previous: string[] = []): Insight[] {
  const list = (raw as { insights?: unknown })?.insights;
  if (!Array.isArray(list)) return [];
  const seen = new Set(previous.map((t) => t.toLowerCase()));
  const out: Insight[] = [];
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const kind = KINDS.find((k) => k === r.kind);
    const title = clip(r.title, 120);
    const body = clip(r.body, 1500);
    const evidence = Array.isArray(r.evidence) ? r.evidence.map((e) => clip(e, 300)).filter(Boolean).slice(0, 8) : [];
    if (!kind || !title || !body || !evidence.length || seen.has(title.toLowerCase())) continue;
    if (/\b(gegarandeerd|guaranteed|zeker viraal|goes viral)\b/i.test(`${title} ${body}`)) continue;
    seen.add(title.toLowerCase());
    const confidence = r.confidence === "high" || r.confidence === "low" ? r.confidence : "medium";
    out.push({ kind, title, body, suggestion: clip(r.suggestion, 500) || null, evidence, confidence });
    if (out.length >= 6) break;
  }
  return out;
}

/** Search terms for the weekly reference videos when Milan set none: the niche of the channel. */
export const nicheQueries = (kind: ChannelKind, language: "en" | "nl"): string[] | null =>
  kind === "dreamnest" ? (language === "nl" ? ["slaapliedjes baby", "slaapmuziek baby", "rustige animatie slapen"] : ["baby sleep music", "lullaby for babies", "bedtime animation for kids"]) : null;

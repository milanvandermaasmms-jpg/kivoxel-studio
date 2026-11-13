// Fase 3.3: the predicted Viral-score next to the real numbers after 24 hours and 7 days, and what that teaches about
// THIS channel, in plain Dutch. Honest: with few videos it says so instead of inventing a pattern.
import type { Features } from "./viral.ts";

export type CheckRow = { video_id: string; overall: number; features: Features; created_at: string };
export type PubRow = { video_id: string; youtube_video_id: string | null; title: string };
export type Snap = { youtube_video_id: string; taken_at: string; published_at: string | null; views: number; avg_view_pct: number | null };

export type Outcome = { videoId: string; youtubeId: string; title: string; predicted: number; kind: "short" | "long"; views24h: number | null; views7d: number | null; avgViewPct: number | null; features: Features };

const HOUR = 3_600_000;

/** The views closest to 24 hours and 7 days after publishing (only snapshots taken after that moment count). */
export function outcomes(checks: CheckRow[], pubs: PubRow[], snaps: Snap[]): Outcome[] {
  const latest = new Map<string, CheckRow>();
  for (const c of checks) if (!latest.has(c.video_id) || latest.get(c.video_id)!.created_at < c.created_at) latest.set(c.video_id, c);
  const out: Outcome[] = [];
  for (const p of pubs) {
    const c = latest.get(p.video_id);
    if (!c || !p.youtube_video_id) continue;
    const own = snaps.filter((s) => s.youtube_video_id === p.youtube_video_id).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    const published = own.find((s) => s.published_at)?.published_at;
    if (!published) continue;
    const at = (hours: number) => own.find((s) => Date.parse(s.taken_at) >= Date.parse(published) + hours * HOUR) ?? null;
    const d1 = at(24);
    const d7 = at(24 * 7);
    out.push({ videoId: p.video_id, youtubeId: p.youtube_video_id, title: p.title, predicted: c.overall, kind: c.features.kind, views24h: d1?.views ?? null, views7d: d7?.views ?? null, avgViewPct: (d7 ?? d1)?.avg_view_pct ?? null, features: c.features });
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const times = (a: number, b: number) => (b > 0 ? a / b : null);

/** A feature that splits the videos in two groups; a statement only when both groups have at least 2 videos. */
const SPLITS: { label: (yes: boolean) => string; test: (f: Features) => boolean | null }[] = [
  { label: (y) => (y ? "met de hook binnen de eerste seconde" : "met een latere hook"), test: (f) => (f.firstLineMs === null ? null : f.firstLineMs <= 1000) },
  { label: (y) => (y ? "met een korte hook (hoogstens 12 woorden)" : "met een lange hook"), test: (f) => f.hookWords <= 12 },
  { label: (y) => (y ? "zonder saaie stukken" : "met saaie stukken"), test: (f) => f.deadShare === 0 },
  { label: (y) => (y ? "met een oproep of slotzin" : "zonder oproep of slotzin"), test: (f) => f.hasCta },
  { label: (y) => (y ? "met een energieke stem (AI 7 of hoger)" : "met een rustigere stem"), test: (f) => (f.aiEnergy === null ? null : f.aiEnergy >= 7) },
];

export type Insight = { text: string; strength: number };

export function whatWorks(rows: Outcome[]): { insights: Insight[]; enough: boolean; scoreMatches: string | null } {
  const measured = rows.filter((r) => r.views7d !== null || r.views24h !== null);
  const views = (r: Outcome) => (r.views7d ?? r.views24h)!;
  const insights: Insight[] = [];
  for (const kind of ["short", "long"] as const) {
    const group = measured.filter((r) => r.kind === kind);
    for (const s of SPLITS) {
      const yes = group.filter((r) => s.test(r.features) === true);
      const no = group.filter((r) => s.test(r.features) === false);
      if (yes.length < 2 || no.length < 2) continue;
      const k = times(avg(yes.map(views)), avg(no.map(views)));
      if (k === null || (k > 0.8 && k < 1.25)) continue;
      const word = kind === "short" ? "Shorts" : "Lange video's";
      insights.push({ text: k >= 1 ? `${word} ${s.label(true)} kregen gemiddeld ${k.toFixed(1).replace(".", ",")}× zoveel views als ${s.label(false).replace(/^met /, "die met ").replace(/^zonder /, "die zonder ")}.` : `${word} ${s.label(false)} deden het juist beter (${(1 / k).toFixed(1).replace(".", ",")}× zoveel views).`, strength: Math.abs(Math.log(k)) * Math.min(yes.length, no.length) });
    }
  }
  // Did a higher predicted score go with more views? Compare the better half with the other half.
  let scoreMatches: string | null = null;
  if (measured.length >= 4) {
    const sorted = [...measured].sort((a, b) => b.predicted - a.predicted);
    const top = sorted.slice(0, Math.floor(sorted.length / 2));
    const rest = sorted.slice(Math.floor(sorted.length / 2));
    const k = times(avg(top.map(views)), avg(rest.map(views)));
    scoreMatches = k === null ? null : k >= 1.2 ? `De Viral-score klopt tot nu toe: video's met een hogere score kregen ${k.toFixed(1).replace(".", ",")}× zoveel views.` : k <= 0.83 ? "De Viral-score voorspelt bij jouw kanaal nog niet goed: video's met een lagere score deden het juist beter." : "Tot nu toe maakt de Viral-score weinig verschil in views; er zijn meer video's nodig.";
  }
  return { insights: insights.sort((a, b) => b.strength - a.strength).slice(0, 5), enough: measured.length >= 4, scoreMatches };
}

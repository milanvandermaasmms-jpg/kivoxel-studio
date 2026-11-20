// 20-11-2026 (Milan: "bouw het", after the clipping research): learn from what viewers really watch. Per kind of moment
// (near death, rescue, mistake …) the Shorts of a channel are compared on how much of the Short viewers watched
// (YouTube Analytics "average percentage viewed"). Kinds that are watched better than the channel's average get a few
// points extra when the worker picks which moments become Shorts; kinds that are swiped away get a few points less.
// Careful by design: only Shorts that YouTube really showed (enough views), only kinds with a few Shorts, pulled
// towards zero when there are few, and never more than MAX_BOOST points. Pure functions, tested.
import { MOMENT_KINDS, type MomentKind } from "./analysis.ts";

export type KindSample = { kind: MomentKind; avgViewPct: number; views: number };
export type KindBoost = { kind: MomentKind; boost: number; shorts: number; avgViewPct: number };

/** A Short with fewer views was not really tested by YouTube yet (its test group is about 1,000 viewers). */
export const MIN_VIEWS = 300;
/** At least this many Shorts of a kind before it counts. */
export const MIN_PER_KIND = 3;
/** Pulls a kind with few Shorts towards the average: with n Shorts the difference counts for n / (n + PRIOR). */
const PRIOR = 5;
/** Score points per percentage point of "watched" above or below the channel's average. */
const POINTS_PER_PCT = 0.5;
export const MAX_BOOST = 15;

/** One boost per kind that has enough Shorts. Kinds without enough data are left out (boost 0). */
export function kindBoosts(samples: KindSample[]): KindBoost[] {
  const used = samples.filter((s) => s.views >= MIN_VIEWS && Number.isFinite(s.avgViewPct) && s.avgViewPct > 0 && (MOMENT_KINDS as readonly string[]).includes(s.kind));
  if (used.length < MIN_PER_KIND * 2) return [];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const overall = mean(used.map((s) => s.avgViewPct));
  const out: KindBoost[] = [];
  for (const kind of MOMENT_KINDS) {
    const mine = used.filter((s) => s.kind === kind);
    if (mine.length < MIN_PER_KIND) continue;
    const avg = mean(mine.map((s) => s.avgViewPct));
    const shrunk = ((avg - overall) * mine.length) / (mine.length + PRIOR);
    const boost = Math.max(-MAX_BOOST, Math.min(MAX_BOOST, Math.round(shrunk * POINTS_PER_PCT)));
    out.push({ kind, boost, shorts: mine.length, avgViewPct: Math.round(avg * 10) / 10 });
  }
  return out;
}

/** The boost of one kind (0 when there is no data). */
export const boostOf = (boosts: KindBoost[], kind: MomentKind) => boosts.find((b) => b.kind === kind)?.boost ?? 0;

/** Short Dutch line for the analysis report: what the studio learned, strongest first. */
export function boostsSummary(boosts: KindBoost[]): string | null {
  const telling = boosts.filter((b) => b.boost !== 0).sort((a, b) => b.boost - a.boost);
  if (!telling.length) return null;
  return telling.map((b) => `${b.kind} ${b.boost > 0 ? "+" : ""}${b.boost} (${b.shorts} Shorts, ${b.avgViewPct}% bekeken)`).join(" · ");
}

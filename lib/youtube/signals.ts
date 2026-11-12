// Smart signals (fase E2, 2.2 chapter 7 and 24.6). Only on real numbers, with the rule and the numbers shown, and
// never a conclusion from a single video: every comparison needs at least MIN_OTHERS other videos.
import type { Segment } from "./analysis";
import { COLD_OPEN_MS, HOOK_TYPE_LABEL, type HookType } from "./hooks";
import { biggestDrop, engagedShare, type VideoRow } from "./stats";

export const MIN_OTHERS = 3;
const DAY = 86_400_000;

/** What we know about our own production of a video (format, chosen hook, montage plan). */
export type Production = { format: "A" | "B" | "C"; hookType: HookType | null; segments: Segment[] };
export type Signal = { kind: "growth" | "short_strong" | "new_weak" | "subscribers" | "hook" | "format"; tone: "good" | "watch"; videoId: string | null; title: string; rule: string };

export const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (v: number) => v.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
const others = (rows: VideoRow[], v: VideoRow) => rows.filter((r) => r.youtube_video_id !== v.youtube_video_id);

/** Average views per day since publishing (near-live counts). */
export function viewsPerDay(v: Pick<VideoRow, "views" | "published_at">, now: number): number | null {
  if (!v.published_at) return null;
  const days = Math.max(1, (now - Date.parse(v.published_at)) / DAY);
  return v.views / days;
}

export function signals(rows: VideoRow[], production: Record<string, Production | undefined>, now = Date.now()): Signal[] {
  const out: Signal[] = [];
  const name = (v: VideoRow) => v.title || v.youtube_video_id;

  for (const v of rows) {
    const rest = others(rows, v);
    // 1. Growing faster than normal: views in 24 hours compared with the other videos' 24 hours.
    const growth = rest.map((r) => r.views24h).filter((x): x is number => x !== null);
    const m24 = median(growth);
    if (v.views24h !== null && growth.length >= MIN_OTHERS && m24 !== null && v.views24h >= 20 && v.views24h >= 2 * Math.max(1, m24))
      out.push({ kind: "growth", tone: "good", videoId: v.youtube_video_id, title: `"${name(v)}" groeit sneller dan normaal`, rule: `+${fmt(v.views24h)} views in 24 uur; de mediaan van je andere ${growth.length} video's is +${fmt(m24)} (regel: minstens 2× de mediaan en minstens 20 views).` });

    // 2. A Short above average: share of engaged views (viewers who really stayed) compared with other Shorts.
    if (v.isShort) {
      const share = engagedShare(v);
      const shorts = rest.filter((r) => r.isShort).map(engagedShare).filter((x): x is number => x !== null);
      const ms = median(shorts);
      if (share !== null && shorts.length >= MIN_OTHERS && ms !== null && share >= ms * 1.2 && (v.a_views ?? 0) >= 50)
        out.push({ kind: "short_strong", tone: "good", videoId: v.youtube_video_id, title: `Short "${name(v)}" presteert bovengemiddeld`, rule: `${pct(share)} van de views is een engaged view; mediaan van je andere ${shorts.length} Shorts: ${pct(ms)} (regel: minstens 20% hoger, minstens 50 views).` });
    }

    // 3. New video weaker than expected: views per day in the first week against the older videos.
    const age = v.published_at ? now - Date.parse(v.published_at) : null;
    if (age !== null && age >= DAY && age <= 7 * DAY) {
      const rate = viewsPerDay(v, now);
      const older = rest.filter((r) => r.published_at && now - Date.parse(r.published_at) > 7 * DAY).map((r) => viewsPerDay(r, now)).filter((x): x is number => x !== null);
      const mo = median(older);
      if (rate !== null && older.length >= MIN_OTHERS && mo !== null && mo >= 5 && rate < mo * 0.5)
        out.push({ kind: "new_weak", tone: "watch", videoId: v.youtube_video_id, title: `Nieuwe video "${name(v)}" presteert zwakker dan verwacht`, rule: `${fmt(rate)} views per dag sinds publicatie; mediaan van je ${older.length} oudere video's: ${fmt(mo)} per dag (regel: minder dan de helft). Oudere video's hadden meer tijd; zie dit als aanwijzing, niet als oordeel.` });
    }

    // 4. Many new subscribers per view.
    const subRate = (r: VideoRow) => (r.a_views && r.subscribers_gained !== null ? r.subscribers_gained / r.a_views : null);
    const mine = subRate(v);
    const rates = rest.map(subRate).filter((x): x is number => x !== null);
    const mr = median(rates);
    if (mine !== null && (v.subscribers_gained ?? 0) >= 3 && rates.length >= MIN_OTHERS && mr !== null && mine >= 2 * Math.max(mr, 0.001))
      out.push({ kind: "subscribers", tone: "good", videoId: v.youtube_video_id, title: `"${name(v)}" levert opvallend veel abonnees op`, rule: `${v.subscribers_gained} nieuwe abonnees op ${fmt(v.a_views ?? 0)} views (${fmt(mine * 1000)} per 1.000); mediaan van je andere video's: ${fmt(mr * 1000)} per 1.000 (regel: minstens 2×, minstens 3 abonnees).` });
  }

  // 5 and 6. Hook types and formats: compare groups, each group at least 2 videos, against the whole channel.
  const groups = (key: (p: Production) => string | null) => {
    const by = new Map<string, number[]>();
    for (const v of rows) {
      const p = v.video_id ? production[v.video_id] : undefined;
      const k = p ? key(p) : null;
      const s = engagedShare(v);
      if (k && s !== null) by.set(k, [...(by.get(k) ?? []), s]);
    }
    return by;
  };
  const all = rows.map(engagedShare).filter((x): x is number => x !== null);
  const overall = median(all);
  if (overall !== null && all.length >= MIN_OTHERS + 1) {
    for (const [hook, shares] of groups((p) => p.hookType)) {
      const m = median(shares)!;
      if (shares.length >= 2 && m >= overall * 1.2)
        out.push({ kind: "hook", tone: "good", videoId: null, title: `Mogelijk succesvolle hook: ${HOOK_TYPE_LABEL[hook as HookType] ?? hook}`, rule: `Mediaan engaged views ${pct(m)} over ${shares.length} video's met deze hook; hele kanaal ${pct(overall)} over ${all.length} video's (regel: minstens 20% hoger, minstens 2 video's).` });
    }
    const FORMAT: Record<string, string> = { A: "Bijna-dood-moment", B: "Zeldzame vondst", C: "Survival-verhaal" };
    for (const [format, shares] of groups((p) => p.format)) {
      const m = median(shares)!;
      if (shares.length >= 2 && m >= overall * 1.2)
        out.push({ kind: "format", tone: "good", videoId: null, title: `Format ${FORMAT[format] ?? format} lijkt beter te werken`, rule: `Mediaan engaged views ${pct(m)} over ${shares.length} video's; hele kanaal ${pct(overall)} over ${all.length} video's (regel: minstens 20% hoger, minstens 2 video's).` });
    }
  }
  return out;
}

/**
 * Where viewers leave, in the words of the montage plan: which fragment plays at that moment (fase E2, 24.7).
 * Approximate: the plan before the hook was applied; a cold open puts 1.5 s in front.
 */
export function dropMoment(v: Pick<VideoRow, "retention" | "duration_s">, p: Production | undefined): { atMs: number; share: number; fragment: string | null } | null {
  const drop = biggestDrop(v.retention);
  if (!drop || !v.duration_s) return null;
  const atMs = Math.round(drop.at * v.duration_s * 1000);
  if (!p?.segments.length) return { atMs, share: drop.drop, fragment: null };
  const shift = p.hookType === "cold_open" ? COLD_OPEN_MS : 0;
  if (atMs < shift) return { atMs, share: drop.drop, fragment: "de cold open (hoogtepunt vooraan)" };
  const sorted = [...p.segments].sort((a, b) => a.out_start_ms - b.out_start_ms);
  const idx = sorted.reduce((found, s, i) => (s.out_start_ms + shift <= atMs ? i : found), 0);
  const s = sorted[idx];
  const PART: Record<string, string> = { hook: "hook", build: "opbouw", payoff: "ontknoping", teaser: "teaser", search: "zoeken", discovery: "vondst", aftermath: "nasleep", cold_open: "cold open", goals: "doelen", chapter: "hoofdstuk" };
  return { atMs, share: drop.drop, fragment: `fragment ${idx + 1} (${PART[s.part] ?? s.part})${s.note ? `: ${s.note}` : ""}` };
}

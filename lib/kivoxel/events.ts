// KIVOXEL fase 1, section 1a: the Event Timeline. Before one word of script is written, we know WHEN what happens.
// Built from free signals only (audio peaks, scene cuts, stillness, the picture pass with hearts and the death screen),
// and enriched with the AI moments when the analysis service ran. Works fully without AI credits (section 8).
import type { EventType } from "./config.ts";
import { buildTimeline, type Signals } from "../youtube/footage.ts";
import type { FrameMetrics, VisualSignals } from "./visual.ts";

export type EventKind = "death" | "damage" | "low_health" | "audio_peak" | "action" | "ai_moment" | "kid_reaction";
export type GameEvent = {
  id: string;
  kind: EventKind;
  /** Hook type (config/kivoxel/hooks.json); null for filler that is no Short on its own. */
  type: EventType | null;
  t_start: number;
  t_peak: number;
  t_end: number;
  /** 0-1: how strong the moment itself is. */
  intensity: number;
  /** 0-100: how worth watching (Shorts are cut around the best ones). */
  payoff: number;
  description: string;
  /** Best frame for a thumbnail: sharp, in gameplay (not a menu), just before or at the peak. */
  t_thumb: number;
  sources: string[];
};
export type DeadSpan = { startMs: number; endMs: number; why: "still" | "menu" | "black" | "quiet" };
/** `rules`: version of the detection rules; a stored timeline with older rules is built again. */
export const EVENT_RULES = 2;
export type EventTimeline = { version: 1; rules?: number; durationMs: number; generatedAt: string; engine: "free" | "free+ai"; events: GameEvent[]; dead: DeadSpan[]; health: { atMs: number; hearts: number }[] };

/** A moment from the paid analysis (yt_moments), already mapped to a hook type. */
export type AiMoment = { kind: string; type: EventType; startMs: number; peakMs: number; endMs: number; score: number; reason: string };
/** A shout of the kids found by speech recognition (later step); loud reactions are gold. */
export type Reaction = { atMs: number; endMs: number; text: string; loudness: number };

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const hearts = (h: number) => (h / 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/** Health per frame with gaps (no HUD) filled by the last known value for at most 2 s, so a blink does not count as a drop. */
function healthTrack(frames: FrameMetrics[], fps: number): number[] {
  const out: number[] = [];
  let last = -1;
  let since = Infinity;
  for (const f of frames) {
    if (f.health >= 0) {
      last = f.health;
      since = 0;
    } else since++;
    out.push(since <= fps * 2 ? last : -1);
  }
  return out;
}

/** The hardcore "GAME OVER" screen (and the normal death screen): red-tinted, dark, no HUD, still, for 2 s, right after gameplay. */
export function findDeaths(v: VisualSignals): number[] {
  const f = v.frames;
  const out: number[] = [];
  const need = v.fps * 2;
  let run = 0;
  for (let i = 0; i < f.length; i++) {
    const deathLike = f[i].tint >= 14 && f[i].luma < 85 && f[i].health < 0 && f[i].motion < 4;
    run = deathLike ? run + 1 : 0;
    if (run === need) {
      const start = i - need + 1;
      // There must have been gameplay (hearts) within 10 s before: the loading screen at the start is red too.
      const before = f.slice(Math.max(0, start - v.fps * 10), start);
      if (before.some((x) => x.health >= 0) && !out.some((t) => Math.abs(t - (start * 1000) / v.fps) < 30_000)) out.push(Math.round((start * 1000) / v.fps));
    }
  }
  return out;
}

/** Drops in health of at least one heart within about two seconds. */
export function findDamage(v: VisualSignals): { atMs: number; from: number; to: number }[] {
  const h = healthTrack(v.frames, v.fps);
  const out: { atMs: number; from: number; to: number }[] = [];
  const w = v.fps; // one second on each side
  for (let i = w; i < h.length - w; i++) {
    const before = median(h.slice(i - w, i).filter((x) => x >= 0));
    const after = median(h.slice(i, i + w).filter((x) => x >= 0));
    if (!Number.isFinite(before) || !Number.isFinite(after) || before - after < 100) continue;
    const atMs = Math.round((i * 1000) / v.fps);
    const prev = out[out.length - 1];
    // One hit sequence (a fall, a creeper) counts once: join drops that follow within 3 s.
    if (prev && atMs - prev.atMs < 3000) prev.to = Math.min(prev.to, after);
    else out.push({ atMs, from: before, to: after });
  }
  return out;
}

/** Stretches with 4 hearts or fewer for at least 3 s: real tension (in hardcore one more hit can end the world). */
export function findLowHealth(v: VisualSignals, maxHealth = 400): { startMs: number; endMs: number; lowest: number; lowestAtMs: number }[] {
  const h = healthTrack(v.frames, v.fps);
  const out: { startMs: number; endMs: number; lowest: number; lowestAtMs: number }[] = [];
  let start = -1;
  let lowest = Infinity;
  let lowestAt = 0;
  for (let i = 0; i <= h.length; i++) {
    // A menu in between (no HUD) does not end the stretch; only health above the limit does.
    if (i < h.length && h[i] < 0 && start >= 0) continue;
    const low = i < h.length && h[i] >= 0 && h[i] <= maxHealth;
    if (low) {
      if (start < 0) start = i;
      if (h[i] < lowest) {
        lowest = h[i];
        lowestAt = i;
      }
    } else if (start >= 0) {
      if (i - start >= v.fps * 3) out.push({ startMs: Math.round((start * 1000) / v.fps), endMs: Math.round((i * 1000) / v.fps), lowest, lowestAtMs: Math.round((lowestAt * 1000) / v.fps) });
      start = -1;
      lowest = Infinity;
    }
  }
  return out;
}

/** Parts where nothing happens: stillness, menus/inventory, black, or quiet and barely moving. Cut these (section 7.2). */
export function findDead(v: VisualSignals, s: Signals | null, minMs = 700): DeadSpan[] {
  const f = v.frames;
  const loudAt = (ms: number) => (s ? (s.loudness[Math.floor(ms / 100)] ?? -120) : -120);
  // Menus, inventory, chests and loading screens: in gameplay the hearts are always in view. No hearts for at least
  // 1 s while the picture barely moves = a menu (measured on "Hardcore Dane!!": world list, crafting, chest).
  // "Barely moves" keeps gameplay with odd hearts (poison, frozen) from being cut.
  const menuLike = f.map((x) => x.health < 0 && x.motion < 3);
  const inMenu = menuLike.map(() => false);
  for (let i = 0; i < f.length; ) {
    let j = i;
    while (j < f.length && menuLike[j]) j++;
    if (j - i >= v.fps) for (let k = i; k < j; k++) inMenu[k] = true;
    i = Math.max(j, i + 1);
  }
  const why = (x: FrameMetrics, ms: number, i: number): DeadSpan["why"] | null => {
    if (x.luma < 12) return "black";
    if (x.ui >= 250 || inMenu[i]) return "menu";
    if (x.motion < 0.6) return "still";
    if (x.motion < 2 && loudAt(ms) < -38) return "quiet";
    return null;
  };
  const out: DeadSpan[] = [];
  let cur: DeadSpan | null = null;
  for (let i = 0; i <= f.length; i++) {
    const ms = Math.round((i * 1000) / v.fps);
    const w = i < f.length ? why(f[i], ms, i) : null;
    if (cur && (w === null || w !== cur.why)) {
      cur.endMs = ms;
      if (cur.endMs - cur.startMs >= minMs) out.push(cur);
      cur = null;
    }
    if (w && !cur) cur = { startMs: ms, endMs: ms, why: w };
  }
  return out;
}

/** Sharp, in gameplay, little motion blur: the best frame between `fromMs` and `toMs`. */
export function bestFrame(v: VisualSignals, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.floor((fromMs / 1000) * v.fps));
  const b = Math.min(v.frames.length - 1, Math.ceil((toMs / 1000) * v.fps));
  let best = Math.round((fromMs + toMs) / 2);
  let score = -Infinity;
  // With the HUD in view we know it is gameplay (no menu, no loading screen): use only those frames when there are any.
  const hud = v.frames.slice(a, b + 1).some((x) => x.health >= 0);
  for (let i = a; i <= b; i++) {
    const x = v.frames[i];
    if (!x || x.ui >= 120 || x.luma < 25 || (hud && x.health < 0)) continue;
    // Sharp beats blurry; a lighter frame reads better as a small thumbnail (caves are dark).
    const s = x.sharp - 0.6 * x.motion + (x.health >= 0 ? 4 : 0) + Math.min(3, Math.max(0, (x.luma - 50) / 20));
    if (s > score) {
      score = s;
      best = Math.round((i * 1000) / v.fps);
    }
  }
  return best;
}

let counter = 0;
const eventId = (kind: EventKind, peak: number) => `${kind}-${Math.round(peak / 100)}-${(counter++).toString(36)}`;

/** Joins events whose peaks lie within `gapMs`: the strongest one leads, the others add sources and payoff. */
export function mergeEvents(events: GameEvent[], gapMs = 3000): GameEvent[] {
  const sorted = [...events].sort((a, b) => a.t_peak - b.t_peak);
  const out: GameEvent[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    if (prev && e.t_peak - prev.t_peak <= gapMs) {
      const [lead, other] = e.payoff > prev.payoff ? [e, prev] : [prev, e];
      out[out.length - 1] = {
        ...lead,
        t_start: Math.min(lead.t_start, other.t_start),
        t_end: Math.max(lead.t_end, other.t_end),
        intensity: Math.max(lead.intensity, other.intensity),
        payoff: Math.min(100, Math.max(lead.payoff, other.payoff) + 6),
        type: lead.type ?? other.type,
        description: lead.description === other.description ? lead.description : `${lead.description} + ${other.description}`,
        sources: [...new Set([...lead.sources, ...other.sources])],
      };
    } else out.push(e);
  }
  return out;
}

/** The whole timeline for one recording. `ai` and `reactions` are optional: without them it is the free engine. */
export function buildEvents(input: { visual: VisualSignals; signals: Signals | null; ai?: AiMoment[]; reactions?: Reaction[]; now?: Date }): EventTimeline {
  const { visual: v, signals } = input;
  const durationMs = v.durationMs || Math.round((v.frames.length * 1000) / v.fps);
  const within = (ms: number) => Math.max(0, Math.min(durationMs, Math.round(ms)));
  const raw: GameEvent[] = [];
  const add = (e: Omit<GameEvent, "id" | "t_thumb"> & { t_thumb?: number }) =>
    raw.push({ ...e, id: eventId(e.kind, e.t_peak), t_start: within(e.t_start), t_end: within(e.t_end), t_thumb: e.t_thumb ?? bestFrame(v, e.t_peak - 1500, e.t_peak + 400) });

  for (const at of findDeaths(v)) {
    add({ kind: "death", type: "fail", t_start: at - 8000, t_peak: at, t_end: at + 2500, intensity: 1, payoff: 95, description: "Dood: GAME OVER-scherm", sources: ["beeld:doodscherm"], t_thumb: bestFrame(v, at - 2500, at - 250) });
  }
  for (const d of findDamage(v)) {
    const lost = d.from - d.to;
    const intensity = clamp(lost / 500 + (1 - d.to / 1000) * 0.5);
    add({
      kind: "damage",
      type: d.to <= 400 ? "bijna_dood" : "fail",
      t_start: d.atMs - 4000,
      t_peak: d.atMs,
      t_end: d.atMs + 3000,
      intensity,
      payoff: Math.round(35 + intensity * 45),
      description: `Schade: van ${hearts(d.from)} naar ${hearts(d.to)} hartjes`,
      sources: ["beeld:hartjes"],
    });
  }
  for (const l of findLowHealth(v)) {
    const intensity = clamp(1 - l.lowest / 400);
    add({ kind: "low_health", type: "bijna_dood", t_start: l.startMs - 2000, t_peak: l.lowestAtMs, t_end: Math.min(l.endMs, l.lowestAtMs + 8000), intensity, payoff: Math.round(40 + intensity * 35), description: `Nog maar ${hearts(l.lowest)} hartjes`, sources: ["beeld:hartjes"] });
  }
  if (signals) {
    for (const p of buildTimeline(signals).peaks) {
      const intensity = clamp(p.rise / 25);
      // A loud sound alone gets no hook type: a pig is loud too, and a hook must match what really happens.
      add({ kind: "audio_peak", type: null, t_start: p.atMs - 3000, t_peak: p.atMs, t_end: p.atMs + 2000, intensity, payoff: Math.round(20 + intensity * 35), description: `Hard geluid (+${Math.round(p.rise)} LU)`, sources: ["geluid:piek"] });
    }
  }
  for (const m of input.ai ?? []) {
    const intensity = clamp(m.score / 100);
    add({ kind: "ai_moment", type: m.type, t_start: m.startMs, t_peak: m.peakMs, t_end: m.endMs, intensity, payoff: Math.round(30 + intensity * 55), description: m.reason.slice(0, 160), sources: [`ai:${m.kind}`] });
  }
  for (const r of input.reactions ?? []) {
    add({ kind: "kid_reaction", type: null, t_start: r.atMs - 4000, t_peak: r.atMs, t_end: r.endMs + 1500, intensity: clamp((r.loudness + 40) / 30), payoff: 45, description: `Reactie: "${r.text.slice(0, 40)}"`, sources: ["spraak:kinderen"] });
  }

  const dead = findDead(v, signals);
  const inDead = (ms: number) => dead.some((d) => ms >= d.startMs && ms < d.endMs && d.why !== "quiet");
  const events = mergeEvents(raw)
    // A peak inside a menu or a still picture is no moment (the death screen itself is still: keep deaths).
    .filter((e) => e.kind === "death" || !inDead(e.t_peak))
    .map((e) => (e.sources.length >= 3 ? { ...e, payoff: Math.min(100, e.payoff + 5) } : e));

  const health: EventTimeline["health"] = [];
  for (let i = 0; i < v.frames.length; i += v.fps) if (v.frames[i].health >= 0) health.push({ atMs: Math.round((i * 1000) / v.fps), hearts: v.frames[i].health / 100 });

  return { version: 1, rules: EVENT_RULES, durationMs, generatedAt: (input.now ?? new Date()).toISOString(), engine: input.ai?.length ? "free+ai" : "free", events, dead, health };
}

/** The best events for Shorts: highest payoff first, never two that overlap. */
export function topPayoffs(t: EventTimeline, count = 5, minPayoff = 50): GameEvent[] {
  const picked: GameEvent[] = [];
  for (const e of [...t.events].filter((x) => x.type && x.payoff >= minPayoff).sort((a, b) => b.payoff - a.payoff)) {
    if (picked.some((p) => e.t_start < p.t_end && p.t_start < e.t_end)) continue;
    picked.push(e);
    if (picked.length === count) break;
  }
  return picked;
}

// 23-11-2026 (Milan, superprompt V6, fase 32): how well ONE track suits THIS montage, 0-10, minimum 8.0. Not the
// track's own "viral" value: the same horror track scores high on a jumpscare and low on a funny Roblox clip. Every
// criterion says what it is based on. It is an estimate over measured facts (the event type and intensity from the
// timeline, the track's moods, energy and tempo from the library, the voice in the mix), labelled as such; whether a
// track performs better on YouTube needs our own A/B data first. A track without a licence on record never qualifies.

import type { EventType } from "./config.ts";
import { MOOD_FOR, type Track } from "./media.ts";

export const FIT_MIN = 8.0;
export const FIT_WEIGHTS = { passend: 0.3, emotie: 0.2, timing: 0.15, spanning: 0.15, balans: 0.1, kanaal: 0.1 } as const;
export type FitKey = keyof typeof FIT_WEIGHTS;
export type Fit = { score: number; parts: Record<FitKey, { score: number; why: string }>; licensed: boolean; ok: boolean };

export type FitContext = {
  /** Type of the main moment (null = unknown, e.g. a long video with many). */
  type: EventType | null;
  /** 0-1: how intense the moment is (timeline intensity). */
  intensity: number;
  withVoice: boolean;
  short: boolean;
  channel: string;
};

const r1 = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;

export function musicFit(t: Pick<Track, "moods" | "energy" | "bpm" | "license" | "test" | "channels" | "beat_offset_ms" | "bpm_measured">, c: FitContext): Fit {
  const fitting = c.type ? MOOD_FOR[c.type] : [];
  const rank = fitting.length ? Math.min(...t.moods.map((m) => (fitting.includes(m) ? fitting.indexOf(m) : 9))) : null;
  const passend = rank === null ? { score: 6, why: "Soort moment onbekend" } : rank === 9 ? { score: 2, why: `Sfeer ${t.moods.join(", ")} past niet bij ${c.type} (verwacht ${fitting.join(", ")})` } : { score: 10 - rank * 1.5, why: `Sfeer ${t.moods.join(", ")}: ${rank === 0 ? "beste" : `${rank + 1}e`} keus voor ${c.type}` };
  const wantEnergy = 1 + Math.round(c.intensity * 4);
  const emotie = { score: 10 - Math.abs(t.energy - wantEnergy) * 2, why: `Energie ${t.energy}/5 tegenover intensiteit van het moment (${wantEnergy}/5)` };
  const timing = t.bpm > 0 && t.beat_offset_ms !== undefined ? { score: t.bpm_measured ? 8 : 10, why: `Tempo ${t.bpm} bpm${t.bpm_measured ? " (geschat)" : ""}, eerste tel bekend: knippen op de tel kan` } : t.bpm > 0 ? { score: 7, why: `Tempo ${t.bpm} bpm, eerste tel onbekend` } : { score: 5, why: "Tempo onbekend" };
  const tense = c.type === "bijna_dood" || c.type === "jumpscare";
  const spanning = tense ? (t.moods.some((m) => m === "tense" || m === "dark" || m === "epic") ? { score: 10, why: "Bouwt spanning op" } : { score: 4, why: "Geen spanning in de track bij een spannend moment" }) : { score: t.moods.includes("dark") && c.type === "grap" ? 3 : 9, why: t.moods.includes("dark") && c.type === "grap" ? "Dreigende track bij een grap" : "Geen spanningsmoment: past" };
  const loud = t.energy >= 5 || t.moods.includes("hype");
  const balans = c.withVoice ? (loud ? { score: 5, why: "Drukke track onder een stem: concurreert met de stem" } : { score: 10, why: "Rustig genoeg onder de stem" }) : { score: 9, why: "Geen stem: track mag voluit (onder het gamegeluid)" };
  const allowed = !t.channels?.length || t.channels.includes(c.channel);
  const licensed = !!t.license?.trim() && !t.test;
  const kanaal = !allowed ? { score: 0, why: `Niet toegestaan op ${c.channel}` } : !licensed ? { score: 0, why: t.test ? "Testtrack: nooit voor een upload" : "Geen licentie vastgelegd" } : { score: 10, why: `Licentie: ${t.license}` };
  const parts = { passend, emotie, timing, spanning, balans, kanaal } as Record<FitKey, { score: number; why: string }>;
  for (const k of Object.keys(parts) as FitKey[]) parts[k] = { ...parts[k], score: r1(parts[k].score) };
  const score = r1((Object.keys(FIT_WEIGHTS) as FitKey[]).reduce((a, k) => a + parts[k].score * FIT_WEIGHTS[k], 0));
  return { score, parts, licensed, ok: licensed && allowed && score >= FIT_MIN };
}

/** The library ranked for this montage; when tracks reach 8.0 only those remain (else all, with the reason). */
export function rankForMontage<T extends Parameters<typeof musicFit>[0]>(library: T[], c: FitContext): { tracks: T[]; best: number | null; note: string } {
  const scored = library.map((t) => ({ t, f: musicFit(t, c) })).filter((x) => x.f.licensed).sort((a, b) => b.f.score - a.f.score);
  if (!scored.length) return { tracks: [], best: null, note: "Geen track met vastgelegde licentie" };
  const good = scored.filter((x) => x.f.ok);
  const best = scored[0].f.score;
  return good.length
    ? { tracks: good.map((x) => x.t), best, note: `Muziek: ${good.length} track(s) halen de 8,0 voor dit moment (beste ${best.toFixed(1).replace(".", ",")})` }
    : { tracks: scored.slice(0, Math.max(3, Math.ceil(scored.length / 3))).map((x) => x.t), best, note: `Geen track haalt de 8,0 voor dit moment (beste ${best.toFixed(1).replace(".", ",")}); de best passende gekozen. Een passendere track toevoegen helpt.` };
}

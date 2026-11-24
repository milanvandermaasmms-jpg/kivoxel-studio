// 24-11-2026 (Milan, definitieve acceptatie, opdracht 4): Ivar's learning cycle. From Milan's own decisions (what he
// rejected, approved, gave feedback on, which audio he chose) Ivar derives lessons per channel. A lesson with enough
// consistent evidence is applied by itself, but only as a SAFE improvement (a small weight on which moments become a
// Short, a little more outcome after the peak, the audio option he keeps choosing); everything else stays a proposal.
// Milan can switch any lesson off. Real YouTube results already weigh in per kind of moment (lib/youtube/learnedKinds.ts).
// Pure, tested.

import type { FeedbackKind } from "../youtube/reviewFeedback";

export type LessonAction =
  | { type: "kind_boost"; kind: string; boost: number }
  | { type: "payoff_extra"; ms: number }
  | { type: "audio_default"; music_pick?: string; sfx_level?: string }
  | { type: "none" };
export type Lesson = {
  id: string;
  channelId: string | null;
  title: string;
  evidence: string[];
  count: number;
  status: "actief" | "voorstel";
  action: LessonAction;
};

export type LearnVideo = { id: string; channelId: string | null; status: string; note: string | null; momentKind: string | null; format: string };
export type LearnFeedback = { videoId: string; channelId: string | null; kinds: FeedbackKind[] };
export type LearnAudio = { channelId: string | null; music?: string | null; sfx?: string | null };

/** Notes the studio wrote itself: not Milan's judgement, so no lesson. */
const SYSTEM = /^(Niet gebruikt|Vervangen|test$|Producer:|Studio )/i;
const APPROVED = ["approved", "scheduled", "published"];
const KIND_NL: Record<string, string> = { escape: "ontsnappingen", near_death: "bijna-dood-momenten", mistake: "fouten", surprise: "verrassingen", discovery: "ontdekkingen", rare_find: "zeldzame vondsten", build: "bouwmomenten", rescue: "reddingen", funny: "grappige momenten", fight: "gevechten" };
const kindName = (k: string) => KIND_NL[k] ?? k;

/** Is this archived video Milan's own rejection (with his reason)? */
export const milanRejected = (v: LearnVideo) => v.status === "archived" && !!v.note?.trim() && !SYSTEM.test(v.note.trim());

export function deriveLessons(input: { videos: LearnVideo[]; feedback: LearnFeedback[]; audio: LearnAudio[] }): Lesson[] {
  const out: Lesson[] = [];
  const channels = [...new Set([...input.videos.map((v) => v.channelId), ...input.feedback.map((f) => f.channelId), ...input.audio.map((a) => a.channelId)])];
  for (const ch of channels) {
    const vids = input.videos.filter((v) => v.channelId === ch && v.format !== "C");
    const fb = input.feedback.filter((f) => f.channelId === ch);
    const clipFeedback = new Set(fb.filter((f) => f.kinds.some((k) => k === "clip" || k === "opening")).map((f) => f.videoId));

    // 1. Kinds of moments Milan keeps rejecting (or calls the wrong clip): fewer of them become a Short.
    const kinds = [...new Set(vids.map((v) => v.momentKind).filter((k): k is string => !!k))];
    for (const k of kinds) {
      const of = vids.filter((v) => v.momentKind === k);
      const rejected = of.filter((v) => milanRejected(v) || clipFeedback.has(v.id));
      const approved = of.filter((v) => APPROVED.includes(v.status));
      if (rejected.length >= 2 && rejected.length >= approved.length) {
        const active = rejected.length >= 3;
        out.push({
          id: `minder:${ch ?? "alle"}:${k}`,
          channelId: ch,
          title: `Minder Shorts van ${kindName(k)}`,
          evidence: [`Je keurde ${rejected.length} van ${of.length} af (goedgekeurd: ${approved.length})`, ...rejected.slice(0, 3).map((v) => `"${(v.note ?? "verkeerde clip").slice(0, 60)}"`)],
          count: rejected.length,
          status: active ? "actief" : "voorstel",
          action: { type: "kind_boost", kind: k, boost: -15 },
        });
      } else if (approved.length >= 6 && rejected.length === 0) {
        out.push({ id: `meer:${ch ?? "alle"}:${k}`, channelId: ch, title: `${kindName(k)[0].toUpperCase()}${kindName(k).slice(1)} werken goed`, evidence: [`${approved.length} goedgekeurd, geen enkele afgekeurd`], count: approved.length, status: "actief", action: { type: "kind_boost", kind: k, boost: 5 } });
      }
    }

    // 2. The same remark coming back on different videos: a recurring problem.
    const byKind = new Map<FeedbackKind, Set<string>>();
    for (const f of fb) for (const k of f.kinds) byKind.set(k, new Set([...(byKind.get(k) ?? []), f.videoId]));
    for (const [k, set] of byKind) {
      if (set.size < 3 || k === "clip" || k === "other") continue;
      const payoff = k === "payoff";
      out.push({
        id: `terug:${ch ?? "alle"}:${k}`,
        channelId: ch,
        title: payoff ? "Uitkomst vaker te kort: elke Short houdt de uitkomst 1,5 s langer in beeld" : `Terugkerende opmerking: ${PROBLEM_NL[k]}`,
        evidence: [`Op ${set.size} verschillende video's gaf je deze feedback`],
        count: set.size,
        // Only a longer outcome is a safe change the studio makes by itself; the rest needs Milan's eye.
        status: payoff ? "actief" : "voorstel",
        action: payoff ? { type: "payoff_extra", ms: 1500 } : { type: "none" },
      });
    }

    // 3. The audio option Milan keeps choosing becomes the default for new montages of this channel.
    const au = input.audio.filter((a) => a.channelId === ch);
    if (au.length >= 3) {
      const top = <K extends "music" | "sfx">(key: K) => {
        const c = new Map<string, number>();
        for (const a of au) if (a[key]) c.set(a[key]!, (c.get(a[key]!) ?? 0) + 1);
        const best = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
        return best && best[1] / au.length >= 0.6 ? best : null;
      };
      const m = top("music");
      const s = top("sfx");
      if (m || s) {
        out.push({
          id: `audio:${ch ?? "alle"}`,
          channelId: ch,
          title: `Standaard audio: ${[m ? `muziek ${m[0]}` : null, s ? `effecten ${s[0]}` : null].filter(Boolean).join(", ")}`,
          evidence: [`Van je ${au.length} audiokeuzes: ${[m ? `${m[1]}× muziek ${m[0]}` : null, s ? `${s[1]}× effecten ${s[0]}` : null].filter(Boolean).join(", ")}`],
          count: au.length,
          status: "actief",
          action: { type: "audio_default", ...(m ? { music_pick: m[0] } : {}), ...(s ? { sfx_level: s[0] } : {}) },
        });
      }
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

const PROBLEM_NL: Record<FeedbackKind, string> = { clip: "verkeerde clip", opening: "zwakke opening", payoff: "payoff ontbreekt", crop: "slechte crop", timing: "timing", voice: "voice-over", captions: "captions", music: "muziek", other: "overig" };

/** Active lessons for one channel, minus the ones Milan switched off. */
export const activeFor = (lessons: Lesson[], channelId: string | null, off: string[] = []) => lessons.filter((l) => l.status === "actief" && !off.includes(l.id) && (l.channelId === channelId || l.channelId === null));

export function kindBoostFrom(active: Lesson[], kind: string): { boost: number; ids: string[] } {
  const hit = active.filter((l) => l.action.type === "kind_boost" && l.action.kind === kind);
  return { boost: hit.reduce((a, l) => a + (l.action.type === "kind_boost" ? l.action.boost : 0), 0), ids: hit.map((l) => l.id) };
}
export const payoffExtraFrom = (active: Lesson[]) => active.find((l) => l.action.type === "payoff_extra") ?? null;
export const audioDefaultFrom = (active: Lesson[]) => active.find((l) => l.action.type === "audio_default") ?? null;

/** What changed between two builds, for the version history ("nieuw", "vervallen", "sterker"). */
export function diffLessons(before: Lesson[], after: Lesson[]): string[] {
  const out: string[] = [];
  for (const l of after) {
    const old = before.find((x) => x.id === l.id);
    if (!old) out.push(`Nieuw: ${l.title} (${l.status})`);
    else if (old.status !== l.status) out.push(`${l.title}: ${old.status} → ${l.status}`);
  }
  for (const l of before) if (!after.some((x) => x.id === l.id)) out.push(`Vervallen: ${l.title}`);
  return out;
}

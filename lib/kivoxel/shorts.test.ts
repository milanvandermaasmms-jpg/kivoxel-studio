import { describe, expect, it } from "vitest";
import { hookFile, resolveSettings } from "./config";
import type { DeadSpan, EventTimeline, GameEvent } from "./events";
import { chooseHook, hookChecks, hookEvents, hookStyle, hookType, stripEmoji } from "./hookText";
import { bucketOf, lengthChecks, liveSpans, planShort, planShortBatch } from "./shortPlan";
import { seeded } from "./voiceScript";
import { buildAss } from "../youtube/render";

const settings = resolveSettings("standaard");
const size = { width: 1080, height: 1920 };
const ev = (id: string, peak: number, payoff = 80, type: GameEvent["type"] = "fail", kind: GameEvent["kind"] = "damage"): GameEvent => ({ id, kind, type, t_start: peak - 4000, t_peak: peak, t_end: peak + 3000, intensity: 0.8, payoff, description: id, t_thumb: peak - 300, sources: [] });
const tl = (events: GameEvent[], dead: DeadSpan[] = [], durationMs = 600_000): EventTimeline => ({ version: 1, durationMs, generatedAt: "", engine: "free", events, dead, health: [] });

describe("hook choice", () => {
  it("never repeats a hook within 10 Shorts", () => {
    const recent: string[] = [];
    const rnd = seeded("batch");
    for (let i = 0; i < 30; i++) {
      const { hook, repeated } = chooseHook("fail", recent, rnd);
      expect(repeated).toBe(false);
      expect(recent.slice(-10)).not.toContain(hook);
      recent.push(hook);
    }
  });
  it("only picks hooks of the real event type", () => {
    for (const t of ["fail", "bijna_dood", "geluk", "bouw", "grap", "jumpscare"] as const) {
      const { hook } = chooseHook(t, [], seeded(t));
      expect(hookType(hook)).toBe(t);
    }
  });
  it("when everything was used, the one used longest ago comes back and it says so", () => {
    const all = [...hookFile.hooks.grap];
    const r = chooseHook("grap", all, seeded("x"), all.length);
    expect(r.repeated).toBe(true);
    expect(r.hook).toBe(all[0]);
  });
  it("checks words, type, freshness and safe zone", () => {
    const ok = hookChecks("ONE HEART LEFT", "bijna_dood", [], settings);
    expect(ok.every((c) => c.ok)).toBe(true);
    const bad = hookChecks("THIS HOOK IS FAR TOO LONG", "bijna_dood", [], settings);
    expect(bad.find((c) => c.key === "hook_words")!.ok).toBe(false);
    expect(hookChecks("EPIC FAIL", "geluk", [], settings).find((c) => c.key === "hook_type")!.ok).toBe(false);
    expect(hookChecks("EPIC FAIL", "fail", ["EPIC FAIL"], settings).find((c) => c.key === "hook_fresh")!.ok).toBe(false);
  });
});

describe("hook animation", () => {
  it("pops in within 0.3 s and shakes at the payoff, in the brand yellow, in the safe zone", () => {
    const events = hookEvents("HE'S DONE 💀", 15_000, 12_000, size, settings);
    expect(events[0]).toContain("\\fscx30\\fscy30");
    expect(events[0]).toContain(`\\t(180,300,\\fscx100\\fscy100)`);
    expect(events[0]).toMatch(/0:00:00\.00,0:00:12\.00/);
    expect(events.filter((e) => e.includes("\\fscx108")).length).toBeGreaterThanOrEqual(6);
    expect(events.join("")).not.toMatch(/💀/);
    expect(events[0]).toContain("HE'S DONE");
    expect(hookStyle(size, settings)).toContain("Arial Black");
    expect(hookStyle(size, settings)).toContain("&H0000E5FF");
    const ass = buildAss({ size, topLine: "OLD", lines: [], durationMs: 15_000, hook: { style: hookStyle(size, settings), events } });
    expect(ass).toContain("Style: Hook,");
    expect(ass).not.toContain(",Top,,0,0,0,,OLD");
  });
  it("no shake without a payoff in the video", () => {
    expect(hookEvents("EPIC FAIL", 10_000, null, size, settings)).toHaveLength(1);
  });
  it("strips emoji that libass cannot draw", () => {
    expect(stripEmoji("NO WAY 😱")).toBe("NO WAY");
    expect(stripEmoji("SOUND ON 🔊")).toBe("SOUND ON");
  });
});

describe("Short length", () => {
  it("cuts dead parts but keeps the payoff whole", () => {
    const spans = liveSpans(100_000, 130_000, 125_000, [
      { startMs: 105_000, endMs: 108_000, why: "menu" },
      { startMs: 124_500, endMs: 126_000, why: "still" },
    ]);
    expect(spans).toEqual([
      { startMs: 100_000, endMs: 105_000 },
      { startMs: 108_000, endMs: 130_000 },
    ]);
  });

  it("takes the shortest complete length: a single moment becomes a loop", () => {
    const e = ev("a", 200_000);
    const p = planShort(e, tl([e]), settings, seeded("1"));
    expect(p.bucket).toBe("loop");
    expect(p.targetMs).toBeGreaterThanOrEqual(7000);
    expect(p.targetMs).toBeLessThanOrEqual(14_500);
    // 22-11-2026: the outcome gets at least 3.5 s after the peak (here the moment lasts 3 s, +0.8 s = 3.8 s).
    expect(p.segments.at(-1)!.src_end_ms).toBe(203_800);
    expect(p.segments.some((s) => s.part === "payoff")).toBe(true);
  });

  it("never twice the same bucket in a row, and exact lengths differ", () => {
    const events = [ev("a", 100_000, 90), ev("b", 200_000, 85), ev("c", 300_000, 80), ev("d", 400_000, 75), ev("e", 500_000, 70)];
    const batch = planShortBatch(tl(events), settings, seeded("batch"));
    expect(batch).toHaveLength(5);
    for (let i = 1; i < batch.length; i++) expect(batch[i].bucket).not.toBe(batch[i - 1].bucket);
    expect(new Set(batch.map((b) => b.targetMs)).size).toBe(5);
    for (const b of batch) expect(b.targetMs % 1000).not.toBe(0);
  });

  it("the story bucket only with a real build-up", () => {
    const lonely = ev("a", 200_000);
    const s = settings.shorts.length_buckets.find((b) => b.key === "verhaal")!;
    const forced = { ...settings, shorts: { ...settings.shorts, length_buckets: [s] } };
    expect(planShort(lonely, tl([lonely]), forced, seeded("1")).reason).toBe("kortste complete lengte (8.3 s)");
    const withBuildUp = [ev("x", 170_000, 40, "fail"), lonely];
    expect(planShort(lonely, tl(withBuildUp), settings, seeded("1"), "loop").bucket).not.toBe("loop");
  });

  it("starts in motion: a menu at the start is skipped", () => {
    const e = ev("a", 200_000);
    const p = planShort(e, tl([e], [{ startMs: 190_000, endMs: 195_400, why: "menu" }]), settings, seeded("2"), "loop");
    expect(p.segments[0].src_start_ms < 190_000 || p.segments[0].src_start_ms >= 195_400).toBe(true);
    expect(p.cutMs).toBeGreaterThanOrEqual(0);
  });

  it("an event right after the start runs on after the peak instead of becoming too short", () => {
    const early = { ...ev("early", 4000, 60, "bijna_dood", "low_health"), t_end: 12_000 };
    const p = planShort(early, tl([early]), settings, seeded("3"));
    expect(p.targetMs).toBeGreaterThanOrEqual(6500);
    expect(bucketOf(p.targetMs, settings.shorts.length_buckets)).not.toBeNull();
    // With at least 3.5 s after the peak (22-11-2026) the Short is complete without running on further.
    expect(p.segments.at(-1)!.src_end_ms - early.t_peak).toBeGreaterThanOrEqual(3500);
  });

  it("a moment that cannot fill any bucket is left out of the batch", () => {
    const tiny = { ...ev("tiny", 1500, 90), t_end: 1500 };
    const fine = ev("fine", 200_000, 80);
    const batch = planShortBatch(tl([tiny, fine], [], 300_000), settings, seeded("4"));
    expect(batch.map((b) => b.eventId)).toEqual(["fine"]);
  });

  it("orders the batch so a moment that can only be a loop does not break the variation", () => {
    const onlyLoop = { ...ev("onlyLoop", 6000, 50, "bijna_dood", "low_health"), t_end: 9000 };
    const flexible = ev("flexible", 300_000, 60);
    const batch = planShortBatch(tl([onlyLoop, flexible], [], 400_000), settings, seeded("5"), 5, "kort");
    expect(batch.map((b) => b.bucket)).toEqual(["loop", "kort"]);
    expect(batch[0].eventId).toBe("onlyLoop");
  });

  it("reports length checks", () => {
    expect(bucketOf(17_300, settings.shorts.length_buckets)!.key).toBe("kort");
    expect(lengthChecks(17_300, "kort", settings).find((c) => c.key === "length_varies")!.ok).toBe(false);
    expect(lengthChecks(17_300, "loop", settings).every((c) => c.ok)).toBe(true);
    expect(lengthChecks(70_000, null, settings)[0].ok).toBe(false);
  });
});

describe("honest hooks", () => {
  it("'GAME OVER' and 'HE'S DONE' only when he really dies", () => {
    for (let i = 0; i < 40; i++) {
      const { hook } = chooseHook("fail", [], seeded(`s${i}`));
      expect(hookFile.death_only).not.toContain(hook);
    }
    expect(hookChecks("GAME OVER 💀", "fail", [], settings, false).find((c) => c.key === "hook_type")!.ok).toBe(false);
    expect(hookChecks("GAME OVER 💀", "fail", [], settings, true).find((c) => c.key === "hook_type")!.ok).toBe(true);
  });
});

describe("de uitkomst krijgt ruimte (22-11-2026)", () => {
  it("at least 3.5 s after the peak, longer while the moment lasts, at most 6 s", async () => {
    const { aftermathMs } = await import("./shortPlan");
    const base = { id: "x", kind: "ai_moment", type: "zeldzaam", t_start: 0, t_peak: 10_000, intensity: 1, payoff: 80, description: "", t_thumb: 0, sources: [] } as unknown as Parameters<typeof aftermathMs>[0];
    expect(aftermathMs({ ...base, t_end: 10_500 })).toBe(3500);
    expect(aftermathMs({ ...base, t_end: 14_000 })).toBe(4800);
    expect(aftermathMs({ ...base, t_end: 30_000 })).toBe(6000);
    expect(aftermathMs({ ...base, kind: "death", t_end: 12_000 })).toBe(3000);
  });
});

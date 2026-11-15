import { describe, expect, it } from "vitest";
import { isEvent, isIdle, polishPlan, srcToOut } from "./editPolish.ts";
import type { Evidence, FramePick } from "./grounding.ts";
import type { Segment } from "./analysis.ts";

const seg = (src: number, len: number, out: number): Segment => ({ part: "build", src_start_ms: src, src_end_ms: src + len, out_start_ms: out, speed: 1, effects: [], note: "" });
const fact = (i: number, action: string, mobs: string[] = [], events: string[] = []) => ({ i, light: "night" as const, health: "not_visible" as const, mobs, action, events });

// A 45 s Short: menu at 5-10 s, idle walking at 20-25 s, an explosion at 32 s.
const segments = [seg(100_000, 45_000, 0)];
const frames: FramePick[] = [0, 5, 7.5, 10, 15, 20, 22.5, 25, 32, 40].map((s, index) => ({ index, srcMs: 100_000 + s * 1000, outMs: s * 1000, segment: 0 }));
const evidence: Evidence = {
  frames: [
    fact(0, "fighting", ["zombie"]),
    fact(1, "in inventory"),
    fact(2, "chest menu"),
    fact(3, "crafting menu"),
    fact(4, "running", ["zombie"]),
    fact(5, "walking"),
    fact(6, "walking"),
    fact(7, "walking"),
    fact(8, "running", ["creeper"], ["explosion"]),
    fact(9, "fighting", ["enderman"]),
  ],
  summary: "",
  uncertain: [],
};

describe("evidence-driven editor", () => {
  it("knows idle frames and events", () => {
    expect(isIdle(fact(0, "in inventory"))).toBe(true);
    expect(isIdle(fact(0, "walking", ["zombie"]))).toBe(false);
    expect(isEvent(fact(0, "running", ["creeper"], ["explosion"]))).toBe(true);
    expect(isEvent(fact(0, "menu", [], ["crafting menu opened"]))).toBe(false);
  });

  it("cuts menus and idle walking, zooms on the explosion, and keeps the evidence on the new timeline", () => {
    const p = polishPlan(segments, frames, evidence, "A");
    expect(p.removedMs).toBeGreaterThan(8000);
    expect(p.cuts.length).toBe(2);
    const zoomed = p.segments.filter((s) => s.effects.includes("zoom") || s.effects.includes("zoom_strong"));
    expect(zoomed.length).toBeGreaterThanOrEqual(1);
    expect(zoomed.some((s) => s.src_start_ms <= 132_000 && s.src_end_ms > 132_000)).toBe(true);
    // segments are contiguous on the output
    p.segments.reduce((out, s) => (expect(s.out_start_ms).toBe(out), out + (s.src_end_ms - s.src_start_ms)), 0);
    // menu frames are gone from the evidence, the explosion frame moved earlier
    expect(p.evidence.frames.map((f) => f.i)).not.toContain(2);
    const boom = p.frames.find((f) => f.index === 8)!;
    expect(boom.outMs).toBeLessThan(32_000);
    expect(srcToOut(p.segments, 132_000)).toBe(boom.outMs);
  });

  it("never cuts below the minimum length of the format", () => {
    const tiny = [seg(0, 16_000, 0)];
    const fr: FramePick[] = [2, 6, 10, 14].map((s, index) => ({ index, srcMs: s * 1000, outMs: s * 1000, segment: 0 }));
    const ev: Evidence = { frames: [fact(0, "walking"), fact(1, "walking"), fact(2, "walking"), fact(3, "walking")], summary: "", uncertain: [] };
    const p = polishPlan(tiny, fr, ev, "A");
    expect(p.segments.reduce((n, s) => n + (s.src_end_ms - s.src_start_ms), 0)).toBeGreaterThanOrEqual(12_000);
  });
});

import { planChanges } from "./qc.ts";
import { usableSegments } from "./render.ts";
describe("stronger montage", () => {
  it("gives the explosion a strong punch-in and other threats a normal zoom", () => {
    const p = polishPlan(segments, frames, evidence, "A");
    expect(p.punchIns).toBe(1);
    expect(p.segments.some((s) => s.effects.includes("zoom_strong") && s.src_start_ms <= 132_000 && s.src_end_ms > 132_000)).toBe(true);
  });
  it("renders a punch-in deeper than a zoom", () => {
    const [a, b] = usableSegments([{ ...segments[0], effects: ["zoom"] }, { ...segments[0], effects: ["zoom_strong"] }], 1_000_000);
    expect([a.crop, b.crop]).toEqual([0.8, 0.65]);
  });
  it("counts jump cuts and zoom changes from the plan", () => {
    const p = polishPlan(segments, frames, evidence, "A");
    expect(planChanges(p.segments)).toBeGreaterThanOrEqual(p.cuts.length + p.zooms);
    expect(p.cuts.length).toBe(2);
    expect(planChanges(segments)).toBe(0);
  });
});

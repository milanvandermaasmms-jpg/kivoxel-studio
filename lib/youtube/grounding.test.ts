import { describe, expect, it } from "vitest";
import { applyVerification, coverage, evidenceBatches, framePlan, groundingBlock, LONG_FRAME_EVERY_MS, longestSilenceMs, mergeEvidence, parseEvidence, targetWords, type Evidence } from "./grounding.ts";
import type { Segment } from "./analysis.ts";

const seg = (src: number, len: number, out: number, speed = 1): Segment => ({ part: "build", src_start_ms: src, src_end_ms: src + len, out_start_ms: out, speed, effects: [], note: "" });

describe("frames from the montage plan", () => {
  it("covers every segment and stays within the cap", () => {
    const plan = [seg(10_000, 30_000, 0), seg(100_000, 2_000, 30_000), seg(200_000, 400_000, 32_000)];
    const f = framePlan(plan, 10);
    expect(f.length).toBeLessThanOrEqual(10);
    expect(new Set(f.map((x) => x.segment))).toEqual(new Set([0, 1, 2]));
    expect(f.every((x, i) => x.index === i)).toBe(true);
    const second = f.find((x) => x.segment === 1)!;
    expect(second.srcMs).toBeGreaterThanOrEqual(100_000);
    expect(second.outMs).toBeGreaterThanOrEqual(30_000);
  });
  it("long videos get a frame per ~6 s, also in long segments, and batches renumber from 0", () => {
    // A 5:30 part: cold open of 15 s + two long chapters of 2:30.
    const plan = [seg(60_000, 15_000, 0), seg(0, 150_000, 15_000), seg(150_000, 165_000, 165_000)];
    const f = framePlan(plan, 180, LONG_FRAME_EVERY_MS);
    expect(f.length).toBeGreaterThanOrEqual(50);
    expect(f.filter((x) => x.segment === 1).length).toBe(25);
    const gaps = f.slice(1).map((x, i) => x.outMs - f[i].outMs);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(LONG_FRAME_EVERY_MS + 1000);
    const b = evidenceBatches(f, 40);
    expect(b.map((x) => x.frames.length)).toEqual([40, f.length - 40]);
    expect(b[1].offset).toBe(40);
    expect(b[1].frames[0]).toMatchObject({ index: 0, srcMs: f[40].srcMs });
  });
  it("merges batch evidence back to the frame numbers of the whole video", () => {
    const a: Evidence = { frames: [{ i: 0, light: "day", health: "full", mobs: [], action: "walking", events: [] }], summary: "Walks.", uncertain: ["x"] };
    const b: Evidence = { frames: [{ i: 2, light: "night", health: "full", mobs: ["zombie"], action: "fighting", events: [] }], summary: "Fights.", uncertain: ["x", "y"] };
    const m = mergeEvidence([{ offset: 40, evidence: b }, { offset: 0, evidence: a }]);
    expect(m.frames.map((f) => f.i)).toEqual([0, 42]);
    expect(m.summary).toBe("Walks. Fights.");
    expect(m.uncertain).toEqual(["x", "y"]);
  });
  it("maps sped-up segments to the right output time", () => {
    const [f] = framePlan([seg(0, 2000, 5000, 2)]);
    expect(f.outMs).toBe(5000 + f.srcMs / 2);
  });
});

const ev: Evidence = {
  frames: [
    { i: 0, light: "day", health: "not_visible", mobs: ["zombie"], action: "fighting", events: ["damage taken"] },
    { i: 1, light: "cave_lit", health: "not_visible", mobs: [], action: "mining", events: [] },
  ],
  summary: "A zombie attacks in daylight, then the player mines in a lit cave.",
  uncertain: ["health bar not readable"],
};

describe("evidence and rules", () => {
  it("keeps only valid frames and fixes unknown values", () => {
    const r = parseEvidence({ frames: [{ i: 0, light: "spooky", health: "1 heart", mobs: ["creeper"] }, { i: 1 }, { i: 2 }, { i: 99 }], summary: "x" }, 3);
    expect("error" in r).toBe(false);
    const ok = r as Evidence;
    expect(ok.frames).toHaveLength(3);
    expect(ok.frames[0]).toMatchObject({ light: "unknown", health: "not_visible", mobs: ["creeper"] });
    expect("error" in parseEvidence({ frames: [] }, 5)).toBe(true);
  });
  it("forbids hearts and darkness when the frames do not show them, and asks for enough words", () => {
    const b = groundingBlock(ev, [{ index: 0, srcMs: 0, outMs: 0, segment: 0 }, { index: 1, srcMs: 9000, outMs: 9000, segment: 0 }], "A", 35_000);
    expect(b).toMatch(/do NOT mention hearts/);
    expect(b).toMatch(/do NOT call it dark/);
    expect(b).toMatch(/about 64 words/);
    expect(b).toMatch(/0:09: light cave_lit/);
  });
  it("aims at most of a Short and about half of a long video", () => {
    expect(targetWords("A", 35_000)).toBe(64);
    expect(targetWords("C", 600_000)).toBe(780);
  });
});

describe("the check after writing", () => {
  const lines = [
    { at_ms: 0, text: "A zombie jumps in, and the fight is on!" },
    { at_ms: 4000, text: "Down to half a heart in the pitch black cave!" },
    { at_ms: 9000, text: "Pure invention that has no rewrite." },
  ];
  it("rewrites or drops unsupported lines and fixes the top line", () => {
    const v = applyVerification(lines, { lines: [{ index: 0, supported: true }, { index: 1, supported: false, issue: "health and darkness not visible", rewrite: "That zombie hits hard, but we keep swinging!" }, { index: 2, supported: false, issue: "not in the frames", rewrite: "" }], top_line: "ZOMBIE AMBUSH IN DAYLIGHT", hook: "" });
    expect(v.lines.map((l) => l.text)).toEqual(["A zombie jumps in, and the fight is on!", "That zombie hits hard, but we keep swinging!"]);
    expect(v).toMatchObject({ rewritten: 1, dropped: 1, topLine: "ZOMBIE AMBUSH IN DAYLIGHT", hook: null });
    expect(v.issues[0]).toMatch(/0:04/);
  });
  it("keeps everything when the answer is unusable", () => {
    expect(applyVerification(lines, null).lines).toHaveLength(3);
  });
  it("measures speaking time and the longest silence", () => {
    expect(Math.round(coverage(lines, 35_000) * 100)).toBe(27);
    expect(longestSilenceMs([{ at_ms: 0, text: "one two three" }], 35_000)).toBeGreaterThan(33_000);
  });
});

import { contentStrength, mergeAdded, silentGaps } from "./grounding.ts";
describe("moment keuring", () => {
  const f = (action: string, mobs: string[] = [], events: string[] = []) => ({ i: 0, light: "day" as const, health: "not_visible" as const, mobs, action, events });
  it("calls menus and idle digging weak", () => {
    const s = contentStrength({ frames: [f("walking"), f("in inventory"), f("chest menu"), f("digging dirt"), f("digging dirt")], summary: "", uncertain: [] });
    expect(s.verdict).toBe("weak");
    expect(s.reasons.join(" ")).toMatch(/menu/);
  });
  it("calls a fight with events strong", () => {
    const s = contentStrength({ frames: [f("fighting", ["zombie"], ["damage taken"]), f("fighting", ["zombie", "skeleton"]), f("running", ["creeper"], ["explosion"]), f("eating")], summary: "", uncertain: [] });
    expect(s.verdict).toBe("strong");
  });
});
describe("filling silence", () => {
  const lines = [{ at_ms: 0, text: "one two three four five" }, { at_ms: 20_000, text: "six seven" }];
  it("finds the long gaps", () => {
    expect(silentGaps(lines, 35_000, 3000)).toEqual([[1923, 20_000], [20_769, 35_000]]);
  });
  it("only adds lines that fall inside a gap", () => {
    const gaps: [number, number][] = [[2000, 20_000]];
    const merged = mergeAdded(lines, { lines: [{ at_ms: 8000, text: "New supported line" }, { at_ms: 21_000, text: "outside" }, { at_ms: 9000, text: "" }] }, gaps, 35_000);
    expect(merged.map((l) => l.text)).toEqual(["one two three four five", "New supported line", "six seven"]);
  });
});

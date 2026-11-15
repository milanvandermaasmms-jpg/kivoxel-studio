import { describe, expect, it } from "vitest";
import { applyVerification, coverage, framePlan, groundingBlock, longestSilenceMs, parseEvidence, targetWords, type Evidence } from "./grounding.ts";
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

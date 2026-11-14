import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calmEndFrame, clipCents, FRAME_MODE_MAX_S, judgeClip, planClips, seamlessLoopArgs } from "./motion";

const motion = JSON.parse(readFileSync("content/dreamnest/shots/fase2-motion.json", "utf8")) as { shot: string; motion: string; loop?: string }[];

describe("clip plan", () => {
  const clips = planClips(motion);
  it("links every keyframe to the next one, and makes loops that start and end on the same frame", () => {
    expect(clips.filter((c) => c.kind === "story")).toHaveLength(motion.length - 1);
    for (const c of clips.filter((c) => c.kind === "loop")) expect(c.first).toBe(c.last);
    expect(clips.filter((c) => c.kind === "loop").length).toBeGreaterThanOrEqual(4);
  });
  it("stays within the first/last-frame limit and asks for calm, silent, text-free motion", () => {
    for (const c of clips) {
      expect(c.durationS).toBeLessThanOrEqual(FRAME_MODE_MAX_S);
      expect(c.prompt).toMatch(/No cuts, no flashes/);
      expect(c.prompt).toMatch(/No text/);
    }
  });
  it("fits the proposed fase 2 budget at 1080p, even if every clip is made twice", () => {
    const cents = clips.reduce((s, c) => s + clipCents(c.durationS, "1080p"), 0);
    expect(cents * 2).toBeLessThanOrEqual(3000);
  });
});

describe("seam repair", () => {
  it("cross-fades the last second into the first, so an 8 s clip becomes a 7 s seamless loop", () => {
    const args = seamlessLoopArgs("in.mp4", "out.mp4", 8);
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("trim=start=1:end=8");
    expect(filter).toContain("xfade=transition=fade:duration=1:offset=6");
    expect(args).toContain("-an");
  });
  it("refuses a clip that is too short", () => {
    expect(() => seamlessLoopArgs("a", "b", 1.5)).toThrow();
  });
});

describe("own-scene part of a story clip", () => {
  const n = 192;
  const vsFirst = Array.from({ length: n }, (_, i) => 1 - i / n);
  const vsLast = Array.from({ length: n }, (_, i) => 0.4 + (0.6 * i) / n);
  it("stops where the clip starts to look more like the next scene", () => {
    expect(calmEndFrame(vsFirst, vsLast, [], 60)).toBe(72);
  });
  it("stops before a hard cut, but keeps a minimum", () => {
    const steps = Array.from({ length: n }, (_, i) => (i === 50 ? 0.4 : 0.99));
    expect(calmEndFrame(vsFirst, vsLast, steps, 30)).toBe(50);
    expect(calmEndFrame(vsFirst, vsLast, steps, 60)).toBe(60);
  });
});

describe("baby-safe check", () => {
  const calm = { durationS: 8, fps: 24, luma: Array.from({ length: 192 }, (_, i) => 80 + Math.sin(i / 30) * 3), seamSsim: 0.98 };
  it("passes a calm loop with an invisible seam", () => {
    expect(judgeClip(calm, "loop")).toMatchObject({ ok: true, problems: [] });
  });
  it("blocks a flash, a too bright frame and a visible seam", () => {
    const luma = [...calm.luma];
    luma[50] = 140;
    expect(judgeClip({ ...calm, luma }, "story").problems.join()).toMatch(/flits/);
    expect(judgeClip({ ...calm, luma: [...calm.luma, 230] }, "story").problems.join()).toMatch(/te fel/);
    expect(judgeClip({ ...calm, seamSsim: 0.8 }, "loop").problems.join()).toMatch(/naad/);
  });
  it("accepts a seam that is no bigger than a normal step between two frames", () => {
    expect(judgeClip({ ...calm, seamSsim: 0.94, stepSsim: 0.95 }, "loop").ok).toBe(true);
    expect(judgeClip({ ...calm, seamSsim: 0.85, stepSsim: 0.95 }, "loop").ok).toBe(false);
  });
  it("blocks a hard cut but allows a soft cross-fade", () => {
    expect(judgeClip({ ...calm, minStepSsim: 0.41 }, "story").problems.join()).toMatch(/harde knip/);
    expect(judgeClip({ ...calm, minStepSsim: 0.83 }, "story").ok).toBe(true);
  });
  it("a story clip needs no seam", () => {
    expect(judgeClip({ ...calm, seamSsim: null }, "story").ok).toBe(true);
  });
});

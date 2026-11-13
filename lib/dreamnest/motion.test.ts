import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clipCents, FRAME_MODE_MAX_S, judgeClip, planClips } from "./motion";

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
  it("a story clip needs no seam", () => {
    expect(judgeClip({ ...calm, seamSsim: null }, "story").ok).toBe(true);
  });
});

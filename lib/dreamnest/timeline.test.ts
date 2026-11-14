import { describe, expect, it } from "vitest";
import { buildTimeline, dimAt, dimFilter, episodeLength, PARTS, planPieces, type Asset } from "./timeline";

const ids = ["b01-welcome-exterior", "b02-lumi-rocking-chair", "b03-pip-arrives", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep"];
const loops = ["b02-lumi-rocking-chair", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
const assets: Asset[] = [...ids.map((k) => ({ id: `story-${k}`, kind: "story" as const, lengthS: 6 })), ...loops.map((k) => ({ id: `loop-${k}`, kind: "loop" as const, lengthS: 8.75 }))];

describe("timeline of a 60 minute episode", () => {
  const segs = buildTimeline(assets, 60);
  it("is exactly the asked length", () => {
    expect(episodeLength(segs)).toBeCloseTo(3600, 0);
    expect(episodeLength(buildTimeline(assets, 90))).toBeCloseTo(5400, 0);
  });
  it("follows welcome -> story -> falling asleep -> sleep -> outro, at the right times", () => {
    const at = (p: string) => segs.find((s) => s.part === p)!.startS;
    expect(at("welcome")).toBe(0);
    expect(at("story")).toBeLessThanOrEqual(PARTS.welcomeEnd + 1);
    expect(at("falling_asleep")).toBeCloseTo(PARTS.storyEnd, -1);
    expect(at("sleep")).toBeCloseTo(PARTS.asleepEnd, -1);
    expect(segs.at(-1)!.part).toBe("outro");
  });
  it("changes the sleep view every 4-8 minutes, never twice the same in a row", () => {
    const sleep = segs.filter((s) => s.part === "sleep");
    for (const s of sleep.slice(0, -1)) expect(s.lengthS).toBeGreaterThanOrEqual(240);
    for (const s of sleep) expect(s.lengthS).toBeLessThanOrEqual(480);
    for (let i = 1; i < segs.length; i++) expect(segs[i].asset).not.toBe(segs[i - 1].asset);
  });
  it("uses slow cross-fades: 6 s after the welcome, 3 s in the story, 5 s later", () => {
    for (const s of segs.slice(0, -1)) expect(s.xfadeS).toBe(s.part === "welcome" ? 6 : s.part === "story" ? 3 : 5);
  });
});

describe("render pieces", () => {
  const segs = buildTimeline(assets, 60);
  const pieces = planPieces(segs);
  it("cover the whole episode without gaps or overlaps", () => {
    let t = 0;
    for (const p of pieces) {
      expect(p.globalS).toBeCloseTo(t, 6);
      t += p.lengthS;
    }
    expect(t).toBeCloseTo(episodeLength(segs), 6);
  });
  it("are at most 2 minutes, so a render can resume", () => {
    for (const p of pieces) expect(p.lengthS).toBeLessThanOrEqual(120);
    expect(pieces.filter((p) => p.kind === "transition")).toHaveLength(segs.length - 1);
  });
});

describe("dimming", () => {
  it("is off in the story, slowly darker while sleeping, near black only in the outro", () => {
    expect(dimAt(100, 3600)).toBe(0);
    expect(dimAt(1800, 3600)).toBeGreaterThan(0.1);
    expect(dimAt(3400, 3600)).toBeLessThanOrEqual(0.45);
    expect(dimAt(3600, 3600)).toBeCloseTo(0.9);
  });
  it("never changes faster than a slow fade", () => {
    for (let t = 0; t < 3600; t += 10) expect(Math.abs(dimAt(t + 10, 3600) - dimAt(t, 3600))).toBeLessThan(0.05);
  });
  it("makes an FFmpeg filter per piece", () => {
    expect(dimFilter(2000, 120, 3600)).toMatch(/^eq=eval=frame/);
  });
});

import { describe, expect, it } from "vitest";
import { buildEpisodeTimeline, episodeLength, PARTS, planPieces, STORY_ORDER, type AssetV2 } from "./timeline";

const loops = ["b02-lumi-rocking-chair", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
const stills = ["b02-lumi-rocking-chair", "b03-pip-arrives", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
// Story clips at their own speed: some long enough (>= 5 s), some too short (then only the loop or still is used).
const storyLen: Record<string, number> = { "b01-welcome-exterior": 42, "b02-lumi-rocking-chair": 4.7, "b03-pip-arrives": 6, "b04-tea": 3.9, "b05-mo-by-fire": 5.2, "b06-window-momo": 3.7, "b07-lumi-yawn": 6.5, "b08-blanket-together": 4.2, "b09-lumi-falls-asleep": 2.8 };
const assets: AssetV2[] = [
  ...STORY_ORDER.map((k) => ({ id: `story-${k}`, kind: "story" as const, lengthS: storyLen[k] })),
  ...loops.map((k) => ({ id: `loop-${k}`, kind: "loop" as const, lengthS: 8.75 })),
  ...stills.map((k) => ({ id: `still-${k}`, kind: "still" as const, lengthS: 500 })),
];
const view = (id: string) => id.replace(/^(story|loop|still)-/, "");

describe("episode timeline v2 (crisp motion)", () => {
  for (const min of [60, 90]) {
    const segs = buildEpisodeTimeline(assets, min);
    it(`${min} min: exact length, parts at the right time, every segment outlasts its cross-fades`, () => {
      expect(episodeLength(segs)).toBeCloseTo(min * 60, 0);
      const at = (p: string) => segs.find((s) => s.part === p)!.startS;
      expect(at("falling_asleep")).toBeGreaterThan(PARTS.storyEnd - 30);
      expect(at("falling_asleep")).toBeLessThan(PARTS.storyEnd + 30);
      expect(at("sleep")).toBeCloseTo(PARTS.asleepEnd, -1);
      segs.forEach((s, i) => expect(s.lengthS).toBeGreaterThan((i > 0 ? segs[i - 1].xfadeS : 0) + (i < segs.length - 1 ? s.xfadeS : 0)));
      const pieces = planPieces(segs);
      let t = 0;
      for (const p of pieces) {
        expect(p.globalS).toBeCloseTo(t, 6);
        t += p.lengthS;
      }
    });
    it(`${min} min: story clips only at their own length (never stretched), short ones left out`, () => {
      for (const s of segs.filter((x) => x.asset.startsWith("story-") && x.part === "story")) {
        expect(s.lengthS).toBeLessThanOrEqual(storyLen[view(s.asset)] + 1e-9);
        expect(s.lengthS).toBeGreaterThanOrEqual(4);
      }
      expect(segs.some((s) => s.asset === "story-b09-lumi-falls-asleep")).toBe(false);
      expect(segs.some((s) => s.asset === "story-b02-lumi-rocking-chair")).toBe(false); // right after the welcome
      for (const k of ["b03-pip-arrives", "b05-mo-by-fire", "b07-lumi-yawn", "b08-blanket-together"]) expect(segs.some((s) => s.asset === `story-${k}`)).toBe(true);
      // Short story moments get soft 1.5 s cross-fades on both sides, never a cut.
      segs.forEach((s, i) => { if (s.asset.startsWith("story-") && s.part === "story") { expect(s.xfadeS).toBe(1.5); expect(segs[i - 1].xfadeS).toBe(1.5); } });
    });
    it(`${min} min: sleep alternates still and loop, never the same view twice in a row, loops kept short`, () => {
      const sleep = segs.filter((s) => s.part === "sleep");
      // A story clip flows into its own scene's loop or still on purpose; everywhere else the view changes.
      for (let i = 1; i < segs.length; i++) if (!segs[i - 1].asset.startsWith("story-")) expect(view(segs[i].asset)).not.toBe(view(segs[i - 1].asset));
      for (let i = 1; i < sleep.length; i++) expect(sleep[i].asset.split("-")[0]).not.toBe(sleep[i - 1].asset.split("-")[0]);
      for (const s of sleep.slice(0, -1)) {
        if (s.asset.startsWith("loop-")) expect(s.lengthS).toBeLessThanOrEqual(180);
        else expect(s.lengthS).toBeLessThanOrEqual(420);
      }
    });
  }
});

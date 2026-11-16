import { describe, expect, it } from "vitest";
import { arrange, KERST_MELODIES } from "./music";
import { planCues } from "./setlist";
import { buildKerstTimeline, episodeLength, KERST_X, planPieces, type AssetV2 } from "./timeline";

const views = ["b02-lumi-rocking-chair", "b05-mo-by-fire", "b06-window-momo", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
const assets: AssetV2[] = [
  { id: "story-b01-welcome-exterior", kind: "story", lengthS: 40 },
  ...views.map((v) => ({ id: `loop-${v}`, kind: "loop" as const, lengthS: 7 })),
  ...views.map((v) => ({ id: `still-${v}`, kind: "still" as const, lengthS: 430 })),
];

describe("Dreamnest kerst timeline", () => {
  const segs = buildKerstTimeline(assets, 60, 11);
  it("is exactly an hour and starts on the moving welcome", () => {
    expect(Math.round(episodeLength(segs))).toBe(3600);
    expect(segs[0].asset).toBe("story-b01-welcome-exterior");
  });
  it("uses no short AI story moments and only long, soft cross-fades", () => {
    expect(segs.some((s) => s.asset.startsWith("story-") && s.part !== "welcome")).toBe(false);
    expect(Math.min(...segs.slice(0, -1).map((s) => s.xfadeS))).toBeGreaterThanOrEqual(KERST_X.story);
  });
  it("the story part moves (loops only) and never shows the same view twice in a row", () => {
    expect(segs.filter((s) => s.part === "story").every((s) => s.asset.startsWith("loop-"))).toBe(true);
    for (let i = 1; i < segs.length; i++) expect(segs[i].asset.replace(/^(loop|still|story)-/, "")).not.toBe(segs[i - 1].asset.replace(/^(loop|still|story)-/, ""));
  });
  it("every segment outlasts its cross-fades, so the pieces plan", () => {
    for (const [i, s] of segs.entries()) expect(s.lengthS).toBeGreaterThan((i ? segs[i - 1].xfadeS : 0) + s.xfadeS);
    expect(planPieces(segs).length).toBeGreaterThan(10);
  });
});

describe("Dreamnest kerst music", () => {
  it("Silent Night is complete (whole bars) and arranges", () => {
    const m = KERST_MELODIES[0];
    expect(m.notes.reduce((s, n) => s + n[1], 0) % m.beatsPerBar).toBe(0);
    expect(arrange(m, 60, { lead: "celesta" }).events.length).toBeGreaterThan(40);
  });
  it("the story starts with the carol and uses no music box when asked", () => {
    const cues = planCues("story", 370, 11, { themes: KERST_MELODIES, leads: { story: ["celesta", "felt", "harp"] } });
    expect(cues[0].melody.id).toBe("stille-nacht");
    expect(cues.some((c) => c.lead === "musicbox")).toBe(false);
  });
});

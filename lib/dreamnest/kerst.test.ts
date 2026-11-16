import { describe, expect, it } from "vitest";
import { arrange, KERST_MELODIES } from "./music";
import { planCues } from "./setlist";
import { buildKerstTimeline, episodeLength, KERST_BAR_S, KERST_X, planPieces, type AssetV2 } from "./timeline";

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

describe("Dreamnest kerst: only Christmas music", () => {
  it("every carol is whole bars and arranges", () => {
    for (const m of KERST_MELODIES) {
      expect(m.notes.reduce((s, n) => s + n[1], 0) % m.beatsPerBar, m.id).toBe(0);
      expect(arrange(m, 56, { lead: "celesta", second: "bells", style: "answer" }).events.some((e) => e.instrument === "bells"), m.id).toBe(true);
    }
    expect(KERST_MELODIES.map((m) => m.id)).toEqual(["stille-nacht", "jingle-bells", "deck-the-halls", "we-wish-you"]);
  });
  it("story, falling asleep and sleep play only carols (no composed songs), soft instruments", () => {
    const o = { themes: KERST_MELODIES, themesOnly: true, leads: { story: ["celesta", "felt", "harp"] as const, falling_asleep: ["felt", "celesta"] as const, sleep: ["felt", "harp"] as const }, second: ["bells", "celesta"] as const };
    for (const part of ["story", "falling_asleep", "sleep"] as const) {
      const cues = planCues(part, 1200, 11, o as never);
      expect(cues.every((c) => KERST_MELODIES.some((m) => m.id === c.melody.id)), part).toBe(true);
      expect(cues.some((c) => c.lead === "musicbox")).toBe(false);
    }
  });
});

describe("Dreamnest kerst: reference quality (Milan, 16-11-2026)", () => {
  it("sleep part: only stills (no shimmering AI loops), long scenes, slow cross-fades", () => {
    const segs = buildKerstTimeline(assets, 60, 11);
    const sleep = segs.filter((s) => s.part === "sleep");
    expect(sleep.every((s) => s.asset.startsWith("still-"))).toBe(true);
    expect(sleep.slice(0, -1).every((s) => s.lengthS >= 600)).toBe(true);
    expect(sleep.every((s) => s.xfadeS >= 4)).toBe(true);
  });
});

describe("Dreamnest kerst D0: friends come in on screen, transitions on the bar", () => {
  const withClips: AssetV2[] = [
    ...assets,
    { id: "still-b03-pip-arrives", kind: "still", lengthS: 430 },
    ...["b02-lumi-rocking-chair", "b03-pip-arrives", "b05-mo-by-fire", "b08-blanket-together"].map((v) => ({ id: `story-${v}`, kind: "story" as const, lengthS: 8 })),
  ];
  const segs = buildKerstTimeline(withClips, 60, 11);
  it("the story shows Pip coming in, Mo coming in, everyone together, Lumi falling asleep", () => {
    const story = segs.filter((s) => s.part === "story").map((s) => s.asset);
    expect(story.filter((a) => a.startsWith("story-"))).toEqual(["story-b02-lumi-rocking-chair", "story-b03-pip-arrives", "story-b05-mo-by-fire", "story-b08-blanket-together"]);
    // A story clip never plays longer than the clip itself.
    for (const s of segs.filter((x) => x.asset.startsWith("story-b0") && x.part === "story")) expect(s.lengthS).toBeLessThanOrEqual(8);
  });
  it("every cross-fade in the story starts on a bar line of the music", () => {
    for (const s of segs.filter((x) => x.part !== "sleep" && x.part !== "outro" && x.part !== "falling_asleep")) {
      const start = s.startS + s.lengthS - s.xfadeS;
      expect(Math.abs(start / KERST_BAR_S - Math.round(start / KERST_BAR_S))).toBeLessThan(1e-6);
    }
    expect(Math.round(episodeLength(segs))).toBe(3600);
    expect(KERST_X.story).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { buildViral, cutPlan, rewriteNote, deadInOutput, firstSentence, gameplayPart, isoSeconds, parseListen, scriptPart, summarizeReference, voicePart, type ViralInput } from "./viral";
import { outcomes, whatWorks, type CheckRow, type Snap } from "./viralInsights";

const seg = (src: number, len: number, out: number): Segment => ({ part: "build", src_start_ms: src, src_end_ms: src + len, out_start_ms: out, speed: 1, effects: [], note: "" }) as Segment;
const base = (over: Partial<ViralInput> = {}): ViralInput => ({
  kind: "short",
  language: "en",
  audience: "kids 8-12",
  hook: "Three creepers, one heart left!",
  lines: [
    { at_ms: 0, text: "Three creepers, one heart left!" },
    { at_ms: 4000, text: "I run into the cave and hope for the best." },
    { at_ms: 9000, text: "Then the ground starts shaking under my feet." },
    { at_ms: 14000, text: "Wait, is that a diamond right there?" },
    { at_ms: 19000, text: "I grab it and sprint back to the surface." },
    { at_ms: 24000, text: "Would you have made it out alive?" },
  ],
  loopLine: "And that is why I never mine at night.",
  segments: [seg(0, 6000, 0), seg(10_000, 6000, 6000), seg(20_000, 6000, 12_000), seg(30_000, 6000, 18_000), seg(40_000, 8000, 24_000)],
  durationMs: 25_000,
  width: 1080,
  height: 1920,
  voiceName: "en-US-Chirp3-HD-Charon",
  speakingRate: 1.1,
  previousVoices: ["en-US-Chirp3-HD-Charon"],
  dead: [],
  peaks: [{ atMs: 12_000, loudness: -10, rise: 8 }],
  ...over,
});

describe("script part", () => {
  it("praises a fast hook and good pacing", () => {
    const { part, f } = scriptPart(base());
    expect(part.score).toBeGreaterThanOrEqual(9);
    expect(f.firstLineMs).toBe(0);
    expect(part.good.join(" ")).toContain("Sterke start");
  });
  it("flags a late hook and a long silence with timestamps", () => {
    const { part } = scriptPart(base({ hook: "", lines: [{ at_ms: 5000, text: "So here we go." }, { at_ms: 25_000, text: "Done." }] }));
    expect(part.score).toBeLessThan(7);
    expect(part.fixes[0]).toMatchObject({ fromMs: 0, toMs: 3000, auto: "rewrite" });
    expect(part.fixes.some((x) => x.text.startsWith("0:05–0:25"))).toBe(true);
  });
});

describe("gameplay part", () => {
  it("finds dead footage inside the montage and proposes to cut it", () => {
    const dead = [{ startMs: 21_000, endMs: 25_000, kind: "afk" as const }];
    expect(deadInOutput(base().segments, dead)).toEqual([{ fromMs: 13_000, toMs: 17_000, kind: "afk", src: [21_000, 25_000] }]);
    const { part, f } = gameplayPart(base({ dead }), null);
    expect(part.fixes[0]).toMatchObject({ fromMs: 13_000, toMs: 17_000, auto: "cut" });
    expect(f.deadShare).toBeGreaterThan(0);
  });
  it("a landscape Short is a big problem", () => {
    expect(gameplayPart(base({ width: 1920, height: 1080 }), null).part.fixes[0].text).toContain("niet verticaal");
  });
  it("names a thumbnail moment at the loudest peak", () => {
    expect(gameplayPart(base(), null).part.good.join(" ")).toContain("Thumbnail-moment: rond 0:08");
  });
});

describe("voice part", () => {
  it("checks language, consistency and speaking rate", () => {
    expect(voicePart(base()).part.score).toBe(10);
    const wrong = voicePart(base({ voiceName: "nl-NL-Chirp3-HD-Charon", previousVoices: ["en-US-Chirp3-HD-Puck"], speakingRate: 0.9 }));
    expect(wrong.part.score).toBeLessThan(5);
    expect(wrong.f.voiceSameAsBefore).toBe(false);
    expect(voicePart(base({ voiceName: null })).part.score).toBe(3);
  });
});

describe("listening check and total", () => {
  it("parses the Gemini answer and keeps times inside the video", () => {
    const r = parseListen({ energy: 8, script: { score: 6, good: ["Spannend"], fixes: [{ from: "0:12", to: "0:25", text: "te traag, inkorten" }, { from: "9:00", to: "9:10", text: "buiten de video" }] } }, 30_000);
    if ("error" in r) throw new Error(r.error);
    expect(r.energy).toBe(8);
    expect(r.parts.script!.fixes[0]).toEqual({ fromMs: 12_000, toMs: 25_000, text: "te traag, inkorten", auto: "rewrite" });
    expect(r.parts.script!.fixes[1].fromMs).toBeNull();
    expect("error" in parseListen({}, 1000)).toBe(true);
  });
  it("combines rules and listening; the overall score stays between 1 and 10", () => {
    const v = buildViral(base(), { energy: 4, parts: { voice: { score: 4, good: [], fixes: [{ fromMs: null, toMs: null, text: "Stem klinkt vlak" }] } } }, null);
    expect(v.parts.voice.score).toBe(7);
    expect(v.parts.voice.fixes.map((f) => f.text)).toContain("Stem klinkt vlak");
    expect(v.overall).toBeGreaterThanOrEqual(1);
    expect(v.overall).toBeLessThanOrEqual(10);
    expect(v.features.aiEnergy).toBe(4);
  });
});

describe("reference videos", () => {
  it("summarizes what works in the niche", () => {
    const vids = [1, 2, 3, 4].map((n) => ({ title: `Minecraft creeper trap ${n}`, tags: [], duration_s: 30 + n, is_short: true, published_at: "2026-11-10T17:00:00Z", views: n * 1000, ratio: n, hook: null }));
    const s = summarizeReference(vids, "short")!;
    expect(s.count).toBe(4);
    expect(s.bestHours).toEqual([18]);
    expect(s.topWords).toContain("creeper");
    expect(s.examples[0].title).toBe("Minecraft creeper trap 4");
    expect(summarizeReference(vids, "long")).toBeNull();
    const doubled = [...vids, ...vids].map((v, n) => ({ ...v, youtube_video_id: `id${n % 4}`, title: `${v.title} #minecraftshorts #creeper` }));
    const d = summarizeReference(doubled, "short")!;
    expect(d.count).toBe(4);
    expect(d.topWords).not.toContain("#minecraftshorts");
    expect(d.topWords).toContain("#creeper");
  });
  it("reads durations and first sentences", () => {
    expect(isoSeconds("PT1M5S")).toBe(65);
    expect(firstSentence("I survived 100 days! Here is how.\nhttps://x.y")).toBe("I survived 100 days!");
  });
});

describe("what works on this channel", () => {
  const f = (over: object) => ({ ...buildViral(base(), null, null).features, ...over });
  const check = (id: string, overall: number, over: object): CheckRow => ({ video_id: id, overall, features: f(over), created_at: "2026-11-01T00:00:00Z" });
  const snaps = (yt: string, views7d: number): Snap[] => [
    { youtube_video_id: yt, taken_at: "2026-11-01T10:00:00Z", published_at: "2026-11-01T09:00:00Z", views: 1, avg_view_pct: null },
    { youtube_video_id: yt, taken_at: "2026-11-02T10:00:00Z", published_at: "2026-11-01T09:00:00Z", views: views7d / 2, avg_view_pct: 70 },
    { youtube_video_id: yt, taken_at: "2026-11-08T10:00:00Z", published_at: "2026-11-01T09:00:00Z", views: views7d, avg_view_pct: 65 },
  ];
  it("takes the numbers after 24 hours and 7 days", () => {
    const o = outcomes([check("a", 8, {})], [{ video_id: "a", youtube_video_id: "ya", title: "A" }], snaps("ya", 400));
    expect(o[0]).toMatchObject({ predicted: 8, views24h: 200, views7d: 400, avgViewPct: 65 });
  });
  it("says what works only with enough videos, and how good the prediction is", () => {
    const checks = [check("a", 9, { firstLineMs: 0 }), check("b", 8, { firstLineMs: 200 }), check("c", 5, { firstLineMs: 4000 }), check("d", 4, { firstLineMs: 3000 })];
    const pubs = ["a", "b", "c", "d"].map((id) => ({ video_id: id, youtube_video_id: `y${id}`, title: id }));
    const all = [...snaps("ya", 900), ...snaps("yb", 700), ...snaps("yc", 200), ...snaps("yd", 100)];
    const w = whatWorks(outcomes(checks, pubs, all));
    expect(w.enough).toBe(true);
    expect(w.insights[0].text).toContain("Shorts met de hook binnen de eerste seconde kregen gemiddeld 5,3× zoveel views");
    expect(w.scoreMatches).toContain("klopt tot nu toe");
    expect(whatWorks(outcomes(checks.slice(0, 2), pubs, all)).enough).toBe(false);
  });
});

describe("automatisch verbeteren", () => {
  it("cuts a dead part out of the plan and moves the narration with the picture", () => {
    const segs = [seg(0, 6000, 0), seg(10_000, 6000, 6000), seg(20_000, 6000, 12_000)];
    const lines = [{ at_ms: 0, text: "a" }, { at_ms: 13_000, text: "b" }, { at_ms: 16_000, text: "c" }];
    const r = cutPlan(segs, lines, [[21_000, 24_000]]);
    expect(r.removedMs).toBe(3000);
    expect(r.segments.map((x) => [x.src_start_ms, x.src_end_ms, x.out_start_ms])).toEqual([[0, 6000, 0], [10_000, 16_000, 6000], [20_000, 21_000, 12_000], [24_000, 26_000, 13_000]]);
    expect(r.lines.map((l) => l.at_ms)).toEqual([0, 13_000, 13_000]);
  });
  it("the dead-part fix carries the recording range to cut", () => {
    const dead = [{ startMs: 21_000, endMs: 25_000, kind: "afk" as const }];
    expect(gameplayPart(base({ dead }), null).part.fixes[0].src).toEqual([21_000, 25_000]);
  });
  it("turns the script fixes into a note for the AI", () => {
    const v = buildViral(base({ hook: "", lines: [{ at_ms: 5000, text: "So here we go." }] }), null, null);
    expect(rewriteNote(v)).toMatch(/^Viral-check: 0:00-0:03: In de eerste 3 seconden/);
    expect(rewriteNote(v).length).toBeLessThanOrEqual(500);
  });
});

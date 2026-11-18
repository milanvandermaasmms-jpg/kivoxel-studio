import { describe, expect, it } from "vitest";
import type { Segment } from "../youtube/analysis";
import { renderArgs } from "../youtube/render";
import { captionEvents, captionLayout, chunks, timedFromSpoken, wordTimes } from "./captions";
import { resolveSettings } from "./config";
import type { EventTimeline, GameEvent } from "./events";
import { balancedSum, freezeFilter, interruptFilter, interruptSfx, longestQuiet, planFreezes, planInterrupts } from "./interrupts";
import { chapters, cutDeadInPlan, deadInMontage, firstFrameMoves } from "./longPlan";
import { planShort } from "./shortPlan";
import { freeScript, seeded, sourceToOut } from "./voiceScript";

const settings = resolveSettings("standaard");
const size = { width: 1080, height: 1920 };
const seg = (part: Segment["part"], a: number, b: number, out: number, speed = 1): Segment => ({ part, src_start_ms: a, src_end_ms: b, out_start_ms: out, speed, effects: [], note: "" });
const ev = (id: string, peak: number, payoff = 80, type: GameEvent["type"] = "fail", kind: GameEvent["kind"] = "damage"): GameEvent => ({ id, kind, type, t_start: peak - 4000, t_peak: peak, t_end: peak + 3000, intensity: 0.8, payoff, description: id, t_thumb: peak, sources: [] });
const tl = (events: GameEvent[], dead: EventTimeline["dead"] = []): EventTimeline => ({ version: 1, durationMs: 900_000, generatedAt: "", engine: "free", events, dead, health: [] });

describe("word-by-word captions", () => {
  it("times words by their length and cuts chunks of at most 3 words, breaking on punctuation", () => {
    const words = wordTimes({ startMs: 1000, endMs: 3000, text: "Don't jump. DON'T JUMP!" });
    expect(words[0].startMs).toBe(1000);
    expect(words.at(-1)!.endMs).toBe(3000);
    expect(chunks(words).map((c) => c.map((w) => w.text).join(" "))).toEqual(["Don't jump.", "DON'T JUMP!"]);
    expect(words.filter((w) => w.key).map((w) => w.text)).toEqual(["jump.", "DON'T", "JUMP!"]);
  });
  it("lights up the word being said in brand yellow, key words in the accent colour, inside the safe zone", () => {
    const ev1 = captionEvents([{ startMs: 0, endMs: 2000, text: "One more hit and it's OVER!" }], "highlight", size, settings, 10_000);
    expect(ev1.length).toBe(6);
    expect(ev1[0]).toContain("{\\c&H00E5FF&\\fscx112\\fscy112}ONE");
    expect(ev1.some((e) => e.includes("{\\c&H365AFF&}OVER!"))).toBe(true);
    expect(ev1.join("")).not.toContain("\\r");
    const l = captionLayout(size, settings);
    expect(l.bottom).toBeGreaterThanOrEqual(settings.shorts.safe_zone.bottom_px);
    expect(l.right).toBeGreaterThanOrEqual(settings.shorts.safe_zone.right_px);
  });
  it("the first word of a chunk pops in (pop style)", () => {
    const e = captionEvents([{ startMs: 0, endMs: 900, text: "NOOO!" }], "pop", size, settings, 10_000);
    expect(e[0]).toContain("\\fscx75\\fscy75\\t(0,110");
  });
  it("uses the real spoken length from the gate when it is there", () => {
    expect(timedFromSpoken([{ at_ms: 0, text: "a", ms: 800 }, { at_ms: 3000, text: "b" }], 5000)).toEqual([
      { startMs: 0, endMs: 800, text: "a" },
      { startMs: 3000, endMs: 5000, text: "b" },
    ]);
  });
});

describe("pattern interrupts", () => {
  it("a Short gets a jolt every 2-4 s and a punch + shake on the peak", () => {
    const list = planInterrupts({ durationMs: 20_000, peaks: [{ atMs: 15_000, payoff: 90 }], short: true, style: "punch", settings, rnd: seeded("x") });
    expect(list.some((x) => x.kind === "shake" && Math.abs(x.atMs - 15_000) < 100)).toBe(true);
    expect(list.every((x) => x.atMs >= 400)).toBe(true);
    expect(longestQuiet(list, 20_000)).toBeLessThanOrEqual(4600);
  });
  it("a long video gets a visual reset every 20-40 s", () => {
    const list = planInterrupts({ durationMs: 300_000, peaks: [], short: false, style: "slow_push", settings, rnd: seeded("y") });
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(longestQuiet(list, 300_000)).toBeLessThanOrEqual(41_000);
  });
  it("turns into one per-frame zoom and crop that keeps the size, and gives sound accents", () => {
    const list = planInterrupts({ durationMs: 10_000, peaks: [{ atMs: 7000, payoff: 90 }], short: true, style: "whip", settings, rnd: seeded("z") });
    const f = interruptFilter(list, size);
    expect(f).toMatch(/^scale=w='trunc\(1080\*\(1\+.*eval=frame/);
    expect(f).toContain("crop=1080:1920:x='");
    expect(interruptFilter([], size)).toBe("");
    expect(interruptSfx(list).length).toBeGreaterThan(0);
    // Inside a render it sits before the captions.
    const args = renderArgs({ recording: "r", recordingMs: 60_000, hasAudio: true, segments: [seg("build", 0, 10_000, 0)], size, assFile: "s.ass", voice: [], gameVolume: 1, output: "o.mp4", fx: f, highQuality: true, fps: 60 }).args.join(" ");
    expect(args).toMatch(/\[vc\]scale=w=.*subtitles=s\.ass\[vout\]/);
    expect(args).toContain("-crf 17");
    expect(args).toContain("fps=60");
  });
  it("is off when the preset turns it off", () => {
    const off = { ...settings, features: { ...settings.features, pattern_interrupts: false } };
    expect(planInterrupts({ durationMs: 20_000, peaks: [], short: true, style: "punch", settings: off, rnd: seeded("q") })).toEqual([]);
  });
});

describe("slow motion, teaser and long video", () => {
  it("slows down the last 0.8 s before the peak, and the peak still maps correctly", () => {
    const e = ev("a", 200_000);
    const p = planShort(e, tl([e]), settings, seeded("r"), "loop");
    const slow = p.segments.find((s) => s.speed === 0.5)!;
    expect(slow.src_start_ms).toBe(199_100);
    expect(slow.src_end_ms).toBe(199_900);
    expect(sourceToOut(p.segments, 200_000)).toBeGreaterThan(slow.out_start_ms);
  });
  it("chaos preset: a teaser of the payoff first, then 'N SECONDS EARLIER…'", () => {
    const chaos = resolveSettings("chaos");
    const e = ev("a", 200_000);
    const p = planShort(e, tl([e]), chaos, seeded("t"), "loop");
    expect(p.segments[0].part).toBe("teaser");
    expect(p.overlays[0].text).toMatch(/^\d+ SECONDS EARLIER…$/);
    // The anticipation still refers to the real peak, not the teaser.
    expect(sourceToOut(p.segments, 200_000)).toBeGreaterThan(5000);
  });
  it("cuts dead parts out of a long video and keeps the cold open", () => {
    const segs = [seg("cold_open", 300_000, 315_000, 0), seg("chapter", 100_000, 200_000, 15_000)];
    const t = tl([ev("x", 150_000)], [{ startMs: 120_000, endMs: 130_000, why: "menu" }]);
    const r = cutDeadInPlan(segs, t);
    expect(r.cutMs).toBe(10_000);
    expect(r.segments[0].part).toBe("cold_open");
    expect(r.segments.map((s) => [s.src_start_ms, s.src_end_ms])).toEqual([[300_000, 315_000], [100_000, 120_000], [130_000, 200_000]]);
    expect(deadInMontage(r.segments, t.dead).totalMs).toBe(0);
    // Stillness right at a peak (the GAME OVER screen) stays on purpose and is not counted as dead air.
    const atPeak = [seg("payoff", 140_000, 160_000, 0)];
    const still = [{ startMs: 150_500, endMs: 153_000, why: "still" as const }];
    expect(deadInMontage(atPeak, still).longestMs).toBe(2500);
    expect(deadInMontage(atPeak, still, 700, [150_000]).longestMs).toBe(0);
    expect(firstFrameMoves(r.segments, t.dead)).toBe(true);
    expect(firstFrameMoves([seg("build", 121_000, 125_000, 0)], t.dead)).toBe(false);
  });
  it("chapters around the biggest events, YouTube rules (0:00, at least 3, 30 s apart)", () => {
    const segs = [seg("chapter", 0, 600_000, 0)];
    const ch = chapters(segs, tl([ev("a", 100_000, 90), ev("b", 300_000, 80, "bijna_dood"), ev("c", 310_000, 70), ev("d", 450_000, 95, "fail", "death")]), 600_000);
    expect(ch[0]).toBe("0:00 The start");
    expect(ch).toContain("7:18 Game over");
    expect(ch.length).toBe(4);
    expect(chapters(segs, tl([ev("a", 100_000)]), 600_000)).toEqual([]);
  });
  it("a long video's script goes from the cold open back to the start", () => {
    const segs = [seg("cold_open", 300_000, 310_000, 0), seg("chapter", 100_000, 200_000, 10_000)];
    const s = freeScript({ segments: segs, targetMs: 110_000, timeline: tl([ev("a", 150_000)]), settings, seed: "long", short: false });
    const bridge = s.lines.find((l) => l.at_ms >= 10_000 && l.at_ms < 11_000)!;
    expect(bridge.text).toMatch(/GET here|THIS happen|ALL started/);
  });
});

describe("freeze-frame + text (section 7.3)", () => {
  const settings = resolveSettings(null);
  const take = () => "OOF!";
  it("freezes once in a Short, right after the biggest fail, never on a lucky moment", () => {
    const f = planFreezes({ peaks: [{ atMs: 5000, payoff: 60, fail: true }, { atMs: 9000, payoff: 90, fail: true }, { atMs: 12_000, payoff: 99, fail: false }], durationMs: 20_000, short: true, settings, take });
    expect(f).toEqual([{ atMs: 9150, ms: 700, text: "OOF!" }]);
  });
  it("not in the hook second or the last half second, and only when the preset has it", () => {
    expect(planFreezes({ peaks: [{ atMs: 500, payoff: 90, fail: true }, { atMs: 19_000, payoff: 90, fail: true }], durationMs: 20_000, short: true, settings, take })).toEqual([]);
    const off = { ...settings, features: { ...settings.features, interrupts: ["zoom_punch"] } };
    expect(planFreezes({ peaks: [{ atMs: 9000, payoff: 90, fail: true }], durationMs: 20_000, short: true, settings: off, take })).toEqual([]);
  });
  it("holds one frame without changing the length", () => {
    expect(freezeFilter([{ atMs: 9150, ms: 700, text: "OOF!" }], 60)).toBe("setpts='if(between(T,9.150,9.850),9.850/TB,PTS)',fps=60");
    expect(freezeFilter([], 60)).toBe("");
  });
});

describe("loop ending (section 7.5)", () => {
  const base = { recording: "r.mp4", recordingMs: 60_000, hasAudio: true, segments: [{ src_start_ms: 1000, src_end_ms: 13_000, speed: 1, out_start_ms: 0, part: "main", note: "", effects: [] } as unknown as Segment], size: { width: 1080, height: 1920 }, assFile: "s.ass", voice: [], gameVolume: 0.3, output: "o.mp4" };
  it("fades the last 0.4 s into the first frame, captions on top", () => {
    const g = renderArgs({ ...base, loopFadeMs: 400 }).args.join(" ");
    expect(g).toContain("fade=t=in:st=11.600:d=0.400:alpha=1");
    expect(g).toMatch(/overlay=shortest=1:eof_action=pass,format=yuv420p,subtitles=s\.ass\[vout\]/);
  });
  it("leaves the end alone without the option", () => {
    expect(renderArgs(base).args.join(" ")).not.toContain("tpad");
  });
});

describe("captions follow the real voice (16-11-2026)", () => {
  it("same word count: every caption word gets its spoken time", () => {
    const w = wordTimes({ startMs: 0, endMs: 3000, text: "Wait wait WAIT!", heard: [{ text: "Wait,", startMs: 4000, endMs: 4500 }, { text: "wait,", startMs: 4600, endMs: 5100 }, { text: "wait!", startMs: 5200, endMs: 5700 }] });
    expect(w.map((x) => x.startMs)).toEqual([4000, 4600, 5200]);
  });
  it("other word count: spread only over where the voice really speaks", () => {
    const w = wordTimes({ startMs: 0, endMs: 9000, text: "Look at those mobs hiding", heard: [{ text: "Look", startMs: 3100, endMs: 3300 }, { text: "at those", startMs: 3300, endMs: 3700 }, { text: "mobs hiding.", startMs: 3700, endMs: 4400 }] });
    expect(w[0].startMs).toBe(3100);
    expect(w[w.length - 1].endMs).toBeLessThanOrEqual(4400);
  });
  it("checks whether the voice said the line", async () => {
    const { heardMatch } = await import("./captions");
    expect(heardMatch("Wait wait wait, something's coming", [{ text: "Wait," }, { text: "wait," }, { text: "wait," }, { text: "something's" }, { text: "coming" }])).toBe(1);
    expect(heardMatch("Look at those mobs hiding inside", [{ text: "Look" }])).toBeLessThan(0.6);
  });
  it("tightens every spoken line (no long pauses inside)", async () => {
    const { tightenArgs } = await import("../../worker/ffmpeg");
    expect(tightenArgs("a.wav", "b.wav").join(" ")).toContain("stop_duration=0.35");
  });
  it("long parts with many peaks keep the effect formulas shallow (18-11-2026: FFmpeg 'Cannot allocate memory')", () => {
    const depth = (e: string) => { let d = 0, max = 0; for (const c of e) { if (c === "(") max = Math.max(max, ++d); if (c === ")") d--; } return max; };
    expect(balancedSum([])).toBe("0");
    expect(balancedSum(["a"])).toBe("a");
    expect(balancedSum(["a", "b", "c"])).toBe("(a+(b+c))");
    const list = Array.from({ length: 300 }, (_, i) => ({ atMs: 1000 + i * 4000, kind: (i % 2 ? "shake" : "zoom_punch") as "shake" | "zoom_punch", ms: 300, strength: 0.12 }));
    const fx = interruptFilter(list, { width: 1920, height: 1080 });
    // A flat chain failed above ~50 terms; balanced, 300 interrupts stay about 20 levels deep.
    expect(depth(fx)).toBeLessThan(25);
    expect(fx.match(/between\(t,/g)?.length).toBe(300 + 150 + 150);
  });
});

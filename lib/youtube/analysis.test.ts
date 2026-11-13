import { describe, expect, it } from "vitest";
import { buildEditPlan, checkMoment, estimateAnalysisCents, formatTimecode, parseAnalysis, parseScript, planVideos, scriptPrompt, testMoments, testScript, type Moment } from "./analysis";

describe("AI script", () => {
  it("accepts a valid script, drops lines outside the video and sorts", () => {
    const r = parseScript({ top_line: "1 HEART LEFT", hook: "One heart left.", lines: [{ at_ms: 5000, text: "b" }, { at_ms: 0, text: "a" }, { at_ms: 99_000, text: "x" }, { text: "y" }] }, 18_000);
    if ("error" in r) throw new Error(r.error);
    expect(r.draft.lines.map((l) => l.text)).toEqual(["a", "b"]);
    expect(r.dropped).toBe(2);
  });
  it("refuses a script without hook or lines", () => {
    expect(parseScript({ lines: [{ at_ms: 0, text: "a" }] }, 1000)).toHaveProperty("error");
    expect(parseScript({ hook: "h", lines: [] }, 1000)).toHaveProperty("error");
  });
  it("the script prompt only contains what the analysis saw", () => {
    const m = ok();
    const p = scriptPrompt("A", "Promise", [m], buildEditPlan("A", [m]), "en");
    expect(p).toContain(m.reason);
    expect(p).toMatch(/invent nothing/);
  });
});

const raw = (o: Record<string, unknown> = {}) => ({ kind: "near_death", start_ms: 10_000, end_ms: 30_000, peak_ms: 22_000, reason: "Creeper behind him with one heart", score: 80, has_context: true, has_payoff: true, ...o });
const ok = (o: Record<string, unknown> = {}, duration = 600_000): Moment => {
  const r = checkMoment(raw(o), duration);
  if ("error" in r) throw new Error(r.error);
  return r.moment;
};

describe("checkMoment", () => {
  it("accepts a moment with lead-in and outcome", () => {
    const m = ok();
    expect(m.hasContext && m.hasPayoff).toBe(true);
    expect(m.suggestedFormat).toBe("A");
  });
  it("overrules 'has context' when the lead-in is too short", () => {
    const m = ok({ start_ms: 21_000 });
    expect(m.hasContext).toBe(false);
    expect(m.contextNote).toMatch(/aanloop/);
  });
  it("overrules 'has payoff' when the recording stops right after the peak", () => {
    const m = ok({ end_ms: 22_500 });
    expect(m.hasPayoff).toBe(false);
    expect(m.payoffNote).toMatch(/afloop/);
  });
  it("refuses wrong timecodes, unknown kinds and a missing reason", () => {
    expect(checkMoment(raw({ end_ms: 5_000 }), 600_000)).toHaveProperty("error");
    expect(checkMoment(raw({ end_ms: 700_000 }), 600_000)).toHaveProperty("error");
    expect(checkMoment(raw({ kind: "dance" }), 600_000)).toHaveProperty("error");
    expect(checkMoment(raw({ reason: " " }), 600_000)).toHaveProperty("error");
  });
  it("keeps only known privacy flags, once", () => {
    expect(ok({ privacy_flags: ["gamertag", "gamertag", "ufo", "voice"] }).privacyFlags).toEqual(["gamertag", "voice"]);
  });
  it("puts a missing or wrong peak in the middle", () => {
    expect(ok({ peak_ms: 99_000 }).peakMs).toBe(20_000);
  });
});

describe("parseAnalysis", () => {
  it("keeps valid moments in time order and reports the rest", () => {
    const r = parseAnalysis({ moments: [raw({ start_ms: 200_000, end_ms: 220_000, peak_ms: 210_000 }), raw(), { kind: "x" }] }, 600_000);
    expect(r.moments.map((m) => m.startMs)).toEqual([10_000, 200_000]);
    expect(r.rejected).toHaveLength(1);
  });
  it("handles an answer without a list", () => {
    expect(parseAnalysis("nonsense", 1000).rejected).toHaveLength(1);
  });
});

describe("planVideos", () => {
  const key = (m: Moment) => String(m.startMs);
  it("makes at most 6 Shorts per recording, the best moments first", () => {
    const many = Array.from({ length: 9 }, (_, i) => ok({ start_ms: i * 100_000, end_ms: i * 100_000 + 20_000, peak_ms: i * 100_000 + 10_000, score: 50 + i }, 1_000_000));
    const shorts = planVideos(many, 1_000_000, key).filter((p) => p.format !== "C");
    expect(shorts).toHaveLength(6);
    expect(Math.min(...shorts.map((p) => p.moments[0].score))).toBe(53);
  });
  it("makes one Short per usable moment and skips unusable ones", () => {
    const plans = planVideos([ok(), ok({ kind: "rare_find", start_ms: 100_000, end_ms: 125_000, peak_ms: 110_000 }), ok({ start_ms: 300_000, end_ms: 301_000, peak_ms: 300_500 })], 600_000, key);
    expect(plans.map((p) => p.planKey)).toEqual(["A:10000", "B:100000"]);
  });
  it("skips a Short that mostly overlaps a better one of the same format", () => {
    const plans = planVideos([ok({ score: 90 }), ok({ start_ms: 12_000, end_ms: 31_000, score: 50 })], 120_000, key);
    expect(plans).toHaveLength(1);
    expect(plans[0].moments[0].score).toBe(90);
  });
  it("plans a long video only with enough footage and moments", () => {
    const three = [ok(), ok({ start_ms: 100_000, end_ms: 130_000, peak_ms: 120_000 }), ok({ kind: "build_result", start_ms: 400_000, end_ms: 460_000, peak_ms: 440_000 })];
    expect(planVideos(three, 600_000, key).some((p) => p.format === "C")).toBe(true);
    expect(planVideos(three, 7 * 60_000, key).some((p) => p.format === "C")).toBe(false);
    expect(planVideos(three.slice(0, 2), 600_000, key).some((p) => p.format === "C")).toBe(false);
  });
  it("gives the same plan keys when the same recording is analysed again", () => {
    const moments = [ok(), ok({ kind: "rare_find", start_ms: 100_000, end_ms: 125_000, peak_ms: 110_000 })];
    expect(planVideos(moments, 600_000, key).map((p) => p.planKey)).toEqual(planVideos([...moments].reverse(), 600_000, key).map((p) => p.planKey));
  });
});

describe("buildEditPlan", () => {
  it("format A: hook, sped-up build and payoff within 30-45 s", () => {
    const plan = buildEditPlan("A", [ok({ start_ms: 0, end_ms: 50_000, peak_ms: 40_000 })]);
    expect(plan.segments.map((s) => s.part)).toEqual(["hook", "build", "payoff"]);
    expect(plan.segments[1].speed).toBeGreaterThan(1);
    expect(plan.targetMs).toBeGreaterThanOrEqual(30_000);
    expect(plan.targetMs).toBeLessThanOrEqual(45_000);
    expect(plan.warnings).toEqual([]);
  });
  it("output timecodes follow each other without gaps", () => {
    const { segments } = buildEditPlan("B", [ok({ kind: "rare_find", start_ms: 0, end_ms: 40_000, peak_ms: 20_000 })]);
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      expect(segments[i].out_start_ms).toBe(prev.out_start_ms + Math.round((prev.src_end_ms - prev.src_start_ms) / prev.speed));
    }
  });
  it("a tightly cut moment still gives a Short of 30-45 s when the recording length is known", () => {
    // Like the first real recording: 2:05-2:14, peak in the middle, recording of 24 minutes.
    const m = ok({ start_ms: 125_000, end_ms: 134_000, peak_ms: 130_000 }, 1_444_000);
    const plan = buildEditPlan("A", [m], 1_444_000);
    expect(plan.targetMs).toBeGreaterThanOrEqual(30_000);
    expect(plan.targetMs).toBeLessThanOrEqual(45_000);
    expect(plan.segments[1].src_start_ms).toBe(100_000);
  });
  it("chapters of a long video are 1.5-3 minutes and never overlap", () => {
    const peaks = [130_000, 227_000, 444_000, 1_200_000];
    const moments = peaks.map((p, i) => ok({ kind: i % 2 ? "escape" : "near_death", start_ms: p - 5000, end_ms: p + 5000, peak_ms: p }, 1_444_000));
    const plan = buildEditPlan("C", moments, 1_444_000);
    const chapters = plan.segments.filter((s) => s.part === "chapter");
    expect(chapters).toHaveLength(4);
    for (let i = 1; i < chapters.length; i++) expect(chapters[i].src_start_ms).toBeGreaterThanOrEqual(chapters[i - 1].src_end_ms);
    expect(chapters[3].src_end_ms - chapters[3].src_start_ms).toBe(105_000);
    expect(plan.targetMs).toBeGreaterThan(6 * 60_000);
  });
  it("warns when a long video is far too short", () => {
    const plan = buildEditPlan("C", [ok()]);
    expect(plan.warnings.join(" ")).toMatch(/minstens 3/);
    expect(plan.warnings.join(" ")).toMatch(/Korter/);
  });
});

describe("missing footage", () => {
  it("names the formats a recording does not support", async () => {
    const { missingFormats, FOOTAGE_NEEDED } = await import("./analysis");
    expect(missingFormats(["A", "B"])).toEqual(["C"]);
    expect(missingFormats([])).toEqual(["A", "B", "C"]);
    expect(FOOTAGE_NEEDED.C).toMatch(/8 minuten/);
  });
});

describe("test data and costs", () => {
  it("test moments for a 20 s recording are usable and labelled", () => {
    const moments = testMoments(20_000);
    expect(moments).toHaveLength(2);
    expect(moments.every((m) => m.hasContext && m.hasPayoff && m.reason.startsWith("TESTDATA"))).toBe(true);
    const plan = buildEditPlan("A", [moments[0]]);
    expect(testScript(plan, [moments[0]]).lines.every((l) => l.text.startsWith("[TESTDATA]"))).toBe(true);
  });
  it("estimates analysis costs in whole cents, rounded up", () => {
    expect(estimateAnalysisCents(3_600_000)).toBe(35);
    expect(estimateAnalysisCents(20_000)).toBe(1);
  });
  it("formats timecodes", () => {
    expect(formatTimecode(83_400)).toBe("1:23");
    expect(formatTimecode(3_725_000)).toBe("1:02:05");
  });
});

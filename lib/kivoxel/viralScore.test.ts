import { describe, expect, it } from "vitest";
import { applyAi, applyJudgement, viralScore, type ViralInput } from "./viralScore";
import type { ExportMeasure } from "./editorReview";
import type { GateResult } from "./producerGate";

const measure = (over: Partial<ExportMeasure> = {}): ExportMeasure => ({ durationMs: 20_000, black: [], frozen: [], silence: [], peakDb: -1.5, clippedSamples: 0, motion: Array.from({ length: 20 }, () => 6), captions: [], ...over });
const gate = (lead: "GESLAAGD" | "ONBEWEZEN" = "GESLAAGD"): GateResult => ({
  status: "GROEN LICHT",
  summary: "",
  directions: [],
  checks: [
    { key: "belofte", label: "", verdict: "GESLAAGD", reason: "bijna_dood: creeper" },
    { key: "eerste_indruk", label: "", verdict: "GESLAAGD", reason: "gameplay" },
    { key: "voortgang", label: "", verdict: lead, reason: lead === "GESLAAGD" ? "Er gebeurt al iets in de aanloop" : "In de aanloop meet de analyse niets" },
    { key: "einde", label: "", verdict: "GESLAAGD", reason: "uitkomst in beeld" },
  ],
});
const input = (over: Partial<ViralInput> = {}): ViralInput => ({
  short: true, measure: measure(), peakOutMs: 6500, gameplayShare: 0.97, editor: null, gate: gate(), payoff: 80, firstLineWeak: false,
  hasVoice: false, voiceSyncRed: false, music: { moods: ["tense"], licensed: true }, fittingMoods: ["tense", "epic", "hype"], sfxCount: 3, musicChosenOff: false, briefingOk: null, ...over,
});

describe("viralscore 8,0", () => {
  it("a strong Short scores high on the measured part, but is not 'publicatiegereed' while originality is unjudged", () => {
    const r = viralScore(input());
    expect(r.total).toBeGreaterThanOrEqual(8);
    expect(r.status).toBe("oordeel nodig");
    expect(r.parts.find((p) => p.key === "originaliteit")!.score).toBeNull();
    expect(r.summary).toMatch(/jouw oordeel nodig voor: Originaliteit/);
  });

  it("with Milan's judgement of the open parts it can be publication ready", () => {
    const r = viralScore(input({ milan: { originaliteit: 8.5 } }));
    expect(r.status).toBe("publicatiegereed");
    expect(r.parts.find((p) => p.key === "originaliteit")!.source).toBe("Milan");
  });

  it("below 8.0 names the weakest parts and what would help; the total is the honest weighted mean", () => {
    const r = viralScore(input({ gameplayShare: 0.45, payoff: 40, peakOutMs: 19_000, music: { moods: ["chill"], licensed: true }, milan: { originaliteit: 8 } }));
    expect(r.status).toBe("onder 8,0");
    expect(r.weakest[0].key).toBe("fragment");
    expect(r.weakest.map((w) => w.key)).toContain("payoff");
    expect(r.summary).toMatch(/onder 8,0/);
  });

  it("a hard block wins over any total", () => {
    const r = viralScore(input({ milan: { originaliteit: 10 }, briefingOk: false }));
    expect(r.status).toBe("geblokkeerd");
    expect(viralScore(input({ milan: { originaliteit: 10 }, music: { moods: ["tense"], licensed: false } })).blocks[0]).toMatch(/licentie/);
  });

  it("never invents: an unproven build-up stays open, a voice is at most 8 until Milan listened", () => {
    const r = viralScore(input({ gate: gate("ONBEWEZEN"), hasVoice: true }));
    expect(r.parts.find((p) => p.key === "verhaal")!.score).toBeNull();
    expect(r.parts.find((p) => p.key === "stem_audio")!.score).toBe(8);
  });

  it("music with the wrong mood for the moment costs points; no music only counts when chosen", () => {
    expect(viralScore(input({ music: { moods: ["chill"], licensed: true } })).parts.find((p) => p.key === "muziek_sfx")!.score).toBeLessThan(8);
    expect(viralScore(input({ music: null, musicChosenOff: false })).parts.find((p) => p.key === "muziek_sfx")!.score).toBeNull();
    expect(viralScore(input({ music: null, musicChosenOff: true })).parts.find((p) => p.key === "muziek_sfx")!.score).not.toBeNull();
  });

  it("Milan's judgement in the review completes a stored score without touching the measured parts or the blocks", () => {
    const stored = viralScore(input());
    const r = applyJudgement(stored, { originaliteit: 9 });
    expect(r.status).toBe("publicatiegereed");
    expect(r.parts.find((p) => p.key === "hook")).toEqual(stored.parts.find((p) => p.key === "hook"));
    expect(applyJudgement(viralScore(input({ briefingOk: false })), { originaliteit: 10 }).status).toBe("geblokkeerd");
  });
  it("says which parts only the AI judged, also when publication ready", () => {
    const r = applyAi(viralScore(input()), { originaliteit: 8 });
    expect(r.status).toBe("publicatiegereed");
    expect(r.summary).toMatch(/Originaliteit en entertainment door de AI beoordeeld, nog niet door jou/);
    expect(applyJudgement(r, { originaliteit: 8.5 }).summary).not.toMatch(/door de AI/);
  });
  it("a teaser in the first second keeps the hook score when the full climax comes late", () => {
    const late = viralScore(input({ peakOutMs: 13_000 }));
    const teased = viralScore(input({ peakOutMs: 13_000, teaserAtMs: 0 }));
    expect(late.parts.find((p) => p.key === "hook")!.score).toBeLessThan(teased.parts.find((p) => p.key === "hook")!.score!);
    expect(teased.parts.find((p) => p.key === "hook")!.evidence.join(" ")).toMatch(/teaser van het hoogtepunt/);
  });
});

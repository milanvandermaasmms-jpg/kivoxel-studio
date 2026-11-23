import { describe, expect, it } from "vitest";
import { assess, summarize, type Facts } from "./contentRegister";
import type { ExportMeasure } from "./editorReview";

const measure = (over: Partial<ExportMeasure> = {}): ExportMeasure => ({ durationMs: 20_000, black: [], frozen: [], silence: [], peakDb: -1.5, clippedSamples: 0, motion: Array.from({ length: 20 }, () => 6), captions: [], ...over });
const facts = (over: Partial<Facts> = {}): Facts => ({
  videoId: "v1", channel: "KIVOXEL", title: "Creeper Ambush", format: "A", status: "review", publication: null, createdAt: "2026-11-22T10:00:00Z",
  source: true, renderFile: true, renderName: "v1.mp4", width: 1080, height: 1920, durationMs: 20_000, measure: measure(), gameplayShare: 0.95,
  hasVoice: false, topLine: "He hears the hiss behind him", lines: [], peakOutMs: 6500, qcRed: 0, voSyncRed: false, reviewNote: null, avgViewPct: null, views: null, ...over,
});

describe("contentregister", () => {
  it("a clean Short is kept, with all five scores measured", () => {
    const e = assess(facts());
    expect(e.action).toBe("behouden");
    expect(e.total).toBeGreaterThanOrEqual(90);
    expect(e.control).toBe("afgerond");
  });

  it("mostly menu footage means a new moment, whatever the rest scores", () => {
    const e = assess(facts({ gameplayShare: 0.3 }));
    expect(e.action).toBe("opnieuw maken");
    expect(e.why).toMatch(/Ander moment nodig/);
  });

  it("a measured, fixable problem (outcome cut off, clipping) asks for improvement", () => {
    const e = assess(facts({ peakOutMs: 18_500, measure: measure({ peakDb: 0, clippedSamples: 400 }) }));
    expect(e.action).toBe("verbeteren");
    expect(e.scores.audio.reasons[0]).toMatch(/Vervorming/);
    expect(e.scores.montage.reasons[0]).toMatch(/Uitkomst maar 1\.5 s/);
  });

  it("Milan's rejection note counts: wrong text lowers the script, 'gebeurt niks' means remake", () => {
    expect(assess(facts({ reviewNote: "tekst klopt niet" })).scores.script.value).toBeLessThanOrEqual(60);
    expect(assess(facts({ status: "archived", reviewNote: "er gebeurt niks" })).action).toBe("opnieuw maken");
  });

  it("never guesses: a missing file is 'niet beoordeeld', a live video is only information", () => {
    const gone = assess(facts({ renderFile: false, measure: null }));
    expect(gone.action).toBe("niet beoordeeld");
    expect(gone.scores.beeld.value).toBeNull();
    const live = assess(facts({ status: "published", publication: "published", renderFile: false, measure: null, avgViewPct: 96, views: 1440 }));
    expect(live.action).toBe("live (alleen info)");
    expect(live.why).toMatch(/96% bekeken bij 1440 weergaven; wordt niet aangeraakt|96% bekeken bij 1440 weergaven/);
  });

  it("a game without the Minecraft HUD has no picture score instead of an invented one", () => {
    const e = assess(facts({ gameplayShare: null, channel: "SpawnNado" }));
    expect(e.scores.beeld.value).toBeNull();
    expect(e.total).not.toBeNull();
  });

  it("an archived production without a measurable problem is not 'behouden' but stays in the archive", () => {
    const e = assess(facts({ status: "archived", reviewNote: "Vervangen door versie 2" }));
    expect(e.action).toBe("afgekeurd (archief)");
    expect(e.control).toBe("afgerond");
  });

  it("counts per action", () => {
    const r = summarize([assess(facts()), assess(facts({ gameplayShare: 0.2 }))], "2026-11-23T12:00:00Z");
    expect(r.counts).toMatchObject({ behouden: 1, "opnieuw maken": 1 });
  });
  it("says how far each production is checked: technically, by content (Milan), fully approved, repair, or not yet", () => {
    expect(assess(facts()).stage).toBe("technisch gecontroleerd");
    expect(assess(facts({ milanJudged: true })).stage).toBe("inhoudelijk gecontroleerd");
    expect(assess(facts({ status: "approved" })).stage).toBe("volledig goedgekeurd");
    expect(assess(facts({ gameplayShare: 0.2 })).stage).toBe("herstel nodig");
    expect(assess(facts({ renderFile: null, measure: null })).stage).toBe("nog niet beoordeeld");
  });
});

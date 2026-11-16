import { describe, expect, it } from "vitest";
import { presetFile, resolveSettings } from "./config";
import { longTopEvents } from "./hookText";
import type { Track } from "./media";
import { mixFilters, mixInputs } from "./mix";
import { actionSpans, downbeatStart, planMusicParts } from "./musicPlan";

const track = (file: string, energy: number, moods: Track["moods"], bpm = 120): Track => ({ file, title: file, source: "test", license: "test", energy, moods, bpm, beat_offset_ms: 0 });
const library = [track("busy.mp3", 5, ["hype", "funny"], 140), track("busy2.mp3", 4, ["tense"]), track("calm.mp3", 1, ["chill"], 80), track("happy.mp3", 3, ["happy"])];
const rnd = () => 0.1;

describe("music follows the content (Milan, 16-11-2026)", () => {
  it("action spans around fights and deaths, not around building", () => {
    const spans = actionSpans([{ atMs: 60_000, payoff: 90, type: "fail", kind: "death" }, { atMs: 200_000, payoff: 80, type: "bouw", kind: "ai_moment" }], 300_000, false);
    expect(spans).toEqual([[51_000, 64_000]]);
  });
  it("a long video alternates calm and busy music, one track of each", () => {
    const parts = planMusicParts({ durationMs: 300_000, events: [{ atMs: 60_000, payoff: 90, type: "fail", kind: "death" }, { atMs: 200_000, payoff: 70, type: "bijna_dood", kind: "damage" }], library, recent: [], rnd, short: false });
    expect(parts.map((p) => p.kind)).toEqual(["calm", "action", "calm", "action", "calm"]);
    expect(new Set(parts.filter((p) => p.kind === "action").map((p) => p.file)).size).toBe(1);
    expect(library.find((t) => t.file === parts[1].file)!.energy).toBeGreaterThanOrEqual(4);
    expect(library.find((t) => t.file === parts[0].file)!.energy).toBeLessThanOrEqual(3);
    // The pieces cover the whole video without gaps.
    expect(parts[0].atMs).toBe(0);
    for (let i = 1; i < parts.length; i++) expect(parts[i].atMs).toBe(parts[i - 1].atMs + parts[i - 1].durMs);
    expect(parts[parts.length - 1].atMs + parts[parts.length - 1].durMs).toBe(300_000);
  });
  it("a calm track continues where it stopped instead of starting over", () => {
    const parts = planMusicParts({ durationMs: 300_000, events: [{ atMs: 100_000, payoff: 90, type: "fail", kind: "death" }], library, recent: [], rnd, short: false });
    const calm = parts.filter((p) => p.kind === "calm");
    expect(calm[1].startMs).toBeGreaterThanOrEqual(calm[0].startMs + calm[0].durMs);
  });
  it("a Short that is all action gets one busy track; a calm Short one calm track", () => {
    const busy = planMusicParts({ durationMs: 15_000, events: [{ atMs: 9000, payoff: 95, type: "fail", kind: "death" }], library, recent: [], rnd, short: true });
    expect(busy.length).toBe(1);
    expect(busy[0].kind).toBe("action");
    const calm = planMusicParts({ durationMs: 20_000, events: [{ atMs: 9000, payoff: 60, type: "bouw", kind: "ai_moment" }], library, recent: [], rnd, short: true });
    expect(calm.map((p) => p.kind)).toEqual(["calm"]);
  });
  it("a downbeat lands exactly on the peak", () => {
    const s = downbeatStart({ bpm: 120, beat_offset_ms: 0 }, 5000, 3000);
    expect((s + 3000) % 2000).toBe(0);
    expect(s).toBeGreaterThanOrEqual(5000);
  });
  it("the mix cross-fades the stretches", () => {
    const settings = resolveSettings(null, "muziek_geen_vo");
    const spec = settings.audio_modes.muziek_geen_vo;
    const parts = [{ file: "a.mp3", atMs: 0, durMs: 10_000, startMs: 0, kind: "calm" as const, title: "a" }, { file: "b.mp3", atMs: 10_000, durMs: 8000, startMs: 4000, kind: "action" as const, title: "b" }];
    const plan = { mode: "muziek_geen_vo" as const, spec, music: { file: "a.mp3", startMs: 0, title: "a", parts }, sfx: [], voiceChain: true };
    expect(mixInputs(plan).filter((x) => x === "-i").length).toBe(2);
    const g = mixFilters({ plan, settings, durationMs: 18_000, voices: [], firstExtra: 3, loudnorm: "anull" }).join(";");
    expect(g).toContain("adelay=9200|9200");
    expect(g).toContain("amix=inputs=2");
  });
});

describe("the three options", () => {
  const modes = presetFile.base.audio_modes;
  it("game sound only: no story text and no sound effects", () => {
    expect(modes.alleen_game.text_story).toBe(false);
    expect(modes.alleen_game.sfx).toBe(false);
    expect(modes.alleen_game.music).toBe(false);
  });
  it("music: music plus the story as text", () => {
    expect(modes.muziek_geen_vo.music).toBe(true);
    expect(modes.muziek_geen_vo.text_story).not.toBe(false);
  });
  it("a long video shows the yellow text for the first minute and fades it", () => {
    const e = longTopEvents("SECRETS IN THE SNOW", 600_000, { width: 1920, height: 1080 }, resolveSettings(null));
    expect(e[0]).toContain("0:01:00.00");
    expect(e[0]).toContain("\\fad(400,1800)");
  });
});

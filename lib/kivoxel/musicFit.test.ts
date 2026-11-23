import { describe, expect, it } from "vitest";
import { musicFit, rankForMontage } from "./musicFit";

const track = (over: Record<string, unknown> = {}) => ({ moods: ["tense", "dark"] as ("tense" | "dark" | "funny" | "happy" | "hype" | "chill" | "epic")[], energy: 4, bpm: 120, beat_offset_ms: 0, license: "Uppbeat (vrij met vermelding)", test: false, channels: [] as string[], ...over });

describe("muziekgeschiktheid (8,0)", () => {
  it("a tense track on a near-death moment scores high; the same track on a joke does not", () => {
    const near = musicFit(track(), { type: "bijna_dood", intensity: 0.75, withVoice: false, short: true, channel: "kivoxel" });
    expect(near.score).toBeGreaterThanOrEqual(8);
    expect(near.ok).toBe(true);
    const joke = musicFit(track(), { type: "grap", intensity: 0.5, withVoice: false, short: true, channel: "kivoxel" });
    expect(joke.score).toBeLessThan(8);
    expect(joke.parts.passend.why).toMatch(/past niet bij grap/);
  });

  it("a busy track under a voice loses on balance; no licence or a test track never qualifies", () => {
    expect(musicFit(track({ energy: 5, moods: ["hype"] }), { type: "fail", intensity: 1, withVoice: true, short: true, channel: "kivoxel" }).parts.balans.score).toBe(5);
    expect(musicFit(track({ license: "" }), { type: "bijna_dood", intensity: 0.75, withVoice: false, short: true, channel: "kivoxel" }).ok).toBe(false);
    expect(musicFit(track({ test: true }), { type: "bijna_dood", intensity: 0.75, withVoice: false, short: true, channel: "kivoxel" }).ok).toBe(false);
  });

  it("ranks the library: only tracks reaching 8.0 remain, else the best ones with the reason", () => {
    const lib = [track({ moods: ["chill"], energy: 1 }), track(), track({ moods: ["funny"], energy: 3 })];
    const r = rankForMontage(lib, { type: "bijna_dood", intensity: 0.75, withVoice: false, short: true, channel: "kivoxel" });
    expect(r.tracks).toEqual([lib[1]]);
    const none = rankForMontage([lib[0]], { type: "bijna_dood", intensity: 0.75, withVoice: false, short: true, channel: "kivoxel" });
    expect(none.note).toMatch(/Geen track haalt de 8,0/);
    expect(none.tracks).toHaveLength(1);
  });
});

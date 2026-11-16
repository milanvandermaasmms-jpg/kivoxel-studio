import { describe, expect, it } from "vitest";
import { configProblems, deepMerge, eventTypeForMoment, hookFile, presetFile, presetNames, resolveSettings, words, type PresetFile } from "./config";

describe("KIVOXEL config", () => {
  it("the config files in the repo have no problems", () => {
    expect(configProblems()).toEqual([]);
  });

  it("merges objects key by key and replaces lists whole", () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9], $comment: "x" })).toEqual({ a: { b: 1, c: 3 }, l: [9] });
  });

  it("a preset changes only what it names", () => {
    const calm = resolveSettings("rustig_bouwen");
    expect(calm.features.interrupt_every_ms).toEqual([3500, 6000]);
    expect(calm.audio_modes.vo_muziek.music_db).toBe(-22);
    expect(calm.audio_modes.vo_muziek.duck_db).toBe(presetFile.base.audio_modes.vo_muziek.duck_db);
    expect(calm.sync).toEqual(presetFile.base.sync);
  });

  it("falls back to the channel default and lets one video pick another audio mode", () => {
    expect(resolveSettings("bestaat-niet").preset).toBe(presetFile.channel_default.preset);
    expect(resolveSettings(null, "alleen_game").audio_mode).toBe("alleen_game");
    expect(resolveSettings("zonder_muziek").audio_modes.vo_muziek.music).toBe(false);
    expect(presetNames()).toContain("standaard");
  });

  it("catches mistakes in a config file", () => {
    const broken = structuredClone(presetFile) as PresetFile;
    broken.base.sync.max_speed = 1.3;
    broken.base.shorts.length_buckets[1].min_ms = 10_000;
    broken.channel_default.preset = "weg";
    const problems = configProblems(broken, hookFile);
    expect(problems.join(" ")).toMatch(/1,08x/);
    expect(problems.join(" ")).toMatch(/overlappen/);
    expect(problems.join(" ")).toMatch(/Standaard-preset/);
  });

  it("refuses hooks that are too long or not in capitals", () => {
    const hooks = structuredClone(hookFile);
    hooks.hooks.fail.nl = ["DIT IS VEEL TE LANG HOOR", "klein", "OK OK"];
    const problems = configProblems(presetFile, hooks).join(" ");
    expect(problems).toMatch(/6 woorden/);
    expect(problems).toMatch(/HOOFDLETTERS/);
  });

  it("maps analysis moments to hook types", () => {
    expect(eventTypeForMoment("mistake")).toBe("fail");
    expect(eventTypeForMoment("near_death")).toBe("bijna_dood");
    expect(eventTypeForMoment("rare_find")).toBe("geluk");
    expect(eventTypeForMoment("surprise")).toBe("jumpscare");
    expect(words("NO WAY 😱")).toHaveLength(2);
  });
});

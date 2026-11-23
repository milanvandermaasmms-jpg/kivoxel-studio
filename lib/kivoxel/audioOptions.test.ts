import { describe, expect, it } from "vitest";
import { audioPayload, choiceLabel, GAMING_SET, musicPick, sfxAdjust } from "./audioOptions";

describe("drie audio-opties", () => {
  it("A, B and C really differ in voice, music and effects", () => {
    const v = GAMING_SET.variants;
    expect(new Set([v.A.choice.voice, v.B.choice.voice, v.C.choice.voice]).size).toBe(3);
    expect(new Set([v.A.choice.music, v.B.choice.music, v.C.choice.music]).size).toBe(3);
    expect(new Set([v.A.choice.sfx, v.B.choice.sfx, v.C.choice.sfx]).size).toBe(3);
  });

  it("builds the render payload: preview flag, audio mode, voice, music and effects", () => {
    expect(audioPayload(GAMING_SET, GAMING_SET.variants.B.choice, "B")).toMatchObject({ preview: "B", audio_mode: "vo_met_muziek", voice: "google", voice_name: "en-US-Chirp3-HD-Fenrir", music_pick: "energiek", sfx_level: "dynamisch" });
    expect(audioPayload(GAMING_SET, GAMING_SET.variants.C.choice, "C")).toMatchObject({ audio_mode: "muziek_geen_vo", music_pick: "rustig", sfx_level: "subtiel" });
    expect(audioPayload(GAMING_SET, { voice: "geen", music: "geen", sfx: "subtiel" }, "eigen")).toMatchObject({ audio_mode: "alleen_game", music_pick: "none" });
    // The final version (no preview flag) carries the same audio.
    expect(audioPayload(GAMING_SET, { voice: "B", music: "A", sfx: "gebalanceerd" }, null)).not.toHaveProperty("preview");
    // Voice without music stays the normal voice version (Milan, 16-11-2026); voice with music is its own mode.
    expect(audioPayload(GAMING_SET, { voice: "B", music: "geen", sfx: "gebalanceerd" }, null)).toMatchObject({ audio_mode: "vo_muziek", music_pick: "none" });
    // A with the automatic voice split: no audio mode, the worker decides.
    expect(audioPayload(GAMING_SET, GAMING_SET.variants.A.choice, "A", { autoVoice: true })).not.toHaveProperty("audio_mode");
  });

  it("effects: subtle keeps the strongest half and softer, dynamic is louder", () => {
    const cues = [{ db: -9 }, { db: -12 }, { db: -6 }, { db: -14 }];
    expect(sfxAdjust(cues, "subtiel")).toEqual([{ db: -10 }, { db: -13 }]);
    expect(sfxAdjust(cues, "dynamisch")[0].db).toBe(-6);
    expect(sfxAdjust(cues, "gebalanceerd")).toBe(cues);
  });

  it("music: energetic or calm tracks, the whole library when nothing fits", () => {
    const lib = [{ energy: 5, moods: ["hype"] }, { energy: 1, moods: ["chill"] }, { energy: 3, moods: ["tense"] }];
    expect(musicPick(lib, "energiek").tracks).toEqual([lib[0]]);
    expect(musicPick(lib, "rustig").tracks).toEqual([lib[1]]);
    expect(musicPick([lib[2]], "rustig").note).toMatch(/Geen rustige track/);
  });

  it("labels a combination in plain words", () => {
    expect(choiceLabel(GAMING_SET, { voice: "B", music: "A", sfx: "gebalanceerd" })).toBe("Stem B · Muziek A · effecten gebalanceerd");
  });
});

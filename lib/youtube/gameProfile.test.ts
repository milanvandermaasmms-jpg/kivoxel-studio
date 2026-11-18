import { describe, expect, it } from "vitest";
import { analysisPrompt, NARRATOR_VOICE, narratorVoice } from "./analysis";
import { GAMES, labelWithGame, PROFILES, profileFor, recordingGame } from "./gameProfile";
import { suggestPrompt } from "./suggest";
import { BASE_TAGS, standardDescription, standardTags } from "./standardMeta";
import { looksDutch } from "../kivoxel/config";

describe("channel profiles", () => {
  it("SpawnNado by slug or name; everything else stays KIVOXEL", () => {
    expect(profileFor({ slug: "spawnnado", name: "x" }).key).toBe("spawnnado");
    expect(profileFor({ slug: null, name: "SpawnNado" }).key).toBe("spawnnado");
    expect(profileFor({ slug: null, name: "KIVOXEL" }).key).toBe("kivoxel");
    expect(profileFor(null).key).toBe("kivoxel");
  });

  it("KIVOXEL is always Minecraft, whatever the label says", () => {
    expect(recordingGame("13-11 fortnite grot", PROFILES.kivoxel, "roblox")).toBe("minecraft");
  });

  it("SpawnNado: label first, then the analysis, then the default", () => {
    const p = PROFILES.spawnnado;
    expect(recordingGame("Roblox · 13-11 obby", p, "gta")).toBe("roblox");
    expect(recordingGame("13-11 warzone win", p)).toBe("cod");
    expect(recordingGame("13-11 avond", p, "gta")).toBe("gta");
    expect(recordingGame("13-11 avond", p, "tetris")).toBe("fortnite");
    expect(labelWithGame("13-11 avond", "gta", p)).toBe("GTA · 13-11 avond");
    expect(labelWithGame("13-11 avond", "gta", PROFILES.kivoxel)).toBe("13-11 avond");
  });

  it("KIVOXEL standard texts are unchanged", () => {
    expect(BASE_TAGS).toEqual(["minecraft", "minecraft survival", "minecraft bedrock", "minecraft ps5", "gaming", "kivoxel"]);
    expect(standardDescription({ kind: "short", title: "T" })).toBe(
      "T\n\nKIVOXEL plays Minecraft survival on PS5 – new Shorts every day: close calls, fails, finds and big moments.\n🔔 Subscribe so you never miss the next one!\n\n#minecraft #gaming #shorts",
    );
    expect(standardDescription({ kind: "long", title: "T" }).endsWith("#minecraft #gaming #minecraftsurvival")).toBe(true);
    expect(analysisPrompt(60_000)).toContain("You analyse raw Minecraft (PS5, Bedrock) survival gameplay for a faceless YouTube channel.");
    expect(narratorVoice()).toEqual(NARRATOR_VOICE);
  });

  it("SpawnNado texts follow the game and stay English", () => {
    const p = PROFILES.spawnnado;
    const tags = standardTags({ kind: "short", texts: ["Victory Royale clutch"], profile: p, game: "fortnite" });
    expect(tags.slice(0, 6)).toEqual(["fortnite", "fortnite battle royale", "fortnite zero build", "fortnite gameplay", "gaming", "spawnnado"]);
    expect(tags).toContain("fortnite victory royale");
    expect(tags.some((t) => t.includes("minecraft"))).toBe(false);
    const d = standardDescription({ kind: "long", title: "T", profile: p, game: "gta" });
    expect(d).toContain("SpawnNado plays GTA");
    expect(d.endsWith("#gta #gaming #gta5")).toBe(true);
    expect(suggestPrompt({ language: "en", kind: "short", channel: null, game: "roblox", title: "", description: "", narration: [], hook: null, usedTags: [], forbidden: [] })).toContain('starts with "Roblox"');
    expect(analysisPrompt(60_000, undefined, { detect: p.games })).toContain('"game"');
    for (const g of Object.values(GAMES)) {
      expect(looksDutch(p.block(g, "short"))).toBe(false);
      expect(looksDutch(g.focus)).toBe(false);
    }
  });
});

describe("other games skip the Minecraft picture checks", () => {
  it("frame description names Minecraft mobs only for Minecraft", async () => {
    const { evidencePrompt } = await import("./grounding");
    const frames = [{ index: 0, outMs: 0, srcMs: 0 }] as unknown as Parameters<typeof evidencePrompt>[0];
    const mc = evidencePrompt(frames);
    expect(mc).toContain("creeper");
    expect(mc).toContain("in menu/inventory). events: only clear events");
    const fn = evidencePrompt(frames, "fortnite");
    expect(fn).toContain("Fortnite gameplay recording");
    expect(fn).not.toMatch(/creeper|hearts|Minecraft/);
  });

  it("without the Minecraft HUD no death, damage or menu comes from the picture", async () => {
    const { withoutMinecraftHud } = await import("../kivoxel/events");
    const v = { version: 3 as const, fps: 4, width: 96, height: 54, durationMs: 1000, frames: [{ motion: 1, red: 0, luma: 40, sharp: 10, ui: 900, tint: 40, health: -1 }] };
    expect(withoutMinecraftHud(v).frames[0]).toMatchObject({ health: 1000, ui: 0, tint: 0, motion: 1 });
  });
});

describe("free mode (no credit) works for SpawnNado too", () => {
  it("free script lines skip Minecraft-only words for other games, KIVOXEL keeps them", async () => {
    const { forGame, templates } = await import("../kivoxel/voiceScript");
    const pool = templates.anticipation.bijna_dood;
    expect(forGame(pool)).toEqual(pool);
    expect(forGame(pool, "minecraft")).toEqual(pool);
    const fn = forGame(pool, "fortnite");
    expect(fn.length).toBeGreaterThan(0);
    expect(fn.some((x) => /heart/i.test(x))).toBe(false);
    expect(forGame(templates.open_loop, "gta").some((x) => /heart/i.test(x))).toBe(false);
  });

  it("free standard title names the game on SpawnNado only", async () => {
    const { standardTitle } = await import("./standardMeta");
    expect(standardTitle({ hookLine: "Bro had ONE job!" })).toBe("Bro had ONE job!");
    expect(standardTitle({ hookLine: "Bro had ONE job!", gameName: "Fortnite" })).toBe("Fortnite: Bro had ONE job!");
    expect(standardTitle({ scriptTitles: ["Fortnite clutch of the year"], gameName: "Fortnite" })).toBe("Fortnite clutch of the year");
  });
});

describe("SpawnNado: no voice, no captions, no blur", () => {
  it("only music or only game sound; KIVOXEL keeps every mode and its blur", async () => {
    const { channelAudioMode } = await import("./gameProfile");
    expect(channelAudioMode("vo_muziek", PROFILES.spawnnado)).toBe("muziek_geen_vo");
    expect(channelAudioMode("alleen_game", PROFILES.spawnnado)).toBe("alleen_game");
    expect(channelAudioMode("vo_muziek", PROFILES.kivoxel)).toBe("vo_muziek");
    expect(PROFILES.spawnnado.blur).toBe(false);
    expect(PROFILES.kivoxel.blur).toBe(true);
    const { presetFile } = await import("../kivoxel/config");
    for (const m of PROFILES.spawnnado.audioModes ?? []) {
      const spec = presetFile.base.audio_modes[m as keyof typeof presetFile.base.audio_modes];
      expect(spec.voice).toBe(false);
      expect((spec as { text_story?: boolean }).text_story).toBe(false);
    }
  });
});

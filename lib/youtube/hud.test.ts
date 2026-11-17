import { describe, expect, it } from "vitest";
import { NARRATOR_VOICE, parseScript, readsHud } from "./analysis";
import { applyVerification, mergeAdded } from "./grounding";
import { parseAnticipation } from "../kivoxel/scriptPrompt";

// Milan 15-11-2026: "hij benoemd de tijd en gekke coördinaten!"
describe("the narrator never reads the HUD", () => {
  it("spots coordinates, clock times and the day counter", () => {
    for (const t of ["We're at coordinates 245, 64, -1032!", "X 245 and climbing!", "It's 12:30 in the game!", "It's now 6 pm, night is coming!", "Day 104 and still alive!", "Check the position: -12, 70, 88", "Running at 60 FPS!"])
      expect(readsHud(t), t).toBe(true);
  });
  it("spots on-screen text read aloud", () => {
    for (const t of ['"YOU DIED! Player fell from a high place" is coming up!', "Check out that New recipe unlocked! View in crafting table!", "Set the Respawn point set You can only sleep at night"])
      expect(readsHud(t), t).toBe(true);
  });
  it("leaves normal hype lines alone", () => {
    for (const t of ["Three creepers. One heart!", "Night is coming, find a bed NOW!", "Day one of hardcore!", "He has 2 hearts left!", "Ten zombies in one cave?!", "What time is it? Monster time!"])
      expect(readsHud(t), t).toBe(false);
  });
  it("is part of every script prompt", () => {
    expect(NARRATOR_VOICE.join(" ")).toMatch(/coordinates/);
  });
  it("drops such lines from a script, a check and an addition", () => {
    const parsed = parseScript({ hook: "Watch out!", lines: [{ at_ms: 0, text: "Watch out!" }, { at_ms: 2000, text: "We're at coordinates 245, 64, -1032!" }] }, 10_000);
    expect("draft" in parsed && parsed.draft.lines.map((l) => l.text)).toEqual(["Watch out!"]);
    const checked = applyVerification([{ at_ms: 0, text: "It's 12:30 already!" }, { at_ms: 1000, text: "Run!" }, { at_ms: 2000, text: "Look there!" }], { lines: [{ index: 2, supported: false, rewrite: "Look at X 300!" }] });
    expect(checked.lines.map((l) => l.text)).toEqual(["Run!"]);
    expect(mergeAdded([], { lines: [{ at_ms: 500, text: "Day 104!" }, { at_ms: 600, text: "Go go go!" }] }, [[0, 1000]], 5000).map((l) => l.text)).toEqual(["Go go go!"]);
  });
  it("takes a clean shorter version in the voice-over, or drops the line", () => {
    const out = parseAnticipation({ lines: [{ kind: "bridge", text: "We are at 245, 64, -1032, keep going!", shorter: ["Keep going!"] }, { kind: "bridge", text: "It's 9:15!" }] }, new Map(), [], 10_000, null);
    expect("lines" in out && out.lines.map((l) => l.text)).toEqual(["Keep going!"]);
  });
});

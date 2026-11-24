import { describe, expect, it } from "vitest";
import { barFill, barRuns, calibrate, calibrateShield, createFortniteParser, FN_FRAME_BYTES, FN_H, FN_W, fortniteReliable, steady } from "./fortniteHud";
import { buildEvents, withFortniteHud } from "./events";
import type { VisualSignals } from "./visual";

const GREEN: [number, number, number] = [110, 200, 60];
const BLUE: [number, number, number] = [70, 170, 240];
const DARK: [number, number, number] = [40, 40, 50];

/** One corner frame: own health bar (row 25, columns 10-49 when full), shield above it (row 18), optional extras. */
function frame(o: { health?: number; shield?: number; mate?: boolean; grass?: boolean } = {}): Uint8Array {
  const f = new Uint8Array(FN_FRAME_BYTES);
  const put = (x: number, y: number, c: [number, number, number]) => f.set(c, (y * FN_W + x) * 3);
  for (let y = 0; y < FN_H; y++) for (let x = 0; x < FN_W; x++) put(x, y, DARK);
  const bar = (row: number, left: number, len: number, share: number, c: [number, number, number]) => {
    for (let dy = 0; dy < 2; dy++) for (let x = left; x < left + Math.round(len * share); x++) put(x, row + dy, c);
  };
  if (o.health !== undefined) bar(25, 10, 40, o.health, GREEN);
  if (o.shield !== undefined) bar(18, 10, 40, o.shield, BLUE);
  if (o.mate) bar(5, 8, 26, 1, GREEN); // a teammate's bar: higher up, shorter, always full
  if (o.grass) for (let y = 28; y < 32; y++) for (let x = 0; x < 70; x++) put(x, y, GREEN); // grass behind the corner, wider than the bar
  return f;
}

describe("Fortnite-levensbalk", () => {
  it("finds the player's own bar (not a teammate's, not grass) and measures how full it is", () => {
    const frames = Array.from({ length: 60 }, (_, i) => barRuns(frame({ health: i < 40 ? 1 : 0.5, mate: true, grass: i % 3 === 0 })).green);
    const cal = calibrate(frames);
    expect(cal).toMatchObject({ left: 10, full: 49 });
    expect([25, 26]).toContain(cal!.row); // the bar is two pixels tall: either row is the bar
    expect(barFill(frames[0], cal)).toBe(1000);
    expect(barFill(frames[50], cal)).toBe(500);
    expect(barFill(barRuns(frame({ mate: true })).green, cal)).toBe(-1); // lobby / map: no own bar
  });

  it("finds the shield right above the health bar and ignores blue elsewhere", () => {
    const green = Array.from({ length: 40 }, () => barRuns(frame({ health: 1, shield: 0.25 })).green);
    const blue = Array.from({ length: 40 }, () => barRuns(frame({ health: 1, shield: 0.25 })).blue);
    const sh = calibrateShield(blue, calibrate(green));
    expect(sh).toMatchObject({ row: 18, left: 10, full: 49 });
    expect(barFill(blue[0], sh)).toBe(250);
  });

  it("is not reliable without a bar (another game mode, HUD hidden)", () => {
    const p = createFortniteParser();
    for (let i = 0; i < 50; i++) p.feed(frame({ grass: true }));
    const s = p.finish();
    expect(s.cal.health).toBeNull();
    expect(fortniteReliable(s)).toBe(false);
  });

  it("turns a drop of the bar into damage and low-health events in Fortnite words", () => {
    const n = 4 * 30;
    const health = Array.from({ length: n }, (_, i) => (i < 40 ? 1000 : 250));
    const visual: VisualSignals = { version: 3, fps: 4, width: 96, height: 54, durationMs: 30_000, frames: Array.from({ length: n }, () => ({ motion: 8, red: 0, luma: 120, sharp: 12, ui: 300, tint: 30, health: 1000 })) };
    const t = buildEvents({ visual: withFortniteHud(visual, health), signals: null, hud: "fortnite" });
    // The hit and the low health right after it are one moment.
    const moment = t.events.find((e) => e.kind === "damage" || e.kind === "low_health");
    expect(moment?.description).toContain("Schade: van 100 naar 25 levens");
    expect(moment?.description).toContain("Nog maar 25 levens");
    expect(moment?.sources).toContain("beeld:levensbalk");
    expect(t.events.some((e) => e.kind === "death")).toBe(false); // the red tint is Minecraft's death screen, not Fortnite's
  });

  it("ignores a single wrong frame but keeps real damage", () => {
    expect(steady([1000, 1000, 400, 1000, 1000])).toEqual([1000, 1000, -1, 1000, 1000]);
    expect(steady([1000, 1000, 400, 400, 400])).toEqual([1000, 1000, 400, 400, 400]);
  });

  it("still reads the bar when green grass runs into it from the left", () => {
    const frames = Array.from({ length: 30 }, () => barRuns(frame({ health: 1 })).green);
    const cal = calibrate(frames);
    const f = frame({ health: 0.5 });
    for (let x = 3; x < 10; x++) for (const y of [25, 26]) f.set([90, 190, 50], (y * FN_W + x) * 3);
    expect(barFill(barRuns(f).green, cal)).toBe(500);
  });
});

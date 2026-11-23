import { describe, expect, it } from "vitest";
import { bestFrame, buildEvents, gameplayShareOf, isGameplay, overlayReliable, findDamage, findDead, findDeaths, findLowHealth, mergeEvents, topPayoffs, type GameEvent } from "./events";
import { createVisualParser, FRAME_BYTES, frameMetrics, heartHealth, HEART_H, OVERLAY_H, overlayScores, VISUAL_W, type FrameMetrics, type VisualSignals } from "./visual";
import { outToSource, sourceThumbMs, thumbFromSourceArgs } from "./thumbFrame";
import type { Segment } from "../youtube/analysis";

const play: FrameMetrics = { motion: 8, red: 20, luma: 110, sharp: 9, ui: 0, tint: 2, health: 1000 };
/** 4 frames per second; `at(sec)` sets what happens from that second on. */
function visual(seconds: number, at: (sec: number) => Partial<FrameMetrics>): VisualSignals {
  const frames = Array.from({ length: seconds * 4 }, (_, i) => ({ ...play, ...at(i / 4) }));
  return { version: 3, fps: 4, width: 96, height: 54, durationMs: seconds * 1000, frames };
}

describe("hearts", () => {
  const strip = (redSlots: number) => {
    const s = new Uint8Array(VISUAL_W * HEART_H * 3);
    for (let y = 0; y < HEART_H; y++) {
      for (let x = 0; x < VISUAL_W; x++) {
        const red = x < (redSlots * VISUAL_W) / 10;
        s.set(red ? [200, 28, 30] : [45, 45, 45], (y * VISUAL_W + x) * 3);
      }
    }
    return s;
  };
  it("counts red hearts from the left, half hearts included", () => {
    expect(heartHealth(strip(10))).toBe(1000);
    expect(heartHealth(strip(3.5))).toBe(350);
  });
  it("orange-red leaves are no hearts, and no red at all means no HUD", () => {
    const leaves = new Uint8Array(VISUAL_W * HEART_H * 3).map((_, i) => [131, 62, 38][i % 3]);
    expect(heartHealth(leaves)).toBe(-1);
    expect(heartHealth(strip(0))).toBe(-1);
  });
  it("sees a light Bedrock menu panel", () => {
    const panel = new Uint8Array(96 * 54 * 3).fill(235);
    expect(frameMetrics(panel, null).metrics.ui).toBe(1000);
  });
  // 23-11-2026, "22/11 minecraft" (Horror Survival add-on): colours measured on the real recording.
  it("counts light-blue frozen hearts, but not near-white snow", () => {
    const frozen = new Uint8Array(VISUAL_W * HEART_H * 3);
    for (let i = 0; i < VISUAL_W * HEART_H; i++) frozen.set(i % VISUAL_W < 67 ? [175, 226, 252] : [45, 45, 45], i * 3);
    expect(heartHealth(frozen)).toBe(700);
    const snow = new Uint8Array(VISUAL_W * HEART_H * 3).map((_, i) => [236, 242, 250][i % 3]);
    expect(heartHealth(snow)).toBe(-1);
  });
  it("sees a teal add-on menu panel as much as a grey one", () => {
    const half = new Uint8Array(96 * 54 * 3).map((_, i) => (Math.floor(i / 3) % 2 ? [145, 197, 195] : [60, 70, 90])[i % 3]);
    expect(frameMetrics(half, null).metrics.ui).toBe(1000);
    const water = new Uint8Array(96 * 54 * 3).map((_, i) => [67, 140, 238][i % 3]);
    expect(frameMetrics(water, null).metrics.ui).toBe(0);
  });
});

describe("Event Timeline", () => {
  it("finds a hit of several hearts once, not per frame", () => {
    const v = visual(20, (s) => ({ health: s < 10 ? 900 : s < 11 ? 600 : 350 }));
    const hits = findDamage(v);
    expect(hits).toHaveLength(1);
    expect(hits[0].from).toBe(900);
    expect(hits[0].to).toBe(350);
    expect(hits[0].atMs).toBeGreaterThanOrEqual(9000);
    expect(hits[0].atMs).toBeLessThanOrEqual(11_000);
  });

  it("a menu in between does not split a low-health stretch", () => {
    const v = visual(30, (s) => ({ health: s < 5 ? 1000 : s >= 12 && s < 15 ? -1 : s < 25 ? 300 : 1000 }));
    const low = findLowHealth(v);
    expect(low).toHaveLength(1);
    expect(low[0].startMs).toBe(5000);
  });

  it("finds the GAME OVER screen right after gameplay, but not the red loading screen at the start", () => {
    const deathLook = { tint: 22, luma: 39, health: -1, motion: 0.4 };
    const v = visual(40, (s) => (s < 4 ? deathLook : s < 30 ? {} : deathLook));
    expect(findDeaths(v)).toEqual([30_000]);
  });

  it("marks menus, stillness and black as dead parts", () => {
    const v = visual(12, (s) => (s >= 2 && s < 4 ? { ui: 600, health: -1 } : s >= 6 && s < 8 ? { motion: 0.2 } : s >= 9 && s < 10 ? { luma: 5 } : {}));
    expect(findDead(v, null).map((d) => d.why)).toEqual(["menu", "still", "black"]);
  });

  it("picks a sharp gameplay frame, not a menu", () => {
    const v = visual(10, (s) => (s >= 4 && s < 5 ? { ui: 500, sharp: 20, health: -1 } : s === 5.5 ? { sharp: 15, motion: 2 } : {}));
    expect(bestFrame(v, 4000, 6000)).toBe(5500);
  });

  it("builds a timeline without AI: death and damage, best payoff first", () => {
    const v = visual(60, (s) => (s < 20 ? {} : s < 21 ? { health: 400 } : s < 50 ? { health: 350 } : { tint: 22, luma: 39, health: -1, motion: 0.3 }));
    const t = buildEvents({ visual: v, signals: null, now: new Date("2026-11-16T00:00:00Z") });
    expect(t.engine).toBe("free");
    const top = topPayoffs(t, 3, 0);
    expect(top[0].kind).toBe("death");
    expect(top[0].type).toBe("fail");
    expect(t.events.some((e) => e.kind === "damage" && e.type === "bijna_dood")).toBe(true);
    expect(t.events.every((e) => e.t_start <= e.t_peak && e.t_peak <= e.t_end)).toBe(true);
  });

  it("merges AI moments with what the picture shows and raises the payoff", () => {
    const v = visual(30, (s) => ({ health: s < 10 ? 1000 : 500 }));
    const free = buildEvents({ visual: v, signals: null });
    const withAi = buildEvents({ visual: v, signals: null, ai: [{ kind: "near_death", type: "bijna_dood", startMs: 7000, peakMs: 10_000, endMs: 13_000, score: 80, reason: "Creeper ontploft naast hem" }] });
    expect(withAi.engine).toBe("free+ai");
    const merged = withAi.events.find((e) => e.sources.includes("ai:near_death"))!;
    expect(merged.sources).toContain("beeld:hartjes");
    expect(merged.payoff).toBeGreaterThan(Math.max(...free.events.map((e) => e.payoff)));
  });

  it("merge keeps the strongest and widens the range", () => {
    const e = (peak: number, payoff: number, kind: GameEvent["kind"]): GameEvent => ({ id: kind, kind, type: null, t_start: peak - 1000, t_peak: peak, t_end: peak + 1000, intensity: 0.5, payoff, description: kind, t_thumb: peak, sources: [kind] });
    const out = mergeEvents([e(1000, 40, "audio_peak"), e(2500, 70, "damage"), e(9000, 30, "action")]);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("damage");
    expect(out[0].t_start).toBe(0);
    expect(out[0].payoff).toBe(76);
  });
});

describe("thumbnail frame from the recording", () => {
  const segs: Segment[] = [
    { part: "hook", src_start_ms: 50_000, src_end_ms: 52_000, out_start_ms: 0, speed: 1, effects: [], note: "" },
    { part: "build", src_start_ms: 30_000, src_end_ms: 40_000, out_start_ms: 2000, speed: 2, effects: [], note: "" },
  ];
  it("maps montage time to recording time, also in sped-up parts", () => {
    expect(outToSource(segs, 1000)).toBe(51_000);
    expect(outToSource(segs, 3000)).toBe(32_000);
  });
  it("uses the best event the video really shows", () => {
    const t = buildEvents({ visual: visual(60, () => ({})), signals: null });
    t.events = [
      { id: "a", kind: "death", type: "fail", t_start: 0, t_peak: 0, t_end: 0, intensity: 1, payoff: 95, description: "", t_thumb: 10_000, sources: [] },
      { id: "b", kind: "damage", type: "fail", t_start: 0, t_peak: 0, t_end: 0, intensity: 1, payoff: 60, description: "", t_thumb: 51_500, sources: [] },
    ];
    expect(sourceThumbMs(segs, t, 0)).toEqual({ srcMs: 51_500, eventId: "b" });
    expect(sourceThumbMs(segs, null, 1000)).toEqual({ srcMs: 51_000, eventId: null });
  });
  it("frames a Short like the montage and draws the header last", () => {
    const args = thumbFromSourceArgs("rec.webm", [51_500], { width: 1080, height: 1920 }, "thumb0.ass", "out.jpg").join(" ");
    expect(args).toContain("-ss 51.500 -i rec.webm");
    expect(args).toContain("scale=-2:1920,crop=1080:1920");
    expect(args).toMatch(/subtitles=thumb0\.ass\[v\]/);
  });
});

describe("menus found by the missing hearts", () => {
  it("no hearts for 1 s while barely moving = menu; moving without hearts (odd hearts) is no menu", () => {
    const v = visual(12, (s) => (s >= 2 && s < 5 ? { health: -1, motion: 0.8 } : s >= 7 && s < 10 ? { health: -1, motion: 12 } : {}));
    const dead = findDead(v, null);
    expect(dead.map((d) => [d.startMs, d.endMs, d.why])).toEqual([[2000, 5000, "menu"]]);
  });
});

describe("menu en inventaris rond een moment (22-11-2026)", () => {
  it("counts frames without hearts or with the grey panel around the peak", async () => {
    const { menuShare } = await import("./events");
    const frame = (health: number, ui = 0) => ({ luma: 100, motion: 5, sharp: 10, ui, health, tint: 0 });
    const v = { fps: 1, durationMs: 20_000, frames: [...Array(10)].map(() => frame(1000)).concat([...Array(10)].map(() => frame(-1))) } as unknown as Parameters<typeof menuShare>[0];
    expect(menuShare(v, 4000)).toBe(0);
    expect(menuShare(v, 15_000)).toBeGreaterThan(0.5);
  });
});

describe("hartjes niet herkenbaar (23-11-2026)", () => {
  it("without recognisable hearts only the grey menu panel counts as menu", async () => {
    const { heartsReliable, menuShare } = await import("./events");
    const frame = (health: number, ui = 0) => ({ luma: 100, motion: 5, sharp: 10, ui, health, tint: 0 });
    const frozen = { fps: 1, durationMs: 20_000, frames: [...Array(20)].map(() => frame(-1)) } as unknown as Parameters<typeof menuShare>[0];
    expect(heartsReliable(frozen)).toBe(false);
    expect(menuShare(frozen, 10_000)).toBe(0);
    const panel = { ...frozen, frames: [...Array(20)].map((_, i) => frame(-1, i >= 8 ? 200 : 0)) } as unknown as Parameters<typeof menuShare>[0];
    expect(menuShare(panel, 10_000)).toBeGreaterThan(0.5);
  });
});

describe("HUD template (23-11-2026, menus in any colour)", () => {
  const band = (fill: (p: number) => [number, number, number]) => {
    const b = new Uint8Array(VISUAL_W * OVERLAY_H * 3);
    for (let p = 0; p < VISUAL_W * OVERLAY_H; p++) b.set(fill(p), p * 3);
    return b;
  };
  // The HUD: the bottom rows are a fixed hotbar; above it the world changes every frame.
  const hud = (seed: number) => band((p) => (Math.floor(p / VISUAL_W) >= 8 ? [90, 160, 170] : [(seed * 37 + p * 11) % 255, (seed * 53 + p * 7) % 255, (seed * 17 + p * 3) % 255]));
  const menu = () => band(() => [40, 170, 60]);

  it("scores the recording's own HUD high and a covered HUD low, whatever its colour", () => {
    const frames = [...Array.from({ length: 40 }, (_, i) => hud(i)), ...Array.from({ length: 10 }, menu)];
    const s = overlayScores(frames);
    expect(Math.min(...s.slice(0, 40))).toBeGreaterThanOrEqual(900);
    expect(Math.max(...s.slice(40))).toBeLessThan(100);
  });

  it("says 'not measurable' when nothing at the bottom stays the same", () => {
    const s = overlayScores(Array.from({ length: 30 }, (_, i) => band((p) => [(i * 31 + p) % 255, (i * 17 + p * 5) % 255, (i * 7 + p * 9) % 255])));
    expect(s.every((x) => x === -1)).toBe(true);
  });

  it("a covered HUD is no gameplay, only when the template is reliable for this recording", () => {
    const v = visual(20, (sec) => ({ overlay: sec >= 15 ? 50 : 950, health: -1 }));
    expect(overlayReliable(v)).toBe(true);
    expect(isGameplay(v, 4 * 16)).toBe(false);
    expect(isGameplay(v, 4 * 5)).toBe(true);
    expect(gameplayShareOf(v, [{ startMs: 10_000, endMs: 20_000 }])).toBeCloseTo(0.5, 1);
    const unknown = visual(20, () => ({ overlay: -1, health: -1 }));
    expect(overlayReliable(unknown)).toBe(false);
    expect(isGameplay(unknown, 10)).toBe(true);
  });
  it("counting frames is cheap and separate from finish (finish builds the template once)", () => {
    const parser = createVisualParser(10_000);
    const frame = new Uint8Array(FRAME_BYTES).fill(90);
    for (let i = 0; i < 40; i++) parser.feed(frame);
    expect(parser.count()).toBe(40);
    expect(parser.finish().frames).toHaveLength(40);
  });
});

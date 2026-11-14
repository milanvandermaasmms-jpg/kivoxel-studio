import { describe, expect, it } from "vitest";
import { fireGlowAt, FPS, LOOP_S, particlesAt, windowPx, type Region } from "./overlay";

const reg: Region = { window: { cx: 0.46, cy: 0.33, r: 0.19 }, fire: { x: 0.29, y: 0.66, r: 0.12 } };

describe("living layers", () => {
  it("loop without a seam: the last frame flows into the first", () => {
    for (const w of ["rain", "snow"] as const) {
      const a = particlesAt(0, reg, w), b = particlesAt(LOOP_S, reg, w);
      expect(b.length).toBe(a.length);
      a.forEach((p, i) => {
        expect(b[i].x).toBeCloseTo(p.x, 3);
        expect(b[i].y).toBeCloseTo(p.y, 3);
      });
      expect(fireGlowAt(LOOP_S)).toBeCloseTo(fireGlowAt(0), 6);
    }
  });
  it("rain, snow and fireflies stay inside the window", () => {
    const win = windowPx(reg);
    for (let t = 0; t < LOOP_S; t += 1.3)
      for (const p of particlesAt(t, reg, "snow").filter((p) => p.kind !== "dust")) expect((p.x - win.cx) ** 2 + (p.y - win.cy) ** 2).toBeLessThanOrEqual(win.r ** 2 + 1e-6);
  });
  it("snow falls slowly, rain faster, but nothing jumps between two frames", () => {
    const step = (w: "rain" | "snow") => {
      const a = particlesAt(5, reg, w), b = particlesAt(5 + 1 / FPS, reg, w);
      // The same particle one frame later (a falling one that wraps to the top is not a jump on screen: it fades in at the edge).
      return Math.max(...a.map((p) => { const q = b.find((x) => x.id === p.id); return q ? Math.abs(q.y - p.y) : 0; }).filter((d) => d < 300));
    };
    expect(step("snow")).toBeLessThan(3);
    expect(step("rain")).toBeLessThan(40);
  });
  it("the fire glow breathes softly and never flashes", () => {
    let maxStep = 0;
    for (let f = 0; f < LOOP_S * FPS; f++) {
      const g = fireGlowAt(f / FPS);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(fireGlowAt((f + 1) / FPS) - g));
    }
    expect(maxStep).toBeLessThan(0.08);
  });
  it("particles are soft and faint (light, not objects)", () => {
    for (const p of particlesAt(3, reg, "snow")) expect(p.a).toBeLessThanOrEqual(0.71);
  });
});

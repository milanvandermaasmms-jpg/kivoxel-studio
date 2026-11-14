// Dreamnest fase 6: procedural "living" layers (megaprompt §4): rain or snow and fireflies behind the window, dust in
// the moonlight, a softly flickering fire glow. Pure math, tested; the worker draws the frames (worker/dreamnest/overlay.ts).
// Everything is periodic in LOOP_S, so the layer loops without a seam. Only light and soft particles: never a flash.

export const LOOP_S = 20;
export const FPS = 24;
export const W = 1920, H = 1080;

/** Where the window and the fire are in a keyframe, as fractions of width/height (r as a fraction of the height). */
export type Region = { window: { cx: number; cy: number; r: number }; fire?: { x: number; y: number; r: number } };
export type Weather = "rain" | "snow";
export type Particle = { id: number; kind: "drop" | "flake" | "firefly" | "dust"; x: number; y: number; r: number; a: number };

/** Deterministic little random generator (same seed, same layer). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** The window circle in pixels, a bit smaller than the glass so nothing ever falls over the window frame. */
export function windowPx(reg: Region) {
  return { cx: reg.window.cx * W, cy: reg.window.cy * H, r: reg.window.r * H * 0.9 };
}
const inside = (x: number, y: number, c: { cx: number; cy: number; r: number }) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2;

/**
 * All particles at time t (seconds). Falling things move an integer number of window heights per loop, so frame
 * LOOP_S equals frame 0. Particles outside the window circle are not drawn (weather and fireflies are outside).
 */
export function particlesAt(t: number, reg: Region, weather: Weather, seed = 1): Particle[] {
  const r = rng(seed);
  const win = windowPx(reg);
  const top = win.cy - win.r, span = 2 * win.r;
  const phase = (t % LOOP_S) / LOOP_S;
  const out: Particle[] = [];
  const count = weather === "rain" ? 70 : 90;
  for (let i = 0; i < count; i++) {
    const x0 = win.cx - win.r + r() * span;
    const y0 = r();
    const laps = weather === "rain" ? 6 + Math.floor(r() * 5) : 1 + Math.floor(r() * 2);
    const sway = weather === "snow" ? Math.sin(2 * Math.PI * (phase * (1 + Math.floor(r() * 2)) + r())) * (4 + r() * 6) : 0;
    const x = x0 + sway;
    const y = top + (((y0 + phase * laps) % 1) + 1) % 1 * span;
    const size = weather === "rain" ? 0.8 + r() * 0.6 : 1.2 + r() * 2.2;
    const a = weather === "rain" ? 0.12 + r() * 0.12 : 0.35 + r() * 0.35;
    if (inside(x, y, win)) out.push({ id: i, kind: weather === "rain" ? "drop" : "flake", x, y, r: size, a });
  }
  // A few fireflies in the garden, slowly wandering and glowing up and down.
  for (let i = 0; i < 6; i++) {
    const bx = win.cx + (r() - 0.5) * win.r * 1.2, by = win.cy + r() * win.r * 0.6;
    const k1 = 1 + Math.floor(r() * 2), k2 = 1 + Math.floor(r() * 2), p1 = r(), p2 = r();
    const x = bx + Math.sin(2 * Math.PI * (phase * k1 + p1)) * win.r * 0.12;
    const y = by + Math.sin(2 * Math.PI * (phase * k2 + p2)) * win.r * 0.06;
    const glow = 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase * (2 + Math.floor(r() * 2)) + r()));
    if (inside(x, y, win)) out.push({ id: 1000 + i, kind: "firefly", x, y, r: 2.2, a: 0.25 + 0.45 * glow });
  }
  // Dust in the moonlight: tiny specks drifting slowly in the room just below the window.
  for (let i = 0; i < 24; i++) {
    const bx = win.cx + (r() - 0.5) * win.r * 2.4, by = win.cy + win.r * (0.9 + r() * 1.1);
    const k = 1 + Math.floor(r() * 2), p = r();
    const x = bx + Math.sin(2 * Math.PI * (phase * k + p)) * 18;
    const y = by + Math.cos(2 * Math.PI * (phase * k + p)) * 10;
    if (y < H && x > 0 && x < W) out.push({ id: 2000 + i, kind: "dust", x, y, r: 1 + r() * 0.8, a: 0.12 + r() * 0.12 });
  }
  return out;
}

/** Fire glow strength (0..1) at time t: a sum of slow waves, periodic in LOOP_S, never a jump (max change per frame small). */
export function fireGlowAt(t: number, seed = 1): number {
  const r = rng(seed + 99);
  const waves = [1, 2, 3, 5, 7].map((k) => ({ k, a: 0.5 / k + r() * 0.1, p: r() }));
  const sum = waves.reduce((s, w) => s + w.a * Math.sin(2 * Math.PI * (w.k * (t % LOOP_S) / LOOP_S + w.p)), 0);
  const max = waves.reduce((s, w) => s + w.a, 0);
  return 0.5 + 0.5 * (sum / max);
}

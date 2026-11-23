// KIVOXEL fase 1, Event Timeline: free picture signals, measured on tiny frames (96x54, 4 per second).
// Per frame: how much moves, how red the screen is, how dark it is, how sharp, how much of it is the grey
// Minecraft menu/inventory panel, and how full the health bar (hearts in the HUD) is. Nothing leaves the pc.
//
// Hearts: on Milan's PS5 recordings (Bedrock, 1920x1088) the heart row sits at 31.1-47.9% of the width and
// 84.4-86.9% of the height (measured on "Hardcore Dane!!", 16-11-2026). FFmpeg cuts that strip out of every frame
// and puts it, 96x8 pixels, under the small picture, so one decode gives both.
//
// 23-11-2026: add-ons change the HUD. In "22/11 minecraft" (Horror Survival add-on) the hearts are light-blue frozen
// hearts and every menu is a teal panel (RGB 145,197,195) instead of the near-white Bedrock grey. Both are recognized
// now (HUD_VERSION 2); older caches in which no heart was ever found are measured again.

export const VISUAL_W = 96;
export const VISUAL_H = 54;
export const VISUAL_FPS = 4;
export const HEART_H = 8;
export const HEART_CROP = { x: 0.311, y: 0.844, w: 0.168, h: 0.025 };
/** Raise when the HUD recognition changes, so recordings without recognized hearts are measured again. */
export const HUD_VERSION = 3;
/** 23-11-2026 (HUD_VERSION 3): the bottom 20% of the picture, where the HUD (hotbar, hearts) always sits. */
export const OVERLAY_H = 12;
export const FRAME_BYTES = VISUAL_W * (VISUAL_H + HEART_H + OVERLAY_H) * 3;
/** Fewer stable HUD pixels than this: the recording has no fixed HUD (hidden HUD, moving camera UI); not measurable. */
export const OVERLAY_MIN_STABLE = 40;

/** One frame, small numbers so a long recording stays a small file. */
export type FrameMetrics = {
  /** Mean change in brightness from the previous frame, 0-255. */
  motion: number;
  /** Share of strongly red pixels, 0-1000. */
  red: number;
  /** Mean brightness, 0-255. */
  luma: number;
  /** Mean brightness step between neighbouring pixels: higher = sharper, 0-255. */
  sharp: number;
  /** Share of the Minecraft panel colour (inventory, chest, crafting, menus), 0-1000. */
  ui: number;
  /** Mean red minus mean of green and blue, -255..255: a red-tinted screen (the hardcore "GAME OVER" screen) is clearly positive. */
  tint: number;
  /**
   * 23-11-2026: how much of this recording's own fixed HUD is in view, 0-1000 (-1 = not measurable). Colour- and
   * position-free: menus of any add-on (teal, green, light blue), death and loading screens cover the HUD.
   */
  overlay?: number;
  /** Health bar 0-1000 (full = 1000), or -1 when no heart row is visible (menu, loading, death screen). */
  health: number;
};

export type VisualSignals = { version: 3; hud?: number; fps: number; width: number; height: number; durationMs: number; frames: FrameMetrics[] };

const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Metrics of one RGB24 frame; `previous` is the brightness map of the frame before (for motion). */
export function frameMetrics(rgb: Uint8Array, previous: Float32Array | null, width = VISUAL_W, height = VISUAL_H): { metrics: FrameMetrics; luma: Float32Array } {
  const n = width * height;
  const luma = new Float32Array(n);
  let red = 0;
  let ui = 0;
  let sum = 0;
  let tint = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const l = lumaOf(r, g, b);
    luma[i] = l;
    sum += l;
    tint += r - (g + b) / 2;
    if (r > 110 && r > g * 1.9 && r > b * 1.9) red++;
    // Bedrock panels (chest, inventory, crafting) are near-white RGB 235,235,235; older menus are 198 grey.
    const neutral = Math.abs(r - g) < 6 && Math.abs(g - b) < 6;
    if (neutral && (Math.abs(r - 235) < 9 || Math.abs(r - 198) < 9)) ui++;
    // Add-on panels (Horror Survival, 22-11-2026) are teal 145,197,195. Only about half of such a panel is that flat
    // colour (the slots are textured), so it counts double: a menu then reaches the same share as a grey one.
    else if (Math.abs(r - 145) < 10 && Math.abs(g - 197) < 10 && Math.abs(b - 195) < 10) ui += 2;
  }
  let motion = 0;
  if (previous && previous.length === n) {
    for (let i = 0; i < n; i++) motion += Math.abs(luma[i] - previous[i]);
    motion /= n;
  }
  let edges = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      edges += Math.abs(luma[i] - luma[i + 1]) + Math.abs(luma[i] - luma[i + width]);
    }
  }
  const sharp = edges / (2 * (width - 1) * (height - 1));
  return {
    metrics: { motion: Math.round(motion * 10) / 10, red: Math.round((red / n) * 1000), luma: Math.round(sum / n), sharp: Math.round(sharp * 10) / 10, ui: Math.round((ui / n) * 1000), tint: Math.round(tint / n), health: -1 },
    luma,
  };
}

/**
 * How full the heart row is. The strip holds 10 heart slots side by side. A slot half counts when its left half is
 * red, whole when its right half is red too. Hearts always empty from the right, so only the red slots counted
 * from the left edge, without a gap, count: red leaves or lava behind the HUD cannot fake health that way.
 * No red in the first slot: no HUD in view (menu, inventory, loading, death screen) -> -1.
 */
export function heartHealth(strip: Uint8Array, width = VISUAL_W, height = HEART_H): number {
  const isRed = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    const r = strip[i];
    const g = strip[i + 1];
    const b = strip[i + 2];
    // Hearts are pure red (green and blue equally low); autumn leaves and lava behind the HUD are orange-red.
    if (r > 120 && g < 50 && b < 55 && Math.abs(g - b) < 18 && r > g * 2.5) return true;
    // Frozen hearts (powder snow, or add-ons that draw them always) are light blue; snow behind the HUD is near-white.
    return b >= 200 && g >= 180 && r >= 110 && b - r >= 35;
  };
  const share = (x0: number, x1: number) => {
    let red = 0;
    let all = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x1)); x++) {
        all++;
        if (isRed(x, y)) red++;
      }
    }
    return all ? red / all : 0;
  };
  const slot = width / 10;
  let halves = 0;
  for (let k = 0; k < 10; k++) {
    const left = share(k * slot + slot * 0.1, k * slot + slot * 0.5);
    const right = share(k * slot + slot * 0.5, k * slot + slot * 0.9);
    if (left < 0.3) break;
    halves++;
    if (right < 0.3) break;
    halves++;
  }
  return halves === 0 ? -1 : halves * 50;
}

/**
 * 23-11-2026: the recording's own HUD as a template. Per pixel of the bottom band the median over the recording (one
 * frame per second); "stable" pixels are those that match it in at least 60% of the frames (the HUD, not the world
 * behind it). Per frame: the share of stable pixels that match. Measured on "22/11 minecraft": menus 0-100, gameplay
 * 700-1000; on two other recordings gameplay 380-1000. Fewer than OVERLAY_MIN_STABLE stable pixels: -1 for every frame.
 */
export function overlayScores(bands: Uint8Array[], width = VISUAL_W, height = OVERLAY_H, tolerance = 18): number[] {
  if (!bands.length) return [];
  const step = Math.max(1, Math.floor(bands.length / 1200));
  const sample = bands.filter((_, i) => i % step === 0);
  const n = width * height * 3;
  const median = new Uint8Array(n);
  const column = new Uint8Array(sample.length);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < sample.length; j++) column[j] = sample[j][k];
    median[k] = column.slice().sort()[sample.length >> 1];
  }
  const close = (b: Uint8Array, p: number) => Math.abs(b[p * 3] - median[p * 3]) < tolerance && Math.abs(b[p * 3 + 1] - median[p * 3 + 1]) < tolerance && Math.abs(b[p * 3 + 2] - median[p * 3 + 2]) < tolerance;
  const stable: number[] = [];
  for (let p = 0; p < width * height; p++) {
    let hits = 0;
    for (const b of sample) if (close(b, p)) hits++;
    if (hits >= 0.6 * sample.length) stable.push(p);
  }
  if (stable.length < OVERLAY_MIN_STABLE) return bands.map(() => -1);
  return bands.map((b) => {
    let m = 0;
    for (const p of stable) if (close(b, p)) m++;
    return Math.round((m / stable.length) * 1000);
  });
}

/** Reads a stream of RGB24 frames (FFmpeg rawvideo) in chunks of any size. */
export function createVisualParser(durationMs: number) {
  let buffer = new Uint8Array(0);
  let previous: Float32Array | null = null;
  const frames: FrameMetrics[] = [];
  const bands: Uint8Array[] = [];
  return {
    feed(chunk: Uint8Array) {
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      let offset = 0;
      while (joined.length - offset >= FRAME_BYTES) {
        const picture = joined.subarray(offset, offset + VISUAL_W * VISUAL_H * 3);
        const strip = joined.subarray(offset + VISUAL_W * VISUAL_H * 3, offset + FRAME_BYTES);
        const { metrics, luma } = frameMetrics(picture, previous);
        frames.push({ ...metrics, health: heartHealth(strip) });
        bands.push(joined.slice(offset + VISUAL_W * (VISUAL_H + HEART_H) * 3, offset + FRAME_BYTES));
        previous = luma;
        offset += FRAME_BYTES;
      }
      buffer = joined.slice(offset);
    },
    finish(): VisualSignals {
      const overlay = overlayScores(bands);
      overlay.forEach((o, i) => (frames[i].overlay = o));
      return { version: 3, hud: HUD_VERSION, fps: VISUAL_FPS, width: VISUAL_W, height: VISUAL_H, durationMs, frames };
    },
  };
}

/** FFmpeg arguments: tiny frames with the heart strip underneath, raw RGB on stdout. */
export function visualArgs(input: string): string[] {
  const c = HEART_CROP;
  const graph = `[0:v]fps=${VISUAL_FPS},split=3[a][b][c];[a]scale=${VISUAL_W}:${VISUAL_H}:flags=area[p];[b]crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y},scale=${VISUAL_W}:${HEART_H}:flags=area[h];[c]crop=iw:ih*0.2:0:ih*0.8,scale=${VISUAL_W}:${OVERLAY_H}:flags=area[o];[p][h][o]vstack=3,format=rgb24[out]`;
  return ["-hide_banner", "-loglevel", "error", "-i", input, "-an", "-filter_complex", graph, "-map", "[out]", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"];
}

/** Values per second (mean of the frames in that second): easier to reason about than per frame. */
export function perSecond(v: VisualSignals, key: keyof FrameMetrics, how: "mean" | "max" = "mean"): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.frames.length; i += v.fps) {
    const slice = v.frames.slice(i, i + v.fps).map((f) => f[key] ?? -1);
    out.push(how === "max" ? Math.max(...slice) : slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

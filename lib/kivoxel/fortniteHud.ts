// 24-11-2026 (superprompt: herkenning per game): Fortnite's own HUD, free and on this pc. Bottom left Fortnite always
// shows two bars: blue shield on top, green health underneath. Where exactly depends on the player and the device
// ("22/11 FORTNITE": x 3-16% of the width; "20-11 fortnite" on the PS5: further right, bigger, paler colours), so
// nothing is fixed: per recording the bar is found where a long green run keeps starting at the same column, and
// "full" is how far it reaches when health is full. Per frame: how full it is, 0-1000, on the same scale as the
// Minecraft hearts, so the existing rules for damage and low health work for Fortnite too. Pure, tested.

export const FN_W = 96;
export const FN_H = 32;
export const FN_FPS = 4;
/** The bottom-left corner in which both bars sit on every recording seen so far. */
export const FN_CROP = { x: 0, y: 0.82, w: 0.3, h: 0.16 };
/** 24-11-2026: Roblox (Rivals and other shooters): a green health bar in the bottom-left corner, lower than Fortnite's. */
export const RB_CROP = { x: 0, y: 0.88, w: 0.3, h: 0.12 };
export type Crop = { x: number; y: number; w: number; h: number };
export const FN_FRAME_BYTES = FN_W * FN_H * 3;

export type Run = { row: number; start: number; end: number };
export type Calibration = { row: number; left: number; full: number };
export type FortniteSignals = { version: 1; fps: number; health: number[]; shield: number[]; cal: { health: Calibration | null; shield: Calibration | null } };

// Green, and also yellow-green: a golden glow (an item, a rift) or the bar's own yellow tip tints it yellow ("22/11 FORTNITE" 8:05).
const isGreen = (r: number, g: number, b: number) => g >= 110 && g - b >= 50 && g + 15 >= r;
const isBlue = (r: number, g: number, b: number) => b >= 140 && b - r >= 50 && b - g >= 15;
const MIN_RUN = 6;

/** Per frame every green and every blue horizontal run of at least MIN_RUN pixels (the bars are among them). */
export function barRuns(rgb: Uint8Array, width = FN_W, height = FN_H): { green: Run[]; blue: Run[] } {
  const runs = (test: (r: number, g: number, b: number) => boolean): Run[] => {
    const out: Run[] = [];
    for (let y = 0; y < height; y++) {
      let start = -1;
      for (let x = 0; x <= width; x++) {
        const i = (y * width + x) * 3;
        const hit = x < width && test(rgb[i], rgb[i + 1], rgb[i + 2]);
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          // A run that touches the edge of the corner is grass, sky or a wall cut off by the crop: a bar never does.
          if (x - start >= MIN_RUN && start > 0 && x < width) out.push({ row: y, start, end: x - 1 });
          start = -1;
        }
      }
    }
    return out;
  };
  return { green: runs(isGreen), blue: runs(isBlue) };
}

/**
 * Where the bar is in this recording: the row and left edge that the most frames share (grass or a wall behind the
 * corner moves around, the bar does not), and how far a full bar reaches (95th percentile of the right ends).
 * Too few frames with it: no bar in this recording (another game mode, HUD hidden).
 */
export function calibrate(frames: Run[][]): Calibration | null {
  const votes = new Map<string, number>();
  for (const runs of frames) {
    const seen = new Set<string>();
    for (const r of runs) {
      const k = `${r.row}:${r.start}`;
      if (!seen.has(k)) votes.set(k, (votes.get(k) ?? 0) + 1), seen.add(k);
    }
  }
  // Teammates' bars sit higher up in the same corner and are always there too, but shorter: of the edges that many
  // frames share, the player's own bar is the longest one (and the lowest when two are as long).
  const most = Math.max(0, ...votes.values());
  let best: Calibration | null = null;
  for (const [k, n] of votes) {
    if (n < Math.max(20, most * 0.3)) continue;
    const [row, left] = k.split(":").map(Number);
    const ends = frames.map((runs) => pick(runs, row, left)).filter((r): r is Run => !!r).map((r) => r.end).sort((x, y) => x - y);
    if (ends.length < 20) continue;
    const full = ends[Math.min(ends.length - 1, Math.floor(ends.length * 0.95))];
    if (full - left + 1 < 10) continue;
    const len = full - left;
    const bestLen = best ? best.full - best.left : -1;
    if (len > bestLen + 1 || (Math.abs(len - bestLen) <= 1 && best && row > best.row)) best = { row, left, full };
  }
  return best;
}

/**
 * The shield bar sits right above the health bar, as long and starting at about the same column. Only there is a blue
 * run counted (blue sky or water elsewhere in the corner is not a shield).
 */
export function calibrateShield(frames: Run[][], health: Calibration | null): Calibration | null {
  if (!health) return null;
  const votes = new Map<string, number>();
  for (const runs of frames) {
    const seen = new Set<string>();
    for (const r of runs) {
      if (r.row >= health.row || r.row < health.row - 8 || Math.abs(r.start - health.left) > 3) continue;
      const k = `${r.row}:${r.start}`;
      if (!seen.has(k)) votes.set(k, (votes.get(k) ?? 0) + 1), seen.add(k);
    }
  }
  let best = "";
  let most = 0;
  for (const [k, n] of votes) if (n > most) (best = k), (most = n);
  if (most < 20) return null;
  const [row, left] = best.split(":").map(Number);
  return { row, left, full: left + (health.full - health.left) };
}

/**
 * The run of this frame that is the bar: on its row (one pixel up or down) and starting at its left edge. With
 * `merged`, also a run that starts further left: green grass right next to the bar runs into it ("22/11 FORTNITE" 8:02).
 */
function pick(runs: Run[], row: number, left: number, merged = false): Run | null {
  let out: Run | null = null;
  for (const r of runs) {
    const starts = Math.abs(r.start - left) <= 1 || (merged && r.start < left && r.end >= left + MIN_RUN);
    if (Math.abs(r.row - row) <= 1 && starts && (!out || r.end > out.end)) out = r;
  }
  return out;
}

/**
 * One frame on its own is no change: a value counts only when a frame close by (half a second) shows about the same.
 * Grass, a flash or a hand over the corner gives a single wrong length; real damage stays on the bar.
 */
export function steady(values: number[], window = 2, tolerance = 100): number[] {
  return values.map((v, i) => {
    if (v < 0) return v;
    for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) if (j !== i && values[j] >= 0 && Math.abs(values[j] - v) <= tolerance) return v;
    return -1;
  });
}

/** How full the bar is in one frame, 0-1000, or -1 when it is not in view (lobby, map, spectating, eliminated). */
export function barFill(runs: Run[], cal: Calibration | null): number {
  const run = cal ? pick(runs, cal.row, cal.left, true) : null;
  if (!run || !cal) return -1;
  return Math.max(0, Math.min(1000, Math.round(((run.end - cal.left + 1) / (cal.full - cal.left + 1)) * 1000)));
}

/** Reads FFmpeg's raw frames of the corner, in chunks of any size. */
export function createFortniteParser() {
  let buffer = new Uint8Array(0);
  const green: Run[][] = [];
  const blue: Run[][] = [];
  return {
    feed(chunk: Uint8Array) {
      const joined = new Uint8Array(buffer.length + chunk.length);
      joined.set(buffer);
      joined.set(chunk, buffer.length);
      let offset = 0;
      while (joined.length - offset >= FN_FRAME_BYTES) {
        const r = barRuns(joined.subarray(offset, offset + FN_FRAME_BYTES));
        green.push(r.green);
        blue.push(r.blue);
        offset += FN_FRAME_BYTES;
      }
      buffer = joined.slice(offset);
    },
    count: () => green.length,
    finish(): FortniteSignals {
      const ch = calibrate(green);
      const cs = calibrateShield(blue, ch);
      return { version: 1, fps: FN_FPS, health: steady(green.map((r) => barFill(r, ch))), shield: steady(blue.map((r) => barFill(r, cs))), cal: { health: ch, shield: cs } };
    },
  };
}

/** FFmpeg arguments: only the bottom-left corner, small, 4 frames per second, raw RGB on stdout. */
export function fortniteArgs(input: string, c: Crop = FN_CROP): string[] {
  return ["-hide_banner", "-loglevel", "error", "-i", input, "-an", "-vf", `fps=${FN_FPS},crop=iw*${c.w}:ih*${c.h}:iw*${c.x}:ih*${c.y},scale=${FN_W}:${FN_H}:flags=area,format=rgb24`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"];
}

/** True when the health bar was found in enough of the recording to trust it. */
export const fortniteReliable = (s: FortniteSignals | null) => !!s?.cal.health && s.health.filter((h) => h >= 0).length >= Math.max(20, s.health.length * 0.1);

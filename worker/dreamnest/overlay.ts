// Dreamnest fase 6: draws the living layer for one keyframe (rain/snow and fireflies in the window, dust, fire glow)
// as a 20-second seamless loop with transparency (QuickTime RLE). Free, on this pc. The math is in lib/dreamnest/overlay.ts.
import { spawn } from "node:child_process";
import { constants, setPriority } from "node:os";
import { fireGlowAt, FPS, H, LOOP_S, particlesAt, W, windowPx, type Region, type Weather } from "../../lib/dreamnest/overlay.ts";

type Rgb = [number, number, number];
const COLOR: Record<string, Rgb> = { drop: [200, 215, 255], flake: [255, 255, 255], firefly: [255, 236, 150], dust: [255, 240, 220] };

/** "Over" with straight alpha into an RGBA byte buffer. */
function put(buf: Uint8ClampedArray, x: number, y: number, c: Rgb, a: number) {
  if (a <= 0.002 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const A = buf[i + 3] / 255;
  const out = a + A * (1 - a);
  for (let k = 0; k < 3; k++) buf[i + k] = (c[k] * a + buf[i + k] * A * (1 - a)) / out;
  buf[i + 3] = out * 255;
}

/** A soft round dot (or a soft vertical streak for rain), faded out near the window edge so wrapping never pops. */
function dot(buf: Uint8ClampedArray, x: number, y: number, rx: number, ry: number, c: Rgb, a: number) {
  for (let py = Math.floor(y - ry * 2); py <= y + ry * 2; py++)
    for (let px = Math.floor(x - rx * 2); px <= x + rx * 2; px++) {
      const d2 = ((px - x) / rx) ** 2 + ((py - y) / ry) ** 2;
      if (d2 < 4) put(buf, px, py, c, a * Math.exp(-d2));
    }
}

export function drawFrame(buf: Uint8ClampedArray, t: number, reg: Region, weather: Weather, seed = 1) {
  buf.fill(0);
  if (reg.fire) {
    // Warm light around the fire: a soft radial glow whose strength breathes with the fire (light only, never a flash).
    const fx = reg.fire.x * W, fy = reg.fire.y * H, R = reg.fire.r * H * 1.8;
    const g = 0.06 + 0.08 * fireGlowAt(t, seed);
    for (let py = Math.max(0, Math.floor(fy - R)); py < Math.min(H, fy + R); py++)
      for (let px = Math.max(0, Math.floor(fx - R)); px < Math.min(W, fx + R); px++) {
        const d = Math.hypot(px - fx, py - fy) / R;
        if (d < 1) put(buf, px, py, [255, 150, 70], g * (1 - d) ** 2);
      }
  }
  const win = windowPx(reg);
  for (const p of particlesAt(t, reg, weather, seed)) {
    const edge = p.kind === "dust" ? 1 : Math.max(0, Math.min(1, (win.r - Math.hypot(p.x - win.cx, p.y - win.cy)) / 24));
    const a = p.a * edge;
    if (p.kind === "drop") dot(buf, p.x, p.y, p.r, p.r * 7, COLOR.drop, a);
    else if (p.kind === "firefly") {
      dot(buf, p.x, p.y, p.r * 3, p.r * 3, COLOR.firefly, a * 0.35);
      dot(buf, p.x, p.y, p.r, p.r, COLOR.firefly, a);
    } else dot(buf, p.x, p.y, p.r, p.r, COLOR[p.kind], a);
  }
}

/** Renders the 20 s loop to file (.mov, QuickTime RLE with alpha). */
export function renderOverlay(ffmpeg: string, file: string, reg: Region, weather: Weather, seed = 1): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-", "-c:v", "qtrle", file], { windowsHide: true });
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    let err = "";
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(err.slice(-400) || `ffmpeg ${code}`))));
    const buf = new Uint8ClampedArray(W * H * 4);
    let f = 0;
    const next = () => {
      while (f < LOOP_S * FPS) {
        drawFrame(buf, f / FPS, reg, weather, seed);
        f++;
        if (!child.stdin.write(Buffer.from(buf.buffer))) return void child.stdin.once("drain", next);
      }
      child.stdin.end();
    };
    next();
  });
}

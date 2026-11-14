// Dreamnest own synthesizer: soft instruments and room ambience, made from scratch (no samples, no recordings of others).
// Output: stereo Float32 at 48 kHz. Mastering (reverb, filter, loudness) happens afterwards with FFmpeg.
import { midiToHz, rng, type NoteEvent } from "../../../lib/dreamnest/music.ts";

export const SR = 48000;
export type Stereo = { l: Float32Array; r: Float32Array };
export const stereo = (seconds: number): Stereo => ({ l: new Float32Array(Math.ceil(seconds * SR)), r: new Float32Array(Math.ceil(seconds * SR)) });

/** Soft attack (no click), then the instrument's own decay; always a short fade at the end so nothing clicks. */
function envelope(i: number, n: number, attack: number, decay: number) {
  const t = i / SR;
  const a = Math.min(1, t / attack);
  const tail = Math.min(1, (n - i) / (0.02 * SR));
  return a * Math.exp(-t / decay) * tail;
}

function addVoice(out: Stereo, start: number, n: number, pan: number, sample: (i: number) => number) {
  const s0 = Math.floor(start * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < out.l.length; i++) {
    const v = sample(i);
    out.l[s0 + i] += v * gl;
    out.r[s0 + i] += v * gr;
  }
}

export function renderEvents(events: NoteEvent[], seconds: number, seed = 1): Stereo {
  const out = stereo(seconds);
  const r = rng(seed);
  for (const e of events) {
    const f = midiToHz(e.midi);
    const w = 2 * Math.PI * f / SR;
    if (e.instrument === "musicbox" || e.instrument === "celesta") {
      // Bell-like: a few slightly inharmonic partials that die away; celesta is rounder and shorter.
      const parts = e.instrument === "musicbox" ? [[1, 1], [2.01, 0.35], [3.98, 0.12], [5.4, 0.05]] : [[1, 1], [2, 0.25], [3, 0.06]];
      const decay = e.instrument === "musicbox" ? 1.8 : 1.2;
      const n = Math.floor((decay * 4) * SR);
      addVoice(out, e.t, n, (r() - 0.5) * 0.5, (i) => e.vel * 0.25 * envelope(i, n, 0.004, decay) * parts.reduce((s, [k, a]) => s + a * Math.sin(w * k * i) * Math.exp(-(k - 1) * i / SR / 1.2), 0));
    } else if (e.instrument === "harp") {
      // Karplus-Strong plucked string, softened with a gentle average filter.
      const period = Math.max(2, Math.round(SR / f));
      const buf = Float32Array.from({ length: period }, () => r() * 2 - 1);
      // Smooth the starting noise a few times: a soft, round pluck instead of a sharp tick.
      for (let pass = 0; pass < 4; pass++) for (let k = 0; k < period; k++) buf[k] = 0.5 * (buf[k] + buf[(k + 1) % period]);
      const n = Math.floor(3.5 * SR);
      let idx = 0;
      addVoice(out, e.t, n, (r() - 0.5) * 0.8, (i) => {
        const a = buf[idx], b = buf[(idx + 1) % period];
        const v = 0.4985 * (a + b);
        buf[idx] = v;
        idx = (idx + 1) % period;
        return e.vel * 0.3 * v * envelope(i, n, 0.006, 2.5);
      });
    } else if (e.instrument === "felt") {
      // Felt piano (fase 6): a warm hammered string with soft felt. Harmonic partials with slight piano stretch, the
      // higher ones die quickly (that is the "felt"), the note is held for its length and released gently.
      const B = 0.0004;
      const parts = [1, 0.45, 0.2, 0.09, 0.04].map((a, k) => ({ k: k + 1, a, f: (k + 1) * Math.sqrt(1 + B * (k + 1) ** 2), d: (e.midi < 60 ? 3.2 : 2.4) / (1 + k * 0.9) }));
      const hold = Math.floor(Math.max(0.3, e.dur) * SR);
      const n = hold + Math.floor(0.8 * SR);
      addVoice(out, e.t, n, (r() - 0.5) * 0.5, (i) => {
        const t = i / SR;
        const attack = Math.min(1, t / 0.008);
        const release = i < hold ? 1 : Math.exp(-(i - hold) / (0.18 * SR));
        let v = 0;
        for (const p of parts) v += p.a * Math.exp(-t / p.d) * Math.sin(w * p.f * i);
        return e.vel * 0.3 * attack * release * v * Math.min(1, (n - i) / (0.02 * SR));
      });
    } else {
      // Pad: three slightly detuned soft tones with a slow swell in and out.
      const n = Math.floor((e.dur + 2) * SR);
      const det = [0.997, 1, 1.003];
      addVoice(out, e.t, n, (r() - 0.5) * 0.6, (i) => {
        const t = i / SR;
        const swell = Math.min(1, t / 1.5) * Math.min(1, (n - i) / (2 * SR));
        return e.vel * 0.12 * swell * det.reduce((s, d) => s + Math.sin(w * d * i) + 0.25 * Math.sin(2 * w * d * i), 0) / 3;
      });
    }
  }
  return out;
}

/** Brown noise (deep, soft rumble), the bed under the room sounds. */
export function brownNoise(seconds: number, level: number, seed = 3): Stereo {
  const out = stereo(seconds);
  const r = rng(seed);
  let a = 0, b = 0;
  for (let i = 0; i < out.l.length; i++) {
    a = (a + 0.02 * (r() * 2 - 1)) * 0.998;
    b = (b + 0.02 * (r() * 2 - 1)) * 0.998;
    out.l[i] = a * level * 3;
    out.r[i] = b * level * 3;
  }
  return out;
}

/** Fireplace: warm low rumble plus soft, random crackles (never sharp: every crackle has a short soft attack). */
export function fireplace(seconds: number, level: number, seed = 5): Stereo {
  const out = brownNoise(seconds, level * 0.6, seed);
  const r = rng(seed + 1);
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - r()) / 2.5; // about 2.5 soft crackles per second (calmer than a real fire)
    const n = Math.floor((0.004 + r() * 0.02) * SR);
    const amp = level * (0.15 + r() * r() * 0.6);
    let lp = 0;
    addVoice(out, t, n, (r() - 0.5) * 0.6, (i) => {
      lp += 0.35 * ((r() * 2 - 1) - lp);
      return amp * lp * Math.min(1, i / (0.0015 * SR)) * Math.exp(-i / (0.006 * SR));
    });
  }
  return out;
}

/** Rain on the window: filtered noise hiss plus soft drops. */
export function rain(seconds: number, level: number, seed = 9): Stereo {
  const out = stereo(seconds);
  const r = rng(seed);
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < out.l.length; i++) {
    // band-limited hiss: difference of two low-passes
    const nl = r() * 2 - 1, nr = r() * 2 - 1;
    l1 += 0.25 * (nl - l1); l2 += 0.03 * (nl - l2);
    r1 += 0.25 * (nr - r1); r2 += 0.03 * (nr - r2);
    out.l[i] = (l1 - l2) * level * 0.5;
    out.r[i] = (r1 - r2) * level * 0.5;
  }
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - r()) / 14;
    const f = 1800 + r() * 2500;
    const n = Math.floor(0.03 * SR);
    const amp = level * (0.05 + r() * 0.12);
    addVoice(out, t, n, (r() - 0.5) * 1.4, (i) => amp * Math.sin(2 * Math.PI * f * (1 - i / n * 0.3) * i / SR) * Math.min(1, i / (0.002 * SR)) * Math.exp(-i / (0.006 * SR)));
  }
  return out;
}

export function mix(into: Stereo, add: Stereo, gain = 1, offsetS = 0) {
  const o = Math.floor(offsetS * SR);
  for (let i = 0; i < add.l.length && o + i < into.l.length; i++) {
    into.l[o + i] += add.l[i] * gain;
    into.r[o + i] += add.r[i] * gain;
  }
  return into;
}

/** Linear fade in/out (seconds), so every part starts and ends without a click. */
export function fade(s: Stereo, inS: number, outS: number) {
  const n = s.l.length, fi = inS * SR, fo = outS * SR;
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, fi ? i / fi : 1, fo ? (n - 1 - i) / fo : 1);
    s.l[i] *= g;
    s.r[i] *= g;
  }
  return s;
}

export function peak(s: Stereo) {
  let p = 0;
  for (let i = 0; i < s.l.length; i++) p = Math.max(p, Math.abs(s.l[i]), Math.abs(s.r[i]));
  return p;
}

/** 16-bit stereo WAV (the intermediate format before FFmpeg mastering). Scales down if needed, never clips. */
export function wav(s: Stereo): Buffer {
  const n = s.l.length;
  const scale = Math.min(1, 0.95 / Math.max(peak(s), 1e-9));
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s.l[i] * scale)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s.r[i] * scale)) * 32767), 46 + i * 4);
  }
  return buf;
}

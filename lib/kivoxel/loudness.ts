// KIVOXEL fase 1, section 2: exact loudness. One loudnorm pass on a short, dynamic clip (silence, a bang, a voice)
// misses the target; two passes do not: first measure, then correct linearly, then a limiter for the true peak.
// The picture is copied in the second pass (only the sound is made again).

export type LoudnessTarget = { lufs: number; truePeakDb: number; lra: number };
export type Measured = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

export const targetFrom = (s: { target_lufs: number; true_peak_db: number }): LoudnessTarget => ({ lufs: s.target_lufs, truePeakDb: s.true_peak_db, lra: 11 });

/** Pass 1: measure only (FFmpeg prints a JSON block at the end of its log). */
export const measureArgs = (input: string, t: LoudnessTarget) => ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=I=${t.lufs}:TP=${t.truePeakDb - 0.5}:LRA=${t.lra}:print_format=json`, "-f", "null", "-"];

/** The JSON block of pass 1, or null when FFmpeg printed none. */
export function parseMeasured(log: string): Measured | null {
  const block = /\{\s*"input_i"[\s\S]*?\}/.exec(log)?.[0];
  if (!block) return null;
  try {
    const m = JSON.parse(block) as Measured;
    return Number.isFinite(Number(m.input_i)) ? m : null;
  } catch {
    return null;
  }
}

/** Section 9: loudness within ±tolerance LU of the target and true peak at or below the ceiling. */
export function loudnessCheck(integratedLufs: number | null, truePeakDb: number | null, s: { target_lufs: number; lufs_tolerance: number; true_peak_db: number }) {
  const okI = integratedLufs !== null && Math.abs(integratedLufs - s.target_lufs) <= s.lufs_tolerance;
  const okP = truePeakDb !== null && truePeakDb <= s.true_peak_db;
  const f = (v: number | null) => (v === null ? "?" : v.toLocaleString("nl-NL"));
  return { ok: okI && okP, value: `${f(integratedLufs)} LUFS, piek ${f(truePeakDb)} dB`, note: `doel ${s.target_lufs} ±${s.lufs_tolerance} LUFS, true peak ≤ ${s.true_peak_db} dB` };
}

/** Pass 2: linear correction with the measured values, limiter just under the true-peak ceiling, picture copied. */
export function correctArgs(input: string, output: string, t: LoudnessTarget, m: Measured): string[] {
  // 1.5 dB under the true-peak target: the limiter sees samples, and AAC encoding can push the peaks between samples
  // up again (measured: -1.5 dB sample ceiling still gave -0.5 dB true peak after AAC on 16-11-2026).
  const ceiling = Math.pow(10, (t.truePeakDb - 1.5) / 20).toFixed(3);
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-af", `loudnorm=I=${t.lufs}:TP=${t.truePeakDb - 0.5}:LRA=${t.lra}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000,alimiter=limit=${ceiling}:level=false`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
  ];
}

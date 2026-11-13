// Dreamnest audio QC rules (music-principles.md): loudness per part, true peak, silences, volume jumps. Pure, tested.

export type SectionTarget = { id: string; lufs: number };
export const TARGETS = { story: -20, falling_asleep: -22, sleep: -24 } as const;
export const TRUE_PEAK_MAX = -3;

export type AudioMeasure = { integrated: number; truePeak: number; silences: { start: number; dur: number }[]; shortTerm: number[] };

export function parseEbur128(text: string): { integrated: number | null; truePeak: number | null; shortTerm: number[] } {
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const i = /I:\s*(-?[\d.]+) LUFS/.exec(summary);
  const p = /Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(summary.slice(summary.indexOf("True peak")));
  const shortTerm = [...text.matchAll(/ S:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  return { integrated: i ? Number(i[1]) : null, truePeak: p ? (p[1] === "-inf" ? -Infinity : Number(p[1])) : null, shortTerm };
}

export function parseSilences(text: string): { start: number; dur: number }[] {
  const starts = [...text.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const durs = [...text.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, k) => ({ start: s, dur: durs[k] ?? Infinity }));
}

/**
 * ✅/❌ per rule. shortTerm: short-term loudness every 0.1 s; a jump of more than 3 LU within 3 s is a volume jump
 * (ignoring the very quiet start and end of a fade).
 */
export function judgeAudio(m: AudioMeasure, targetLufs: number): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (Math.abs(m.integrated - targetLufs) > 1) problems.push(`luidheid ${m.integrated.toFixed(1)} LUFS, doel ${targetLufs} (± 1)`);
  if (m.truePeak > TRUE_PEAK_MAX) problems.push(`piek ${m.truePeak.toFixed(1)} dBTP, maximaal ${TRUE_PEAK_MAX}`);
  for (const s of m.silences) if (s.dur > 2) problems.push(`stilte van ${s.dur.toFixed(1)} s bij ${fmt(s.start)}`);
  const st = m.shortTerm;
  for (let i = 30; i < st.length; i++) {
    const a = st[i - 30], b = st[i];
    if (a > targetLufs - 12 && b > targetLufs - 12 && Math.abs(b - a) > 3) {
      problems.push(`volumesprong van ${Math.abs(b - a).toFixed(1)} LU bij ${fmt(i / 10)}`);
      break;
    }
  }
  return { ok: problems.length === 0, problems };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

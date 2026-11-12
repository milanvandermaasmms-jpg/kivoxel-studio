// Live Production Center (fase B1): real progress, read from FFmpeg's `-progress pipe:1` output.
// No invented numbers: without a measurement the progress or remaining time stays null ("Nog onbekend").

export type FfmpegSnapshot = { frame: number | null; fps: number | null; outMs: number | null; speed: number | null; done: boolean };

const num = (v: string | undefined) => {
  if (v === undefined) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** "00:01:02.500000" -> 62500 */
function clockMs(v: string | undefined): number | null {
  const m = v?.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) : null;
}

/**
 * FFmpeg writes blocks of key=value lines, each closed by `progress=continue` or `progress=end`.
 * Feed it raw chunks; it returns one snapshot per finished block. Note: `out_time_ms` is in microseconds (an old
 * FFmpeg quirk), so `out_time_us` or `out_time` is used.
 */
export function createProgressParser() {
  let buffer = "";
  let fields: Record<string, string> = {};
  return (chunk: string): FfmpegSnapshot[] => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    const out: FfmpegSnapshot[] = [];
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key !== "progress") {
        fields[key] = value;
        continue;
      }
      const us = num(fields.out_time_us);
      const speed = num(fields.speed?.replace(/x$/, ""));
      out.push({
        frame: num(fields.frame),
        fps: num(fields.fps),
        outMs: us !== null && us >= 0 ? Math.round(us / 1000) : clockMs(fields.out_time),
        speed: speed !== null && speed > 0 ? speed : null,
        done: value === "end",
      });
      fields = {};
    }
    return out;
  };
}

export type RenderProgress = { progress: number | null; etaMs: number | null };

/**
 * Progress of a montage from the measured output time, and the remaining time from the measured speed.
 * The remaining time is only given after a few seconds of measuring, so a first jumpy value is not shown.
 */
export function renderProgress(s: Pick<FfmpegSnapshot, "outMs" | "speed" | "done">, totalMs: number, elapsedMs: number): RenderProgress {
  if (s.done) return { progress: 1, etaMs: 0 };
  if (!(totalMs > 0) || s.outMs === null) return { progress: null, etaMs: null };
  const progress = Math.min(0.999, Math.max(0, s.outMs / totalMs));
  const etaMs = s.speed && elapsedMs >= 3000 && s.outMs > 0 ? Math.round((totalMs - Math.min(s.outMs, totalMs)) / s.speed) : null;
  return { progress, etaMs };
}

/**
 * Stall check for a running FFmpeg, called every few seconds. A montage only counts as stuck after `stallMs` without
 * progress. A long gap between two checks means the pc was asleep; then the waiting starts again, because FFmpeg
 * sleeps along and continues after waking (found 12-11-2026: a montage was stopped right after the night).
 */
export function checkStall(s: { now: number; lastProgress: number; lastCheck: number; stallMs: number; sleepGapMs?: number }): { stalled: boolean; lastProgress: number } {
  const slept = s.now - s.lastCheck > (s.sleepGapMs ?? 60_000);
  const lastProgress = slept ? s.now : s.lastProgress;
  return { stalled: s.now - lastProgress > s.stallMs, lastProgress };
}

/** 83_000 -> "1:23"; null -> "Nog onbekend". */
export function formatEta(ms: number | null): string {
  if (ms === null) return "Nog onbekend";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Analysis progress (stages and weights). The proxy is measured by FFmpeg; Gemini reports no progress while it
 * thinks, so that part is an estimate from the length of the recording, and the screen says so.
 */
export const ANALYSIS_STAGES = {
  proxy: { from: 0, to: 0.4, label: "Analysekopie maken (FFmpeg)" },
  upload: { from: 0.4, to: 0.5, label: "Uploaden naar Gemini" },
  processing: { from: 0.5, to: 0.6, label: "Gemini verwerkt de video" },
  thinking: { from: 0.6, to: 0.97, label: "Gemini zoekt de momenten (schatting)" },
} as const;
export type AnalysisStage = keyof typeof ANALYSIS_STAGES;

/** Overall progress for a share (0-1) of one stage. */
export const stageProgress = (stage: AnalysisStage, share: number) => {
  const s = ANALYSIS_STAGES[stage];
  return s.from + (s.to - s.from) * Math.min(1, Math.max(0, share));
};

/** Expected thinking time for Gemini: 20 s plus 3 s per minute of gameplay (a start value, refined later). */
export const expectedThinkingMs = (recordingMs: number) => 20_000 + Math.round((recordingMs / 60_000) * 3_000);

/** Share of the thinking stage after `elapsed` ms: follows the estimate, never reaches 100% before Gemini answers. */
export function thinkingShare(elapsedMs: number, expectedMs: number): number {
  return Math.min(0.95, 1 - Math.exp((-2 * elapsedMs) / Math.max(1, expectedMs)));
}

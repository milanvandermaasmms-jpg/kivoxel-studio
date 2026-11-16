// KIVOXEL fase 1, section 4: the thumbnail background is the most exciting sharp frame around the payoff, taken from
// the recording itself (not from the finished montage, which already has captions burned in).
import type { Segment } from "../youtube/analysis.ts";
import { blurFilter, type Region, type Size } from "../youtube/render.ts";
import type { EventTimeline } from "./events.ts";

/** A time in the finished montage -> the same moment in the recording. */
export function outToSource(segments: Segment[], outMs: number): number {
  const sorted = [...segments].sort((a, b) => a.out_start_ms - b.out_start_ms);
  for (const s of sorted) {
    const length = (s.src_end_ms - s.src_start_ms) / s.speed;
    if (outMs >= s.out_start_ms && outMs < s.out_start_ms + length) return Math.round(s.src_start_ms + (outMs - s.out_start_ms) * s.speed);
  }
  const last = sorted[sorted.length - 1];
  return last ? Math.max(last.src_start_ms, last.src_end_ms - 500) : outMs;
}

/**
 * The thumbnail moment in the recording: the best-scoring event whose thumbnail frame lies inside a piece the
 * montage uses (so the thumbnail shows something the video really shows). Without events: the planned moment.
 */
export function sourceThumbMs(segments: Segment[], events: EventTimeline | null, fallbackOutMs: number): { srcMs: number; eventId: string | null } {
  const used = (ms: number) => segments.some((s) => ms >= s.src_start_ms && ms <= s.src_end_ms);
  const best = (events?.events ?? []).filter((e) => used(e.t_thumb)).sort((a, b) => b.payoff - a.payoff)[0];
  return best ? { srcMs: best.t_thumb, eventId: best.id } : { srcMs: outToSource(segments, fallbackOutMs), eventId: null };
}

/** FFmpeg arguments for a thumbnail straight from the recording: same framing as the montage, blur, colour, header. */
export function thumbFromSourceArgs(recording: string, srcMs: number[], size: Size, assFile: string, output: string, blur: Region[] = []): string[] {
  const t = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);
  const look = "eq=saturation=1.25:contrast=1.08";
  const vertical = size.height > size.width;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const ms of srcMs) args.push("-ss", t(ms), "-i", recording);
  const graph: string[] = [];
  const w = srcMs.length === 2 ? Math.round(size.width / 2) : size.width;
  srcMs.forEach((_, i) => {
    graph.push(...blurFilter(`[${i}:v]`, `[b${i}]`, blur, `t${i}`));
    // A Short uses the middle of the recording, like the montage does (scale to the height, crop the width).
    const fit = vertical && srcMs.length === 1 ? `scale=-2:${size.height},crop=${size.width}:${size.height}` : `scale=${w}:${size.height}:force_original_aspect_ratio=increase,crop=${w}:${size.height}`;
    graph.push(`[b${i}]${fit},setsar=1[f${i}]`);
  });
  const joined = srcMs.length === 2 ? "[f0][f1]hstack=inputs=2" : "[f0]null";
  graph.push(`${joined},${look},subtitles=${assFile}[v]`);
  return [...args, "-filter_complex", graph.join(";"), "-map", "[v]", "-frames:v", "1", "-q:v", "2", output];
}

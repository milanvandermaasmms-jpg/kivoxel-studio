// Fase C: thumbnails made by the worker with FFmpeg (free). A long video gets 3 clearly different ones (superprompt 5.4:
// the most exciting moment, the result, before/after); a Short gets 1 cover. At most 4 words of text.
// Milan chooses one for the upload; the other two he can use himself in YouTube Studio (Test & Compare).
import type { Format, Segment } from "./analysis.ts";
import { assText, type Size } from "./render.ts";

export type ThumbPlan = { key: "moment" | "result" | "before_after" | "cover"; label: string; text: string; atMs: number[] };
export type StoredThumb = { file: string; key: ThumbPlan["key"]; label: string; text: string; at_ms: number };

export const THUMB_SIZE: Record<"long" | "short", Size> = { long: { width: 1280, height: 720 }, short: { width: 1080, height: 1920 } };

const lengthOf = (s: Segment) => Math.round((s.src_end_ms - s.src_start_ms) / s.speed);
/** A moment inside a segment of the final video: share 0..1 of its length. */
const inside = (s: Segment, share: number) => s.out_start_ms + Math.round(lengthOf(s) * share);

/** "the creeper got him!!" -> "THE CREEPER GOT HIM": capitals, no punctuation, at most 4 words. */
export function thumbWords(text: string | null | undefined, max = 4): string {
  return (text ?? "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .join(" ")
    .toUpperCase();
}

/** Which frames and words: from the cut segments of the montage and the texts of the script. */
export function thumbnailPlans(format: Format, segments: Segment[], texts: string[]): ThumbPlan[] {
  if (!segments.length) return [];
  const words = texts.map((t) => thumbWords(t)).filter(Boolean);
  const pick = (i: number, fallback: string) => words[i] ?? words[0] ?? fallback;
  if (format !== "C") {
    const peak = segments.find((s) => s.part === "payoff" || s.part === "discovery") ?? segments[0];
    return [{ key: "cover", label: "Cover", text: pick(0, ""), atMs: [inside(peak, 0.2)] }];
  }
  const opening = segments.find((s) => s.part === "cold_open") ?? segments[0];
  const chapters = segments.filter((s) => s.part === "chapter");
  const first = chapters[0] ?? segments[0];
  const last = chapters.at(-1) ?? segments.at(-1)!;
  return [
    { key: "moment", label: "Spannendste moment", text: pick(0, "BIJNA MIS"), atMs: [inside(opening, 0.5)] },
    { key: "result", label: "Resultaat", text: pick(1, "HET RESULTAAT"), atMs: [inside(last, 0.85)] },
    { key: "before_after", label: "Voor / na", text: "VOOR · NA", atMs: [inside(first, 0.1), inside(last, 0.9)] },
  ];
}

/** Big text at the top, thick outline: readable as a small picture. */
export function thumbAss(size: Size, text: string): string {
  const vertical = size.height > size.width;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Thumb,Arial Black,${vertical ? 130 : 110},&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,${vertical ? 10 : 8},4,8,40,40,${vertical ? 220 : 36},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...(text.trim() ? [`Dialogue: 0,0:00:00.00,0:00:10.00,Thumb,,0,0,0,,${assText(text)}`] : []),
    "",
  ].join("\n");
}

/** FFmpeg arguments for one thumbnail as JPEG: one frame, or two frames side by side (before/after). */
export function thumbArgs(input: string, plan: ThumbPlan, size: Size, assFile: string, output: string): string[] {
  const t = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);
  const look = "eq=saturation=1.25:contrast=1.08";
  if (plan.atMs.length === 2) {
    const half = Math.round(size.width / 2);
    const fit = (i: number, name: string) => `[${i}:v]scale=${half}:${size.height}:force_original_aspect_ratio=increase,crop=${half}:${size.height}[${name}]`;
    return ["-hide_banner", "-loglevel", "error", "-y", "-ss", t(plan.atMs[0]), "-i", input, "-ss", t(plan.atMs[1]), "-i", input, "-filter_complex", `${fit(0, "a")};${fit(1, "b")};[a][b]hstack=inputs=2,${look},subtitles=${assFile}[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "2", output];
  }
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", t(plan.atMs[0]), "-i", input, "-frames:v", "1", "-vf", `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},${look},subtitles=${assFile}`, "-q:v", "2", output];
}

/** "abc-v1-12345678.mp4" -> "abc-v1-12345678-t2.jpg". */
export const thumbFileName = (renderFile: string, index: number) => renderFile.replace(/\.mp4$/, `-t${index + 1}.jpg`);

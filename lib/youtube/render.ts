// Montage (pakket 53): pure functions shared by the worker and the dashboard.
// The worker runs FFmpeg in a temporary folder, so the filter only names files there (no Windows paths in the filter).
import type { Format, ScriptLine, Segment } from "./analysis.ts";

export type Size = { width: number; height: number };

/** Shorts are vertical (cut from the middle of the picture); a long video stays horizontal. */
export const renderSize = (format: Format): Size => (format === "C" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 });

/** The narrator speaks about 2.5 words per second (the same pace the script asks for). */
export const WORDS_PER_SECOND = 2.5;
const MIN_CAPTION_MS = 1200;
const MAX_CAPTION_MS = 6000;

/** Lines the narrator speaks. The hook goes first when no line starts in the first 1.5 seconds. */
export function narration(hook: string, lines: ScriptLine[]): ScriptLine[] {
  const sorted = [...lines].sort((a, b) => a.at_ms - b.at_ms);
  const opens = sorted.length > 0 && sorted[0].at_ms < 1500;
  return opens || !hook.trim() ? sorted : [{ at_ms: 0, text: hook.trim() }, ...sorted];
}

/** "1:02:03.45" in centiseconds, as ASS wants it. */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Text from the script may not open ASS override blocks or break the line format. */
export function assText(text: string): string {
  return text.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\s*\r?\n\s*/g, " ").trim();
}

export type Caption = { startMs: number; endMs: number; text: string };

/** One caption per spoken line: from its start until the next line, or as long as it takes to say it. */
export function captions(lines: ScriptLine[], durationMs: number): Caption[] {
  const out: Caption[] = [];
  lines.forEach((line, i) => {
    const words = line.text.trim().split(/\s+/).filter(Boolean).length;
    const spoken = Math.min(MAX_CAPTION_MS, Math.max(MIN_CAPTION_MS, Math.round((words / WORDS_PER_SECOND) * 1000)));
    const next = lines[i + 1]?.at_ms ?? Number.POSITIVE_INFINITY;
    const endMs = Math.min(durationMs, next, line.at_ms + spoken);
    if (endMs > line.at_ms && line.text.trim()) out.push({ startMs: line.at_ms, endMs, text: line.text });
  });
  return out;
}

/** Subtitle file: captions at the bottom, and for Shorts the fixed top line during the whole video. */
export function buildAss({ size, topLine, lines, durationMs, overlays = [] }: { size: Size; topLine: string | null; lines: ScriptLine[]; durationMs: number; overlays?: Overlay[] }): string {
  const vertical = size.height > size.width;
  const captionSize = vertical ? 64 : 52;
  const topSize = vertical ? 78 : 60;
  // In a Short, captions sit above the YouTube buttons and title (lower quarter of the screen).
  const marginV = vertical ? Math.round(size.height * 0.24) : 70;
  const style = (name: string, fontSize: number, alignment: number, margin: number) =>
    `Style: ${name},Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${vertical ? 6 : 4},2,${alignment},60,60,${margin},1`;
  const events = captions(lines, durationMs).map((c) => `Dialogue: 0,${assTime(c.startMs)},${assTime(c.endMs)},Caption,,0,0,0,,${assText(c.text)}`);
  if (vertical && topLine?.trim()) events.unshift(`Dialogue: 1,${assTime(0)},${assTime(durationMs)},Top,,0,0,0,,${assText(topLine).toUpperCase()}`);
  for (const o of overlays) if (o.text.trim() && o.endMs > o.startMs) events.push(`Dialogue: 2,${assTime(o.startMs)},${assTime(Math.min(o.endMs, durationMs))},Overlay,,0,0,0,,${assText(o.text).toUpperCase()}`);
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
    style("Caption", captionSize, 2, marginV),
    style("Top", topSize, 8, vertical ? 180 : 60),
    style("Overlay", vertical ? 70 : 56, 8, vertical ? Math.round(size.height * 0.3) : 200),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** A narrator clip, already in the temporary folder, placed at `atMs` on the timeline of the final video. */
export type VoiceClip = { file: string; atMs: number };

export type RenderInput = {
  /** Absolute path of the recording; it is only an FFmpeg input, never part of the filter. */
  recording: string;
  recordingMs: number;
  hasAudio: boolean;
  segments: Segment[];
  size: Size;
  /** File name of the subtitles in the temporary folder. */
  assFile: string;
  voice: VoiceClip[];
  /** Volume of the game sound under the narrator (0-1). Without a narrator the game sound stays at full volume. */
  gameVolume: number;
  output: string;
  fps?: number;
  /** Parts of the picture (fractions of the recording) that are blurred in every frame: fixed PS5 corners (migration 031). */
  blur?: Region[];
  /** No game sound at all, for example when someone else can be heard. The narrator stays. */
  muteGame?: boolean;
};

/** A rectangle as fractions of the picture, 0 to 1. */
export type Region = { x: number; y: number; w: number; h: number };

/** Proposal for the fixed corners: chat of Minecraft Bedrock top left, PS5 notifications top right. Check in the preview. */
export const DEFAULT_BLUR_REGIONS: Region[] = [
  { x: 0, y: 0, w: 0.38, h: 0.3 },
  { x: 0.7, y: 0, w: 0.3, h: 0.18 },
];

/** Keeps regions inside the picture and drops broken ones; the same rules as the check in migration 031. */
export function cleanRegions(regions: unknown): Region[] {
  if (!Array.isArray(regions)) return [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  return regions
    .slice(0, 6)
    .map((r) => {
      const x = Math.min(1, Math.max(0, n(r?.x)));
      const y = Math.min(1, Math.max(0, n(r?.y)));
      return { x, y, w: Math.min(1 - x, n(r?.w)), h: Math.min(1 - y, n(r?.h)) };
    })
    .filter((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= 0.05 && r.h >= 0.05);
}

const f4 = (v: number) => v.toFixed(4);

/** Filter that blurs each region of one input in place: split, crop, strong box blur, overlay back on the same spot. */
export function blurFilter(input: string, output: string, regions: Region[], tag: string): string[] {
  if (!regions.length) return [`${input}null${output}`];
  const parts = [`${input}split=${regions.length + 1}[${tag}b]${regions.map((_, k) => `[${tag}r${k}]`).join("")}`];
  regions.forEach((r, k) => {
    parts.push(`[${tag}r${k}]crop=w=iw*${f4(r.w)}:h=ih*${f4(r.h)}:x=iw*${f4(r.x)}:y=ih*${f4(r.y)},boxblur=lr='min(w,h)/6':lp=3:cr='min(cw,ch)/6':cp=3[${tag}k${k}]`);
    const from = k === 0 ? `[${tag}b]` : `[${tag}o${k - 1}]`;
    const to = k === regions.length - 1 ? output : `[${tag}o${k}]`;
    parts.push(`${from}[${tag}k${k}]overlay=x=main_w*${f4(r.x)}:y=main_h*${f4(r.y)}${to}`);
  });
  return parts;
}

export type RenderPlan = { args: string[]; durationMs: number; segments: number };

const sec = (ms: number) => (ms / 1000).toFixed(3);
/** Loudness target for the finished montage (starting value, DECISIONS.md). */
export const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000";
const volume = (v: number) => Math.min(1, Math.max(0, v)).toFixed(2);

/** Keeps segments inside the recording and drops the empty ones; the speed stays within what atempo accepts. */
export function usableSegments(segments: Segment[], recordingMs: number) {
  return segments
    .map((s) => {
      const start = Math.max(0, Math.min(s.src_start_ms, recordingMs));
      const end = Math.max(start, Math.min(s.src_end_ms, recordingMs));
      const speed = Math.min(2, Math.max(0.5, Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 1));
      return { start, end, speed, zoom: s.effects?.includes("zoom") ?? false, text: s.text?.trim() || null };
    })
    .filter((s) => s.end - s.start >= 100);
}

/**
 * FFmpeg arguments for the montage. Every segment is its own input with -ss/-t before -i, so FFmpeg jumps to the piece
 * instead of decoding the whole recording. Pieces are sped up with setpts/atempo and joined with concat.
 */
export function renderArgs(input: RenderInput): RenderPlan {
  const pieces = usableSegments(input.segments, input.recordingMs);
  if (!pieces.length) throw new Error("Het montageplan heeft geen bruikbare stukken binnen de opname");
  const { width, height } = input.size;
  const fps = input.fps ?? 30;
  const fit =
    height > width
      ? `scale=-2:${height},crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const p of pieces) args.push("-ss", sec(p.start), "-t", sec(p.end - p.start), "-i", input.recording);
  for (const v of input.voice) args.push("-i", v.file);

  const filters: string[] = [];
  const blur = cleanRegions(input.blur ?? []);
  let durationMs = 0;
  pieces.forEach((p, i) => {
    const outMs = Math.round((p.end - p.start) / p.speed);
    durationMs += outMs;
    // Blur first, on the full recording, so the corners are covered before a Short is cut from the middle.
    if (blur.length) filters.push(...blurFilter(`[${i}:v]`, `[p${i}]`, blur, `s${i}`));
    // Zoom (editor, fase C3): the middle 80% of the picture, so the cut is a visible change in the shot rhythm.
    filters.push(`${blur.length ? `[p${i}]` : `[${i}:v]`}setpts=(PTS-STARTPTS)/${p.speed},${p.zoom ? "crop=iw*0.8:ih*0.8," : ""}${fit},fps=${fps},setsar=1,format=yuv420p[v${i}]`);
    filters.push(
      input.hasAudio
        ? `[${i}:a]asetpts=PTS-STARTPTS,${p.speed === 1 ? "" : `atempo=${p.speed},`}aresample=48000,aformat=channel_layouts=stereo[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${sec(outMs)}[a${i}]`,
    );
  });
  filters.push(`${pieces.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${pieces.length}:v=1:a=1[vc][ac]`);
  filters.push(`[vc]subtitles=${input.assFile}[vout]`);
  if (input.voice.length) {
    filters.push(`[ac]volume=${input.muteGame ? "0" : volume(input.gameVolume)}[game]`);
    input.voice.forEach((v, k) => {
      const delay = Math.max(0, Math.round(v.atMs));
      filters.push(`[${pieces.length + k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay}[n${k}]`);
    });
    filters.push(`[game]${input.voice.map((_, k) => `[n${k}]`).join("")}amix=inputs=${input.voice.length + 1}:duration=first:normalize=0[amix]`);
  } else filters.push(input.muteGame ? "[ac]volume=0[amix]" : "[ac]anull[amix]");
  // YouTube plays at about -14 LUFS; without this the first Short came out at -37 LUFS (measured 12-11-2026).
  filters.push(`[amix]${LOUDNORM}[aout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    input.output,
  );
  return { args, durationMs, segments: pieces.length };
}

/** Name of the preview in the renders folder; matches the check in migration 030. */
export function renderFileName(videoId: string, version: number, jobId: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
  return `${clean(videoId)}-v${Math.max(1, Math.floor(version))}-${clean(jobId).slice(0, 8)}.mp4`;
}

export const isRenderFileName = (name: string) => /^[A-Za-z0-9_-]{1,120}\.mp4$/.test(name);

/** Text in the picture per segment (editor): shown during that segment on the timeline of the final video. */
export type Overlay = { startMs: number; endMs: number; text: string };

export function segmentOverlays(segments: Segment[], recordingMs: number): Overlay[] {
  let out = 0;
  const overlays: Overlay[] = [];
  for (const p of usableSegments(segments, recordingMs)) {
    const len = Math.round((p.end - p.start) / p.speed);
    if (p.text) overlays.push({ startMs: out, endMs: out + len, text: p.text });
    out += len;
  }
  return overlays;
}

/** "00:01:02,450" as SRT wants it. */
export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(t % 1000).padStart(3, "0")}`;
}

/**
 * Separate caption file for YouTube (fase D4b): the same spoken lines and times as the captions in the picture,
 * so search and accessibility get the text too.
 */
export function buildSrt(lines: ScriptLine[], durationMs: number): string {
  return captions(lines, durationMs)
    .map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text.replace(/\s*\r?\n\s*/g, " ").trim()}\n`)
    .join("\n");
}

/** The caption file that belongs to a montage: same name, .srt. */
export const srtFileName = (renderFile: string) => renderFile.replace(/\.mp4$/, ".srt");

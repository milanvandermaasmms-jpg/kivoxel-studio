// FFmpeg/ffprobe on Milan's pc (installed with winget: Gyan.FFmpeg).
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { checkStall, createProgressParser, type FfmpegSnapshot } from "../lib/youtube/progress.ts";
import type { ProbeInfo } from "../lib/youtube/protocol.ts";
import { parseQcLog, type QcProbe } from "../lib/youtube/qc.ts";
import { createSignalParser, signalArgs, type Signals } from "../lib/youtube/footage.ts";

const run = promisify(execFile);

/** winget puts its links here; a terminal that was already open does not know the new PATH yet. */
function wingetCandidates(tool: string): string[] {
  const local = process.env.LOCALAPPDATA;
  if (!local) return [];
  const found = [join(local, "Microsoft", "WinGet", "Links", `${tool}.exe`)];
  const packages = join(local, "Microsoft", "WinGet", "Packages");
  if (existsSync(packages)) {
    for (const dir of readdirSync(packages).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
      const base = join(packages, dir);
      for (const build of readdirSync(base)) found.push(join(base, build, "bin", `${tool}.exe`));
    }
  }
  return found;
}

export function findTool(tool: "ffmpeg" | "ffprobe", configured?: string): string {
  if (configured) return configured;
  return wingetCandidates(tool).find((p) => existsSync(p)) ?? tool;
}

export async function ffmpegVersion(ffmpeg: string): Promise<string | null> {
  try {
    const { stdout } = await run(ffmpeg, ["-hide_banner", "-version"], { timeout: 10_000 });
    return /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? "onbekend";
  } catch {
    return null;
  }
}

const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "60000/1001" -> 59.94 */
export function parseRate(rate: unknown): number | null {
  if (typeof rate !== "string") return null;
  const [a, b] = rate.split("/").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0 || a === 0) return null;
  return Math.round((a / b) * 1000) / 1000;
}

type FfprobeJson = { format?: { duration?: string }; streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[] };

export function parseProbe(json: FfprobeJson): ProbeInfo {
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  const seconds = num(json.format?.duration);
  return {
    durationMs: seconds === null ? null : Math.round(seconds * 1000),
    width: num(video?.width),
    height: num(video?.height),
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

export async function probe(ffprobe: string, file: string): Promise<ProbeInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (e) {
    const reason = String((e as { stderr?: string }).stderr ?? "").trim().split(/\r?\n/).pop()?.replace(/^.*?:\s*/, "") ?? "";
    throw new Error(`FFmpeg kan dit bestand niet lezen; is het een echte video?${reason ? ` (${reason.slice(0, 120)})` : ""}`);
  }
  const info = parseProbe(JSON.parse(stdout) as FfprobeJson);
  if (!info.videoCodec) throw new Error("Geen videobeeld gevonden in dit bestand");
  return info;
}

/**
 * Small copy for the analysis service: 360p, 1 frame per second (Gemini looks at 1 frame per second anyway),
 * mono audio so voices and party chat can still be heard. Keeps the upload and the costs small.
 */
export function proxyArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", "scale=-2:360,fps=1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-ac", "1", "-b:a", "48k", "-movflags", "+faststart", output];
}

/** With options (fase E3, progress of the analysis) FFmpeg reports how far it is; without, it runs as before. */
export async function makeProxy(ffmpeg: string, input: string, output: string, durationMs: number, options?: RunOptions): Promise<string> {
  try {
    if (options) await runFfmpeg(ffmpeg, proxyArgs(input, output), dirname(output), Math.max(10 * 60_000, durationMs), options);
    else await run(ffmpeg, proxyArgs(input, output), { timeout: Math.max(10 * 60_000, durationMs), maxBuffer: 4 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    const reason = String((e as { stderr?: string }).stderr ?? "").trim().split(/\r?\n/).pop() ?? "";
    throw new Error(`FFmpeg kon geen kleine kopie maken${reason ? ` (${reason.slice(0, 120)})` : ""}`);
  }
  return output;
}

/**
 * One frame of a montage as a thumbnail (fase D4b): JPEG, longest side 1280 px (YouTube's recommended width),
 * so the file stays well under YouTube's limit.
 */
export function frameArgs(input: string, atMs: number, output: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-y", "-ss", (Math.max(0, atMs) / 1000).toFixed(3), "-i", input, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", "-q:v", "3", output];
}

export async function extractFrame(ffmpeg: string, input: string, atMs: number, output: string): Promise<void> {
  try {
    await run(ffmpeg, frameArgs(input, atMs, output), { timeout: 60_000, maxBuffer: 1024 * 1024 });
  } catch (e) {
    const reason = String((e as { stderr?: string }).stderr ?? "").trim().split(/\r?\n/).pop() ?? "";
    throw new Error(`FFmpeg kon geen beeld uit de montage halen${reason ? ` (${reason.slice(0, 120)})` : ""}`);
  }
}

export type RunOptions = { onProgress?: (s: FfmpegSnapshot) => void; signal?: AbortSignal; onStderr?: (chunk: string) => void };

/** Thrown when Milan cancels; the queue marks the step as cancelled instead of failed. */
export class CancelledError extends Error {
  constructor() {
    super("Geannuleerd");
  }
}

/**
 * Runs a montage in `cwd` (the temporary folder with the subtitles and narrator clips) and reports FFmpeg's real
 * progress (`-progress pipe:1`). Cancelling kills FFmpeg itself, so a cancelled montage does not run on.
 */
/**
 * Asks Windows to keep the pc awake while a montage runs, the way a video player does (SetThreadExecutionState).
 * It changes no setting: the request ends when the helper stops, at the latest when the worker stops.
 * Returns a function that ends the request. Does nothing outside Windows or when WORKER_KEEP_AWAKE=0.
 */
export function keepAwake(): () => void {
  if (process.platform !== "win32" || process.env.WORKER_KEEP_AWAKE === "0") return () => {};
  const script =
    "$s='[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);';" +
    "$t=Add-Type -MemberDefinition $s -Name P -Namespace W -PassThru;" +
    "[void]$t::SetThreadExecutionState(0x80000001);" +
    `while(Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue){Start-Sleep -Seconds 20}`;
  try {
    const helper = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true, stdio: "ignore" });
    helper.on("error", () => {});
    return () => helper.kill();
  } catch {
    return () => {};
  }
}

/** A montage only counts as stuck after this long without any progress from FFmpeg. */
const STALL_MS = 5 * 60_000;

export function runFfmpeg(ffmpeg: string, args: string[], cwd: string, timeoutMs: number, options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new CancelledError());
    const child = spawn(ffmpeg, ["-progress", "pipe:1", "-nostats", ...args], { cwd, windowsHide: true });
    const parse = createProgressParser();
    const awake = keepAwake();
    const stallMs = Math.min(timeoutMs, STALL_MS);
    let stderr = "";
    let settled = false;
    let lastProgress = Date.now();
    let lastCheck = Date.now();
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      awake();
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      child.kill();
      finish(new CancelledError());
    };
    // Stops FFmpeg only when it is really stuck; a night in sleep mode does not count (see checkStall).
    const watchdog = setInterval(() => {
      const now = Date.now();
      const state = checkStall({ now, lastProgress, lastCheck, stallMs });
      lastProgress = state.lastProgress;
      lastCheck = now;
      if (state.stalled) {
        child.kill();
        finish(new Error(`FFmpeg kon de montage niet maken (${Math.round(stallMs / 60_000)} minuten geen voortgang, gestopt)`));
      }
    }, Math.min(15_000, stallMs));
    options.signal?.addEventListener("abort", onAbort);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      lastProgress = Date.now();
      for (const snap of parse(chunk)) options.onProgress?.(snap);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
      options.onStderr?.(chunk);
    });
    child.on("error", (e) => finish(new Error(`FFmpeg kon niet starten: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return finish(null);
      const reason = stderr.trim().split(/\r?\n/).pop() ?? "";
      finish(new Error(`FFmpeg kon de montage niet maken${reason ? ` (${reason.slice(0, 160)})` : ""}`));
    });
  });
}

/** What the quality check needs to know about a finished montage (with ffprobe). */
export async function probeRender(ffprobe: string, file: string): Promise<QcProbe> {
  const { stdout } = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  type Stream = { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string };
  const info = JSON.parse(stdout) as { streams?: Stream[]; format?: { duration?: string; bit_rate?: string } };
  const video = info.streams?.find((s) => s.codec_type === "video");
  const [n, d] = (video?.avg_frame_rate ?? "").split("/").map(Number);
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: n && d ? Math.round((n / d) * 100) / 100 : null,
    bitrateBps: info.format?.bit_rate ? Number(info.format.bit_rate) : null,
    durationMs: Math.round(Number(info.format?.duration ?? 0) * 1000),
    hasAudio: !!info.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** One FFmpeg pass over the montage for the quality check; the useful stderr lines are kept. */
export const QC_ARGS = (file: string) => [
  "-hide_banner",
  "-i", file,
  "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-60dB:d=2,scdet=t=8,metadata=mode=print:key=lavfi.scd.time",
  "-af", "ebur128=peak=true:framelog=quiet,silencedetect=n=-50dB:d=2",
  "-f", "null", "-",
];
const QC_LINE = /black_duration|freeze_duration|lavfi\.scd\.time=|silence_duration|Summary:|^\s+I:|^\s+Peak:|Integrated loudness|True peak/;

export async function measureRender(ffmpeg: string, ffprobe: string, file: string, cwd: string, options: RunOptions = {}): Promise<{ probe: QcProbe; stderr: string }> {
  const probeInfo = await probeRender(ffprobe, file);
  const kept: string[] = [];
  let rest = "";
  await runFfmpeg(ffmpeg, QC_ARGS(file), cwd, 30 * 60_000, {
    ...options,
    onStderr: (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) if (QC_LINE.test(line)) kept.push(line);
    },
  });
  if (QC_LINE.test(rest)) kept.push(rest);
  return { probe: probeInfo, stderr: kept.join("\n") };
}

/** Compressor plus limiter: raises quiet game sound without clipping (tested 12-11-2026: -20,7 to about -17 LUFS). */
/** Limiter ceilings to try, loudest first; AAC overshoots the limiter, so a lower ceiling is sometimes needed. */
export const BOOST_LIMITS = [0.6, 0.5];
export const loudnessBoost = (limit: number) => `acompressor=threshold=-30dB:ratio=6:attack=3:release=120:makeup=10,alimiter=limit=${limit}:attack=0.5:release=40:level=false,aresample=48000`;

/** Copies the picture and runs the sound through the compressor and limiter. */
export function boostLoudness(ffmpeg: string, input: string, output: string, cwd: string, options: RunOptions & { limit?: number } = {}): Promise<void> {
  return runFfmpeg(ffmpeg, ["-hide_banner", "-y", "-i", input, "-c:v", "copy", "-af", loudnessBoost(options.limit ?? BOOST_LIMITS[0]), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output], cwd, 10 * 60_000, options);
}

/** Integrated loudness and true peak of the sound only (fast: no picture is decoded). */
export async function measureLoudness(ffmpeg: string, file: string, cwd: string): Promise<{ integratedLufs: number | null; truePeakDb: number | null }> {
  let text = "";
  await runFfmpeg(ffmpeg, ["-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], cwd, 10 * 60_000, { onStderr: (c) => (text = (text + c).slice(-6000)) });
  const log = parseQcLog(text);
  return { integratedLufs: log.integratedLufs, truePeakDb: log.truePeakDb };
}

/** Fase 3: one cheap pass over the recording for scene cuts, stillness, black picture, silence and loud moments. */
export async function detectSignals(ffmpeg: string, file: string, durationMs: number, cwd: string, options: RunOptions = {}): Promise<Signals> {
  const parser = createSignalParser(durationMs);
  // Long recordings decode at several times real time; allow an hour as an outer limit (the stall watchdog stops a stuck run sooner).
  await runFfmpeg(ffmpeg, signalArgs(file), cwd, 60 * 60_000, { ...options, onStderr: (c) => { parser.feed(c); options.onStderr?.(c); } });
  return parser.finish();
}

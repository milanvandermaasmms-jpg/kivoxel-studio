// 23-11-2026: what the eindredacteur measures in an export, in one FFmpeg pass over the final file (picture and the
// final sound track), plus its .srt. See lib/kivoxel/editorReview.ts for the judgement.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { ExportMeasure, Span } from "../lib/kivoxel/editorReview.ts";

const sec = (x: string) => Math.round(Number(x) * 1000);

/** Parses FFmpeg's log lines (blackdetect, freezedetect, signalstats YDIF, silencedetect, volumedetect). */
export function parseMeasureLog(log: string, durationMs: number): Omit<ExportMeasure, "captions"> {
  const black: Span[] = [];
  for (const m of log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) black.push({ startMs: sec(m[1]), endMs: sec(m[2]) });
  const frozen: Span[] = [];
  let fStart: number | null = null;
  for (const m of log.matchAll(/freeze_(start|end): ([\d.]+)/g)) {
    if (m[1] === "start") fStart = sec(m[2]);
    else if (fStart !== null) {
      frozen.push({ startMs: fStart, endMs: sec(m[2]) });
      fStart = null;
    }
  }
  if (fStart !== null) frozen.push({ startMs: fStart, endMs: durationMs });
  const silence: Span[] = [];
  let sStart: number | null = null;
  for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (m[1] === "start") sStart = sec(m[2]);
    else if (sStart !== null) {
      silence.push({ startMs: sStart, endMs: sec(m[2]) });
      sStart = null;
    }
  }
  if (sStart !== null) silence.push({ startMs: sStart, endMs: durationMs });
  // signalstats with metadata=print: "pts_time:1.2" then "lavfi.signalstats.YDIF=3.4".
  const perSec = new Map<number, number[]>();
  let t = 0;
  for (const line of log.split(/\r?\n/)) {
    const p = /pts_time:([\d.]+)/.exec(line);
    if (p) t = Number(p[1]);
    const y = /lavfi\.signalstats\.YDIF=([\d.]+)/.exec(line);
    if (y) perSec.set(Math.floor(t), [...(perSec.get(Math.floor(t)) ?? []), Number(y[1])]);
  }
  const seconds = Math.ceil(durationMs / 1000);
  const motion = Array.from({ length: seconds }, (_, i) => {
    const v = perSec.get(i);
    return v?.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : 0;
  });
  const peak = /max_volume: (-?[\d.]+) dB/.exec(log);
  const clipped = /histogram_0db: (\d+)/.exec(log);
  return { durationMs, black, frozen, silence, motion, peakDb: peak ? Number(peak[1]) : null, clippedSamples: clipped ? Number(clipped[1]) : 0 };
}

/** "00:00:01,200 --> 00:00:02,400" cues of an .srt file. */
export function parseSrt(text: string): Span[] {
  const t = (h: string, m: string, s: string, ms: string) => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
  return [...text.matchAll(/(\d\d):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d{3})/g)].map((m) => ({ startMs: t(m[1], m[2], m[3], m[4]), endMs: t(m[5], m[6], m[7], m[8]) }));
}

export async function measureExport(ffmpeg: string, file: string, durationMs: number, srtFile: string | null): Promise<ExportMeasure> {
  const args = ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.3:pix_th=0.10,freezedetect=n=0.003:d=1,fps=5,signalstats,metadata=print:key=lavfi.signalstats.YDIF", "-af", "silencedetect=noise=-45dB:d=1.2,volumedetect", "-f", "null", "-"];
  const log = await new Promise<string>((resolve, reject) =>
    execFile(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 10 * 60_000 }, (e, out, err) => (e ? reject(e) : resolve(`${out}\n${err}`))),
  );
  const captions = srtFile ? parseSrt(await readFile(srtFile, "utf8").catch(() => "")) : [];
  return { ...parseMeasureLog(log, durationMs), captions };
}

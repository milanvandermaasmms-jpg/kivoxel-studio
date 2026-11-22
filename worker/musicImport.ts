// 23-11-2026 (Milan): a track Milan downloaded with his Uppbeat account is imported once in the studio; after that the
// editor may choose it for the channels it is allowed on. There is no Uppbeat download API (uppbeat.io/pricing:
// "Register your interest … new API"), so the download itself stays Milan's click. The worker measures the length and
// the tempo itself, stores source link, artist, title, licence and credit, and adds the track to library.json.
import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MOODS, trackProblems, type Mood, type Track } from "../lib/kivoxel/media.ts";

export type ImportMeta = { title: string; artist: string; url: string; license?: string; credit?: string; energy: number; moods: Mood[]; channels?: string[]; bpm?: number; fileName: string };

/** Uppbeat's own file names: "title-artist-main-version-12345-01-23.mp3" → a safe, recognisable file name. */
export function safeFileName(name: string): string {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "track";
  const ext = (/\.(mp3|wav|ogg|m4a|flac)$/i.exec(name)?.[1] ?? "mp3").toLowerCase();
  return `${base}.${ext}`;
}

/**
 * Tempo from an onset envelope (energy rise per hop): the lag with the strongest autocorrelation between 60 and 200 BPM,
 * folded into 80-170 BPM (where game music lives). `hopMs`: the time between two envelope values.
 */
export function bpmFromEnvelope(env: number[], hopMs: number): number | null {
  if (env.length < 50) return null;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = env.map((v) => v - mean);
  let best = 0;
  let bestLag = 0;
  const minLag = Math.round(60_000 / 200 / hopMs);
  const maxLag = Math.round(60_000 / 60 / hopMs);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  let bpm = 60_000 / (bestLag * hopMs);
  while (bpm < 80) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return Math.round(bpm);
}

const run = (exe: string, args: string[], maxBuffer = 64 * 1024 * 1024) =>
  new Promise<Buffer>((resolve, reject) => execFile(exe, args, { encoding: "buffer", maxBuffer, windowsHide: true, timeout: 120_000 }, (e, out) => (e ? reject(e) : resolve(out))));

/** Length (ms) and tempo of an audio file, measured with FFmpeg (the first 90 s, mono, 11025 Hz). */
export async function measureTrack(ffmpeg: string, file: string): Promise<{ durationMs: number | null; bpm: number | null }> {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace("ffmpeg", "ffprobe"));
  const dur = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).then((b) => Math.round(Number(b.toString().trim()) * 1000)).catch(() => null);
  const pcm = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-t", "90", "-i", file, "-ac", "1", "-ar", "11025", "-f", "f32le", "-"]).catch(() => null);
  if (!pcm) return { durationMs: Number.isFinite(dur) ? dur : null, bpm: null };
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const hop = 256;
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let e = 0;
    for (let k = i; k < i + hop; k++) e += samples[k] * samples[k];
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  return { durationMs: Number.isFinite(dur) ? dur : null, bpm: bpmFromEnvelope(env, (hop / 11025) * 1000) };
}

/** Writes the file next to library.json and adds (or replaces) its entry. Refuses a track without source and licence. */
export async function importTrack(o: { musicDir: string; ffmpeg: string; bytes: Buffer; meta: ImportMeta; now?: Date }): Promise<Track> {
  const file = safeFileName(o.meta.fileName);
  const path = join(o.musicDir, file);
  await writeFile(path, o.bytes);
  const m = await measureTrack(o.ffmpeg, path);
  const track: Track = {
    file,
    title: o.meta.title.trim().slice(0, 120),
    artist: o.meta.artist.trim().slice(0, 120),
    source: "Uppbeat (uppbeat.io), Creator-abonnement Milan",
    license: o.meta.license?.trim() || "Uppbeat Creator-licentie: eigen kanalen op de safelist (3 kanalen), geen betaalde advertenties",
    url: o.meta.url.trim(),
    energy: Math.max(1, Math.min(5, Math.round(o.meta.energy))),
    moods: o.meta.moods.filter((x) => (MOODS as readonly string[]).includes(x)),
    bpm: o.meta.bpm && o.meta.bpm >= 50 && o.meta.bpm <= 220 ? o.meta.bpm : (m.bpm ?? 120),
    ...(m.durationMs ? { duration_ms: m.durationMs } : {}),
    ...(o.meta.credit?.trim() ? { credit: o.meta.credit.trim().slice(0, 400) } : {}),
    ...(o.meta.channels?.length ? { channels: o.meta.channels } : {}),
    added_at: (o.now ?? new Date()).toISOString(),
    bpm_measured: !o.meta.bpm && !!m.bpm,
  };
  const problems = trackProblems(track);
  if (!/uppbeat\.io\//i.test(track.url ?? "")) problems.push("De Uppbeat-link van de track ontbreekt (bijv. https://uppbeat.io/t/...).");
  if (problems.length) throw new Error(problems.join(" "));
  const libFile = join(o.musicDir, "library.json");
  const lib = JSON.parse(await readFile(libFile, "utf8").catch(() => '{"tracks":[]}')) as { tracks: Track[] } & Record<string, unknown>;
  lib.tracks = [...(lib.tracks ?? []).filter((t) => t.file !== file), track];
  await writeFile(`${libFile}.tmp`, JSON.stringify(lib, null, 2), "utf8");
  await rename(`${libFile}.tmp`, libFile);
  return track;
}

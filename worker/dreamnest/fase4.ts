// Dreamnest fase 4: assemble and render a long episode (default 60 min) with the full QC. Costs nothing (FFmpeg only).
// Run: node worker/dreamnest/fase4.ts [--minutes 60] [--seed 11] [--qc-only]
// - KIVOXEL goes first: every FFmpeg runs at low priority, and before each piece the script waits while another FFmpeg
//   (KIVOXEL's worker) is running.
// - Resumable: every piece is kept with a .ok marker; run it again and it continues where it stopped.
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase4/<minutes>min/ (dreamnest-<minutes>min.mp4, qc.json, qc.html, preview.mp4).
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { constants, homedir, setPriority } from "node:os";
import { join, resolve } from "node:path";
import { judgeAudio, parseEbur128, parseSilences, TARGETS } from "../../lib/dreamnest/audioqc.ts";
import { calmEndFrame } from "../../lib/dreamnest/motion.ts";
import { buildTimeline, dimFilter, episodeLength, PARTS, planPieces, type Asset, type Piece } from "../../lib/dreamnest/timeline.ts";
import { judgeVideo, parseBlack, perMinute } from "../../lib/dreamnest/videoqc.ts";
import { findTool } from "../ffmpeg.ts";
import { makeIr, planScore, renderScorePiece } from "./audio/score.ts";
import { parseAllSsim, parseLuma } from "./measure.ts";

const root = resolve(import.meta.dirname, "../..");
const env: Record<string, string | undefined> = { ...process.env };
const envFile = env.DREAMNEST_ENV_FILE || join(root, "worker", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const minutes = Number(arg("--minutes", "60"));
const seed = Number(arg("--seed", "11"));
const qcOnly = process.argv.includes("--qc-only");
const base = join(env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube"), "dreamnest");
const clipsDir = join(base, "fase2", "1080p");
const out = join(base, "fase4", `${minutes}min`);
const assetsDir = join(out, "assets"), piecesDir = join(out, "pieces"), audioDir = join(out, "audio");
const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);
// Always limited (tv) range: one full-range piece (from a JPEG keyframe) made the light jump after joining.
const ENC = ["-c:v", "libx264", "-preset", "faster", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "24", "-g", "48", "-profile:v", "high", "-an"];
const FPS = 24;
/** Each frame against the next, matched by frame number (never by timestamp, which proved unreliable). */
const STEPS = `setpts=N/${24}/TB,split[x][y];[y]trim=start_frame=1,setpts=N/${24}/TB[b];[x][b]ssim=stats_file=-:shortest=1`;
/** Every clip is brought to this average brightness (0-255) before the dim curve; the clips are around 70-85. */
const LUMA_TARGET = 78;

/** FFmpeg at low priority, so KIVOXEL and Milan's pc keep running smoothly. */
function ff(args: string[]): Promise<string> {
  return new Promise((ok, no) => {
    const child = execFile(ffmpeg, ["-hide_banner", ...args], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true }, (e, so, se) => (e ? no(new Error(String(se).slice(-800))) : ok(`${so}\n${se}`)));
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
  });
}
const probeDur = (f: string) => Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

/** KIVOXEL goes first: wait while an FFmpeg runs that is not ours (we run one at a time and only call this in between). */
async function waitForKivoxel() {
  for (let waited = 0; ; waited++) {
    let busy = false;
    try {
      busy = /ffmpeg\.exe/i.test(execFileSync("tasklist", ["/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"], { windowsHide: true }).toString());
    } catch {}
    if (!busy) return;
    if (waited % 10 === 0) log("KIVOXEL gebruikt FFmpeg: Dreamnest wacht even...");
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// ---------- 1. Clips: only the calm part, anti-jitter, loops slower ----------
const CLIPS = readdirClips();
function readdirClips() {
  const manifest = JSON.parse(readFileSync(join(clipsDir, "manifest.json"), "utf8")) as { rows: { clip: { id: string; kind: "story" | "loop" }; file: string | null; safety: { ok: boolean } | null }[] };
  return manifest.rows.filter((r) => r.file).map((r) => ({ id: r.clip.id, kind: r.clip.kind, file: join(clipsDir, r.file!) }));
}

async function prepAsset(c: { id: string; kind: "story" | "loop"; file: string }): Promise<Asset> {
  const dst = join(assetsDir, `${c.id}.mp4`);
  if (!existsSync(`${dst}.ok`)) {
    await waitForKivoxel();
    const norm = "settb=AVTB,fps=24,setpts=PTS-STARTPTS";
    const tmp = `${dst}.tmp.mp4`;
    const still = join(base, "keyframes", "huiskamer-01", `${c.id.replace(/^story-/, "")}.png`);
    if (c.id === "story-b01-welcome-exterior" && existsSync(still)) {
      // Welcome: our own slow dolly-in on the chosen keyframe (2% per 10 s, megaprompt §4). Upscaled first so the
      // zoom does not wobble on whole pixels.
      const n = 42 * FPS;
      await ff(["-y", "-v", "error", "-loop", "1", "-i", still, "-vf", `scale=7680:-2,zoompan=z='1+${(0.08 / n).toFixed(7)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=24,setsar=1,scale=out_range=tv,format=yuv420p`, "-frames:v", String(n), ...ENC, tmp]);
      log(`${c.id}: welkomstbeeld met langzame dolly-in (42 s)`);
    } else if (c.kind === "story") {
      // The own-scene part: until the picture looks more like the next scene than like its own start, never past a cut.
      const vs = (pick: string) => ff(["-i", c.file, "-i", c.file, "-filter_complex", `[0:v]${norm},scale=480:-2[a];[1:v]${norm},scale=480:-2,${pick},loop=loop=-1:size=1,setpts=N/${FPS}/TB[b];[a][b]ssim=stats_file=-:shortest=1`, "-f", "null", "-"]).then(parseAllSsim);
      const vsFirst = await vs("trim=end_frame=1");
      const vsLast = await vs("reverse,trim=end_frame=1");
      const steps = parseAllSsim(await ff(["-i", c.file, "-filter_complex", `[0:v]${norm},scale=480:-2,${STEPS}`, "-f", "null", "-"]));
      const endS = calmEndFrame(vsFirst, vsLast, steps, Math.round(2.5 * FPS)) / FPS;
      // Slower (0.6×, soft frame blending), then ping-pong (forward, backward) into a seamless loop; then anti-jitter.
      await ff(["-y", "-v", "error", "-i", c.file, "-filter_complex", `[0:v]${norm},trim=end=${endS.toFixed(3)},setpts=(PTS-STARTPTS)/0.6,framerate=fps=24,split[f][r];[r]reverse[rr];[f][rr]concat=n=2:v=1,tmix=frames=3:weights='1 2 1'[v]`, "-map", "[v]", ...ENC, tmp]);
      log(`${c.id}: eigen scène ${endS.toFixed(1)} s → ${(endS / 0.6 * 2).toFixed(1)} s rustige lus (0,6×, heen en terug)`);
    } else {
      // Loops: anti-jitter, then 0.8× speed with soft frame blending (calmer for the long sleep part).
      await ff(["-y", "-v", "error", "-i", c.file, "-filter_complex", `[0:v]${norm},tmix=frames=3:weights='1 2 1',setpts=1.25*PTS,framerate=fps=24[v]`, "-map", "[v]", ...ENC, tmp]);
      log(`${c.id}: lus rustiger en 0,8× gemaakt`);
    }
    // Same average brightness for every clip, so a cross-fade between two scenes never jumps in light;
    // getting darker is left to the dim curve alone.
    const luma = parseLuma(await ff(["-i", tmp, "-vf", "scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]));
    const mean = luma.reduce((s, x) => s + x, 0) / Math.max(1, luma.length);
    const k = Math.max(0.8, Math.min(1.25, (LUMA_TARGET - 16) / Math.max(1, mean - 16)));
    await ff(["-y", "-v", "error", "-i", tmp, "-vf", `deflicker=size=48:mode=am,lutyuv=y='clip((val-16)*${k.toFixed(4)}+16,16,235)'`, ...ENC, dst]);
    await rm(tmp, { force: true });
    log(`${c.id}: helderheid ${mean.toFixed(0)} → ${(16 + (mean - 16) * k).toFixed(0)}`);
    await writeFile(`${dst}.ok`, "");
  }
  return { id: c.id, kind: c.kind, lengthS: probeDur(dst) };
}

// ---------- 2. Render the pieces ----------
const frames = (p: Piece) => Math.round((p.globalS + p.lengthS) * FPS) - Math.round(p.globalS * FPS);
async function renderPiece(p: Piece, assets: Map<string, Asset>, totalS: number) {
  // The file name carries a fingerprint of everything that makes the piece, so a changed timeline never reuses an old piece.
  const dst = join(piecesDir, `${p.id}-${createHash("sha1").update(JSON.stringify({ p, totalS, v: 2 })).digest("hex").slice(0, 10)}.mp4`);
  if (existsSync(`${dst}.ok`)) return dst;
  await waitForKivoxel();
  const dim = dimFilter(p.globalS, p.lengthS, totalS);
  const off = (id: string, s: number) => (s % assets.get(id)!.lengthS).toFixed(3);
  if (p.kind === "body") {
    await ff(["-y", "-v", "error", "-stream_loop", "-1", "-i", join(assetsDir, `${p.asset}.mp4`), "-filter_complex", `[0:v]trim=start=${off(p.asset, p.fromS)},setpts=PTS-STARTPTS,${dim},format=yuv420p[v]`, "-map", "[v]", "-frames:v", String(frames(p)), ...ENC, dst]);
  } else {
    // Our own slow cross-fade; both sides brightness-matched by the same dim curve (no "plop" in the light).
    await ff(["-y", "-v", "error", "-stream_loop", "-1", "-i", join(assetsDir, `${p.from.asset}.mp4`), "-stream_loop", "-1", "-i", join(assetsDir, `${p.to.asset}.mp4`), "-filter_complex", `[0:v]trim=start=${off(p.from.asset, p.from.fromS)},setpts=PTS-STARTPTS[a];[1:v]trim=start=${off(p.to.asset, p.to.fromS)},setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${p.lengthS.toFixed(3)}:offset=0,${dim},format=yuv420p[v]`, "-map", "[v]", "-frames:v", String(frames(p)), ...ENC, dst]);
  }
  const range = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_range", "-of", "csv=p=0", dst]).toString().trim();
  if (range !== "tv") throw new Error(`Stuk ${p.id} heeft kleurbereik ${range}, moet tv zijn`);
  await writeFile(`${dst}.ok`, "");
  return dst;
}

// ---------- 3. Soundtrack ----------
async function soundtrack(totalS: number) {
  const final = join(audioDir, "soundtrack.wav");
  if (existsSync(`${final}.ok`)) return final;
  const ir = join(audioDir, "ir.wav");
  await makeIr(ir);
  const plan = planScore(totalS, seed);
  const files: string[] = [];
  for (const p of plan) {
    const f = join(audioDir, `${p.id}.wav`);
    if (!existsSync(`${f}.ok`)) {
      await waitForKivoxel();
      log(`Muziek ${p.id} (${Math.round(p.lengthS)} s)...`);
      await renderScorePiece(ffmpeg, audioDir, ir, p);
      await writeFile(`${f}.ok`, "");
    }
    files.push(f);
  }
  let fc = "", prev = "[0:a]";
  for (let i = 1; i < files.length; i++) {
    fc += `${prev}[${i}:a]acrossfade=d=10:c1=qsin:c2=qsin[x${i}];`;
    prev = `[x${i}]`;
  }
  fc += `${prev}atrim=0:${totalS.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
  await ff(["-y", "-v", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", fc, "-map", "[a]", "-ar", "48000", final]);
  await writeFile(`${final}.ok`, "");
  return final;
}

// ---------- 4. QC ----------
async function qc(file: string, totalS: number) {
  log("Controle: beeld per minuut...");
  const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file]).toString()) as { streams: { width: number; height: number; r_frame_rate: string }[]; format: { duration: string } };
  const [n, d] = info.streams[0].r_frame_rate.split("/").map(Number);
  const probe = { durationS: Number(info.format.duration), width: info.streams[0].width, height: info.streams[0].height, fps: n / (d || 1) };
  const luma = parseLuma(await ff(["-i", file, "-an", "-vf", "scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-,blackdetect=d=2:pic_th=0.98", "-f", "null", "-"]).then((t) => (blackText = t, t)));
  const steps = parseAllSsim(await ff(["-i", file, "-an", "-filter_complex", `[0:v]scale=320:-2,${STEPS}`, "-f", "null", "-"]));
  // Gentle movement belongs in the story (p10 >= 98%); the sleep part must be calmer (>= 99%).
  const minutesQc = perMinute(luma, steps, FPS, (m) => (m * 60 < PARTS.storyEnd ? 0.98 : 0.99));
  const video = judgeVideo(probe, minutesQc, totalS, parseBlack(blackText));
  log("Controle: geluid per deel...");
  const parts = [
    { id: "story", from: 0, to: PARTS.storyEnd, target: TARGETS.story },
    { id: "falling_asleep", from: PARTS.storyEnd, to: PARTS.asleepEnd, target: TARGETS.falling_asleep },
    { id: "sleep", from: PARTS.asleepEnd, to: totalS - 120, target: TARGETS.sleep },
  ];
  const audio = [];
  for (const p of parts) {
    const t = await ff(["-ss", String(p.from + 5), "-t", String(p.to - p.from - 10), "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=verbose,silencedetect=noise=-60dB:d=2", "-f", "null", "-"]);
    const e = parseEbur128(t);
    audio.push({ part: p.id, integrated: e.integrated, truePeak: e.truePeak, ...judgeAudio({ integrated: e.integrated ?? -99, truePeak: e.truePeak ?? 0, silences: parseSilences(t).map((s) => ({ ...s, start: s.start + p.from + 5 })), shortTerm: e.shortTerm }, p.target) });
  }
  const ok = video.ok && audio.every((a) => a.ok);
  return { ok, probe, video, audio, minutes: minutesQc };
}
let blackText = "";

function qcPage(r: Awaited<ReturnType<typeof qc>>) {
  const row = (m: (typeof r.minutes)[number]) => `<tr class="${m.problems.length ? "bad" : ""}"><td>${m.minute}</td><td>${m.lumaMean.toFixed(0)}</td><td>${m.lumaMax.toFixed(0)}</td><td>${m.maxJump.toFixed(1)}</td><td>${(m.minStep * 100).toFixed(1)}%</td><td>${(m.calmP10 * 100).toFixed(2)}%</td><td>${m.problems.join("; ") || "✅"}</td></tr>`;
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Dreamnest QC</title>
<style>body{font:14px system-ui;margin:16px;background:#14162b;color:#eee}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #333;text-align:left}.bad{background:#5a1f2a}h1{font-size:20px}</style>
<h1>🌙 Dreamnest ${minutes} min: kwaliteitscontrole ${r.ok ? "✅ mag gepubliceerd worden" : "❌ niet publiceren"}</h1>
<p>${r.probe.width}×${r.probe.height}, ${r.probe.fps} fps, ${Math.floor(r.probe.durationS / 60)}:${String(Math.round(r.probe.durationS % 60)).padStart(2, "0")}</p>
<h2>Geluid</h2><ul>${r.audio.map((a) => `<li>${a.part}: ${a.integrated} LUFS, piek ${a.truePeak} dBTP ${a.ok ? "✅" : "❌ " + a.problems.join("; ")}</li>`).join("")}</ul>
<h2>Beeld per minuut</h2><table><tr><th>min</th><th>helderheid gem.</th><th>max</th><th>grootste sprong</th><th>kleinste stap</th><th>rust (p10)</th><th>oordeel</th></tr>${r.minutes.map(row).join("")}</table>`;
}

// ---------- Run ----------
await mkdir(assetsDir, { recursive: true });
await mkdir(piecesDir, { recursive: true });
await mkdir(audioDir, { recursive: true });
const final = join(out, `dreamnest-${minutes}min.mp4`);
const totalS = minutes * 60;
if (!qcOnly) {
  const started = Date.now();
  const assets = new Map<string, Asset>();
  for (const c of CLIPS) assets.set(c.id, await prepAsset(c));
  const segs = buildTimeline([...assets.values()], minutes, seed);
  const pieces = planPieces(segs);
  await writeFile(join(out, "timeline.json"), JSON.stringify({ minutes, seed, length_s: episodeLength(segs), segments: segs, pieces }, null, 1));
  log(`Tijdlijn: ${segs.length} delen, ${pieces.length} renderstukken.`);
  const audio = await soundtrack(totalS);
  const files: string[] = [];
  for (const [i, p] of pieces.entries()) {
    files.push(await renderPiece(p, assets, totalS));
    if (i % 10 === 9) {
      const done = (p.globalS + p.lengthS) / totalS;
      log(`Render ${Math.round(done * 100)}% (${i + 1}/${pieces.length}), nog ± ${Math.round(((Date.now() - started) / done - (Date.now() - started)) / 60000)} min`);
    }
  }
  await writeFile(join(out, "pieces.txt"), files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  // Join as one continuous H.264 stream and number the frames again at exactly 24 per second. Joining the mp4 pieces
  // directly left gaps in the timestamps (the player then holds and jumps: visible as judder).
  await ff(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(out, "pieces.txt"), "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", join(out, "video.h264")]);
  await ff(["-y", "-v", "error", "-fflags", "+genpts", "-r", String(FPS), "-i", join(out, "video.h264"), "-c", "copy", join(out, "video.mp4")]);
  await rm(join(out, "video.h264"), { force: true });
  await ff(["-y", "-v", "error", "-i", join(out, "video.mp4"), "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]);
  log(`Render klaar in ${Math.round((Date.now() - started) / 60000)} min: ${final}`);
}
const result = await qc(final, totalS);
await writeFile(join(out, "qc.json"), JSON.stringify(result, null, 1));
await writeFile(join(out, "qc.html"), qcPage(result));
log(`QC ${result.ok ? "✅" : "❌"}: ${[...result.video.problems, ...result.audio.flatMap((a) => a.problems.map((p) => `${a.part}: ${p}`))].slice(0, 12).join(" | ") || "alles in orde"}`);
// Preview for Milan (± 3 min, 720p): start, the move to falling asleep, a sleep moment, the end.
const cuts = [[0, 90], [PARTS.storyEnd - 15, 30], [PARTS.asleepEnd + 600, 30], [totalS - 30, 30]];
await ff(["-y", "-v", "error", ...cuts.flatMap(([s, l]) => ["-ss", String(s), "-t", String(l), "-i", final]), "-filter_complex", cuts.map((_, i) => `[${i}:v]scale=1280:-2,fade=t=in:d=1,fade=t=out:st=${cuts[i][1] - 1}:d=1[v${i}];[${i}:a]afade=t=in:d=1,afade=t=out:st=${cuts[i][1] - 1}:d=1[a${i}]`).join(";") + ";" + cuts.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${cuts.length}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "24", "-c:a", "aac", "-b:a", "160k", join(out, "preview.mp4")]);
log(`Preview: ${join(out, "preview.mp4")}`);

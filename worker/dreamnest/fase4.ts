// Dreamnest fase 4: assemble and render a long episode (default 60 min) with the full QC. Costs nothing (FFmpeg only).
// Run: node worker/dreamnest/fase4.ts [--minutes 60] [--seed 11] [--qc-only]
// - KIVOXEL goes first: every FFmpeg runs at low priority, and before each piece the script waits while another FFmpeg
//   (KIVOXEL's worker) is running.
// - Resumable: every piece is kept with a .ok marker; run it again and it continues where it stopped.
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase4/<minutes>min/ (dreamnest-<minutes>min.mp4, qc.json, qc.html, preview.mp4).
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { constants, homedir, setPriority, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { judgeAudio, KERST_OFFSET, parseEbur128, parseSilences, TARGETS } from "../../lib/dreamnest/audioqc.ts";
import { calmEndFrame } from "../../lib/dreamnest/motion.ts";
import { buildEpisodeTimeline, buildKerstTimeline, dimFilter, episodeLength, PARTS, planPieces, type AssetV2 as Asset, type Piece } from "../../lib/dreamnest/timeline.ts";
import { LOOP_S, type Region, type Weather } from "../../lib/dreamnest/overlay.ts";
import { renderOverlay } from "./overlay.ts";
import { renderFolder, SEASON } from "../../lib/dreamnest/steps.ts";
import { judgeVideo, parseBlack, perMinute } from "../../lib/dreamnest/videoqc.ts";
import { findTool } from "../ffmpeg.ts";
import { lockFolder, waitForKivoxel as waitKivoxelFirst } from "./kivoxelFirst.ts";
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
// Fase 6: only the pieces the 3-minute preview needs (minutes instead of the whole hour), for Milan's judgement first.
const previewOnly = process.argv.includes("--preview-only");
// Dreamnest kerst (16-11-2026): the Christmas living room (content/dreamnest/season.json, or --kerst / --gewoon).
const kerst = process.argv.includes("--kerst") || (SEASON === "kerst" && !process.argv.includes("--gewoon"));
const base = join(env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube"), "dreamnest");
const clipsDir = join(base, "fase2", "1080p");
const kerstLoops = join(base, "fase2", "kerst");
const keyDir = join(base, "keyframes", kerst ? "huiskamer-kerst" : "huiskamer-01");
// Fase 6 (crisp motion, new music): its own folder, so the earlier version stays as it was.
const out = join(base, "fase4", renderFolder(minutes, kerst ? "kerst" : "gewoon"));
const assetsDir = join(out, "assets-v3"), piecesDir = join(out, "pieces"), audioDir = join(out, "audio");
const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);
// Always limited (tv) range: one full-range piece (from a JPEG keyframe) made the light jump after joining.
// crf 16 / medium: less compression shimmer in the soft gradients and the snow (16-11-2026).
const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "24", "-g", "48", "-profile:v", "high", "-an"];
const FPS = 24;
/** Each frame against the next, matched by frame number (never by timestamp, which proved unreliable). */
const STEPS = `setpts=N/${24}/TB,split[x][y];[y]trim=start_frame=1,setpts=N/${24}/TB[b];[x][b]ssim=stats_file=-:shortest=1`;
/** Every clip is brought to this average brightness (0-255) before the dim curve; the clips are around 70-85. */
const LUMA_TARGET = 78;

/** Stall guard (incident 15-11-2026): FFmpeg writes progress to a small file; no new progress for this long = stuck. */
const STALL_MS = Number(env.DN_FFMPEG_STALL_MIN || 10) * 60_000;
let ffCall = 0;

/** FFmpeg at low priority, so KIVOXEL and Milan's pc keep running smoothly. Stopped with a clear error when it stalls. */
function ff(args: string[]): Promise<string> {
  const progress = join(tmpdir(), `dn-ffprogress-${process.pid}-${++ffCall}.txt`);
  return new Promise((ok, no) => {
    let stalled = false;
    let lastSize = -1;
    let lastChange = Date.now();
    const child = execFile(ffmpeg, ["-hide_banner", "-progress", progress, "-stats_period", "5", ...args], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true }, (e, so, se) => {
      clearInterval(guard);
      void rm(progress, { force: true });
      if (stalled) return no(new Error(`FFmpeg vastgelopen: ${Math.round(STALL_MS / 60000)} min geen voortgang (gestopt door de bewaking)`));
      return e ? no(new Error(String(se).slice(-800))) : ok(`${so}\n${se}`);
    });
    const guard = setInterval(() => {
      let size = 0;
      try {
        size = statSync(progress).size;
      } catch {}
      if (size !== lastSize) {
        lastSize = size;
        lastChange = Date.now();
      } else if (Date.now() - lastChange > STALL_MS) {
        stalled = true;
        log(`FFmpeg maakt al ${Math.round(STALL_MS / 60000)} min geen voortgang: gestopt (${args.filter((a) => a.endsWith(".mp4")).pop() ?? "uitvoer onbekend"})`);
        child.kill();
      }
    }, 30_000);
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
  });
}
const probeDur = (f: string) => Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

/** KIVOXEL goes first: waits only for FFmpeg that is not Dreamnest's own (worker/dreamnest/kivoxelFirst.ts). */
const waitForKivoxel = () => waitKivoxelFirst(log);

// ---------- 1. Clips: only the calm part, anti-jitter, loops slower ----------
const CLIPS = readdirClips();
const SET = JSON.parse(readFileSync(join(resolve(import.meta.dirname, "../.."), "content", "dreamnest", "sets", "huiskamer.json"), "utf8")) as { weather?: Weather; regions?: Record<string, Region> };
if (kerst) {
  // Snow instead of rain; and over the whole welcome picture (outside), so it moves from the very first frame.
  SET.weather = "snow";
  SET.regions = { ...SET.regions, "b01-welcome-exterior": { window: { cx: 0.5, cy: 0.5, r: 1.3 } } };
}
const STILL_LEN = 430;
/** Kerst: length of the breathing still (one full breath, loops seamlessly). */
const BREATH_S = 120;
/** Kerst: only the views the sleep part uses get a still (saves render time). */
const KERST_STILLS = ["b05-mo-by-fire", "b06-window-momo", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
const viewOf = (id: string) => id.replace(/^(story|loop|still)-/, "");
/** Sub-pixel breathing zoom: 0 -> amount -> 0 over n frames (one cosine), centred on (cx, cy); loops seamlessly. */
function breathZoom(amount: number, n: number, cx: number, cy: number) {
  const z = `(1+${(amount / 2).toFixed(6)}*(1-cos(2*PI*in/${n})))`;
  const x0 = `W*${cx}-W*${cx}/${z}`, x1 = `W*${cx}+W*${(1 - cx).toFixed(4)}/${z}`, y0 = `H*${cy}-H*${cy}/${z}`, y1 = `H*${cy}+H*${(1 - cy).toFixed(4)}/${z}`;
  return `perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}':interpolation=cubic:eval=frame`;
}
/** Sub-pixel zoom of `amount` over n frames towards (cx, cy) as fractions: smooth, no stepping on whole pixels. */
function smoothZoom(amount: number, n: number, cx: number, cy: number) {
  const z = `(1+${(amount / n).toFixed(9)}*in)`;
  const x0 = `W*${cx}-W/2/${z}`, x1 = `W*${cx}+W/2/${z}`, y0 = `H*${cy}-H/2/${z}`, y1 = `H*${cy}+H/2/${z}`;
  return `perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}':interpolation=cubic:eval=frame`;
}
function readdirClips() {
  if (kerst) {
    // Kerst: the Christmas loops and stills only (no AI story moments: they jumped from moving to frozen).
    const clips: { id: string; kind: "story" | "loop" | "still"; file: string }[] = readdirSync(kerstLoops).filter((f) => /^loop-b\d\d-.*\.mp4$/.test(f) && !f.includes(".ruw.")).map((f) => ({ id: f.replace(/\.mp4$/, ""), kind: "loop" as const, file: join(kerstLoops, f) }));
    // Without the moving loops the story part would be skipped entirely (bug of 16-11-2026): stop instead.
    if (!clips.length) throw new Error(`Geen kerstlussen gevonden in ${kerstLoops}`);
    clips.push({ id: "story-b01-welcome-exterior", kind: "story", file: join(keyDir, "b01-welcome-exterior.png") });
    for (const f of readdirSync(keyDir).filter((x) => KERST_STILLS.some((v) => x === `${v}.png`))) clips.push({ id: `still-${f.replace(/.png$/, "")}`, kind: "still", file: join(keyDir, f) });
    return clips;
  }
  const manifest = JSON.parse(readFileSync(join(clipsDir, "manifest.json"), "utf8")) as { rows: { clip: { id: string; kind: "story" | "loop" }; file: string | null; safety: { ok: boolean } | null }[] };
  const clips: { id: string; kind: "story" | "loop" | "still"; file: string }[] = manifest.rows.filter((r) => r.file).map((r) => ({ id: r.clip.id, kind: r.clip.kind, file: join(clipsDir, r.file!) }));
  // Fase 6: a still of every keyframe after the welcome, for scenes without a loop and for the calm sleep views.
  for (const f of readdirSync(join(base, "keyframes", "huiskamer-01")).filter((x) => /^b(0[2-9]|10)-.*\.png$/.test(x))) clips.push({ id: `still-${f.replace(/\.png$/, "")}`, kind: "still", file: join(base, "keyframes", "huiskamer-01", f) });
  return clips;
}

async function prepAsset(c: { id: string; kind: "story" | "loop" | "still"; file: string }): Promise<Asset> {
  const dst = join(assetsDir, `${c.id}.mp4`);
  if (!existsSync(`${dst}.ok`)) {
    await waitForKivoxel();
    const norm = "settb=AVTB,fps=24,setpts=PTS-STARTPTS";
    const tmp = `${dst}.tmp.mp4`;
    const still = join(keyDir, `${c.id.replace(/^story-/, "")}.png`);
    if (c.id === "story-b01-welcome-exterior" && existsSync(still)) {
      // Welcome: our own slow dolly-in on the chosen keyframe (2% per 10 s, megaprompt §4). Upscaled first so the
      // zoom does not wobble on whole pixels.
      const n = 42 * FPS;
      // Smooth dolly with sub-pixel interpolation (perspective): zoompan stepped on whole pixels and trembled (16-11-2026).
      await ff(["-y", "-v", "error", "-loop", "1", "-framerate", String(FPS), "-i", still, "-vf", `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv444p,${smoothZoom(0.08, n, 0.5, 0.5)},setsar=1,scale=out_range=tv,format=yuv420p`, "-frames:v", String(n), ...ENC, tmp]);
      log(`${c.id}: welkomstbeeld met langzame dolly-in (42 s)`);
    } else if (c.kind === "story") {
      // The own-scene part: until the picture looks more like the next scene than like its own start, never past a cut.
      const vs = (pick: string) => ff(["-i", c.file, "-i", c.file, "-filter_complex", `[0:v]${norm},scale=480:-2[a];[1:v]${norm},scale=480:-2,${pick},loop=loop=-1:size=1,setpts=N/${FPS}/TB[b];[a][b]ssim=stats_file=-:shortest=1`, "-f", "null", "-"]).then(parseAllSsim);
      const vsFirst = await vs("trim=end_frame=1");
      const vsLast = await vs("reverse,trim=end_frame=1");
      const steps = parseAllSsim(await ff(["-i", c.file, "-filter_complex", `[0:v]${norm},scale=480:-2,${STEPS}`, "-f", "null", "-"]));
      const endS = calmEndFrame(vsFirst, vsLast, steps, Math.round(2.5 * FPS)) / FPS;
      // Fase 6: the calm part at its own speed. No slowing down, no frame blending, never backwards (that made it blurry and odd).
      await ff(["-y", "-v", "error", "-i", c.file, "-filter_complex", `[0:v]${norm},trim=end=${endS.toFixed(3)},setpts=PTS-STARTPTS[v]`, "-map", "[v]", ...ENC, tmp]);
      log(`${c.id}: eigen scène ${endS.toFixed(1)} s op eigen snelheid`);
    } else if (c.kind === "still") {
      // A still stays perfectly still (16-11-2026): the slow zoom trembled (zoompan steps on whole pixels, and the zoom
      // jumped back when the still was looped). Its life comes from the living layer (snow/rain, fireflies, fire glow).
      if (kerst) {
        // Kerst (reference "Deep Sleep Piano", 16-11-2026): a very slow breathing camera, 1.5% in and out over 2 minutes,
        // sub-pixel smooth, centred on the window (so the living layer stays in place). The breath is one full cosine,
        // so the 2-minute asset loops without a seam.
        const n = BREATH_S * FPS;
        const reg = SET.regions?.[viewOf(c.id)];
        await ff(["-y", "-v", "error", "-loop", "1", "-framerate", String(FPS), "-i", c.file, "-vf", `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv444p,${breathZoom(0.015, n, reg?.window.cx ?? 0.5, reg?.window.cy ?? 0.45)},setsar=1,scale=out_range=tv,format=yuv420p`, "-frames:v", String(n), ...ENC, tmp]);
        log(`${c.id}: stil beeld met heel langzame ademende camera (${BREATH_S} s, naadloos)`);
      } else {
        const n = STILL_LEN * FPS;
        await ff(["-y", "-v", "error", "-loop", "1", "-framerate", String(FPS), "-i", c.file, "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,scale=out_range=tv,format=yuv420p", "-frames:v", String(n), ...ENC, tmp]);
        log(`${c.id}: stil beeld (${STILL_LEN} s), leven komt van de levende laag`);
      }
    } else {
      // Loops at their own speed. AI video "boils": fine details flicker every frame (Milan, 16-11-2026: "het beeld trilt").
      // A soft temporal blend over 5 frames (1-2-3-2-1) takes 71% of that flicker away and keeps 83% of the real motion
      // (measured on loop-b02). Done on three copies of the loop and the middle one is kept, so the seam stays seamless.
      const loopFrames = Math.round(probeDur(c.file) * FPS);
      await ff(["-y", "-v", "error", "-stream_loop", "2", "-i", c.file, "-filter_complex", `[0:v]${norm},tmix=frames=5:weights='1 2 3 2 1',trim=start_frame=${loopFrames}:end_frame=${2 * loopFrames},setpts=N/${FPS}/TB[v]`, "-map", "[v]", ...ENC, tmp]);
      log(`${c.id}: lus op eigen snelheid, flikkeren gedempt`);
    }
    // Same average brightness for every clip, so a cross-fade between two scenes never jumps in light;
    // getting darker is left to the dim curve alone.
    const luma = parseLuma(await ff(["-i", tmp, "-vf", "scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]));
    const mean = luma.reduce((s, x) => s + x, 0) / Math.max(1, luma.length);
    const k = Math.max(0.8, Math.min(1.25, (LUMA_TARGET - 16) / Math.max(1, mean - 16)));
    await ff(["-y", "-v", "error", "-i", tmp, "-vf", `lutyuv=y='clip((val-16)*${k.toFixed(4)}+16,16,235)'`, ...ENC, dst]);
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
  const dst = join(piecesDir, `${p.id}-${createHash("sha1").update(JSON.stringify({ p, totalS, v: 3 })).digest("hex").slice(0, 10)}.mp4`);
  if (existsSync(`${dst}.ok`)) return dst;
  await waitForKivoxel();
  const dim = dimFilter(p.globalS, p.lengthS, totalS);
  const off = (id: string, s: number) => (s % assets.get(id)!.lengthS).toFixed(3);
  // Fase 6: the living layer (20 s seamless loop) of the view over every loop and still, timed on the episode clock,
  // so it runs on without a seam across pieces and cross-fades.
  const ov = (asset: string) => ((/^(loop|still)-/.test(asset) || kerst) && overlays.has(viewOf(asset)) ? overlays.get(viewOf(asset))! : null);
  const ovOff = (p.globalS % LOOP_S).toFixed(3);
  const layer = (asset: string, label: string, input: number) => {
    const o = ov(asset);
    return o ? { args: ["-stream_loop", "-1", "-i", o], chain: `[${input}:v]trim=start=${ovOff},setpts=PTS-STARTPTS[o${label}];[${label}0][o${label}]overlay=format=auto[${label}]` } : { args: [], chain: `[${label}0]null[${label}]` };
  };
  if (p.kind === "body") {
    const l = layer(p.asset, "a", 1);
    await ff(["-y", "-v", "error", "-stream_loop", "-1", "-i", join(assetsDir, `${p.asset}.mp4`), ...l.args, "-filter_complex", `[0:v]trim=start=${off(p.asset, p.fromS)},setpts=PTS-STARTPTS[a0];${l.chain};[a]${dim},format=yuv420p[v]`, "-map", "[v]", "-frames:v", String(frames(p)), ...ENC, dst]);
  } else {
    // Our own slow cross-fade; both sides brightness-matched by the same dim curve (no "plop" in the light).
    const la = layer(p.from.asset, "a", 2);
    const lb = layer(p.to.asset, "b", 2 + la.args.length / 4);
    await ff(["-y", "-v", "error", "-stream_loop", "-1", "-i", join(assetsDir, `${p.from.asset}.mp4`), "-stream_loop", "-1", "-i", join(assetsDir, `${p.to.asset}.mp4`), ...la.args, ...lb.args, "-filter_complex", `[0:v]trim=start=${off(p.from.asset, p.from.fromS)},setpts=PTS-STARTPTS[a0];[1:v]trim=start=${off(p.to.asset, p.to.fromS)},setpts=PTS-STARTPTS[b0];${la.chain};${lb.chain};[a][b]xfade=transition=fade:duration=${p.lengthS.toFixed(3)}:offset=0,${dim},format=yuv420p[v]`, "-map", "[v]", "-frames:v", String(frames(p)), ...ENC, dst]);
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
      await renderScorePiece(ffmpeg, audioDir, ir, p, kerst);
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
    { id: "story", from: 0, to: PARTS.storyEnd, target: TARGETS.story + (kerst ? KERST_OFFSET : 0) },
    { id: "falling_asleep", from: PARTS.storyEnd, to: PARTS.asleepEnd, target: TARGETS.falling_asleep + (kerst ? KERST_OFFSET : 0) },
    { id: "sleep", from: PARTS.asleepEnd, to: totalS - 120, target: TARGETS.sleep + (kerst ? KERST_OFFSET : 0) },
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

// ---------- Preview only (fase 6) ----------
/**
 * The preview parts flow into each other with a 1.5 s cross-fade (picture and sound) instead of a dip to black
 * (Milan, 16-11-2026: "de overgang is zwart"); only the very start fades in and the very end fades out.
 */
function previewJoin(n: number, lens: number[]): string {
  const X = 1.5;
  let v = "[0:v]", a = "[0:a]", t = lens[0];
  const f: string[] = [];
  for (let i = 1; i < n; i++) {
    f.push(`${v}[${i}:v]xfade=transition=fade:duration=${X}:offset=${(t - X).toFixed(3)}[v${i}]`, `${a}[${i}:a]acrossfade=d=${X}:c1=tri:c2=tri[a${i}]`);
    v = `[v${i}]`; a = `[a${i}]`; t += lens[i] - X;
  }
  f.push(`${v}fade=t=in:d=1,fade=t=out:st=${(t - 1.5).toFixed(3)}:d=1.5[v]`, `${a}afade=t=in:d=1,afade=t=out:st=${(t - 1.5).toFixed(3)}:d=1.5[a]`);
  return f.join(";");
}
const overlays = new Map<string, string>();
const PREVIEW_CUTS = (totalS: number) => [[0, 90], [PARTS.storyEnd - 15, 30], [PARTS.asleepEnd + 600, 30], [totalS - 30, 30]];
async function renderPreviewOnly(pieces: Piece[], assets: Map<string, Asset>, totalS: number, audio: string) {
  const parts: string[] = [];
  for (const [k, [from, len]] of PREVIEW_CUTS(totalS).entries()) {
    const need = pieces.filter((p) => p.globalS < from + len && p.globalS + p.lengthS > from);
    const files: string[] = [];
    for (const p of need) files.push(await renderPiece(p, assets, totalS));
    const list = join(out, `preview-${k}.txt`);
    await writeFile(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    const start = need[0].globalS;
    const part = join(out, `preview-${k}.mp4`);
    // Every piece decoded and joined by the concat filter, then cut by frame number (a copy-join of the pieces gave
    // frames with doubled timestamps: the preview started in the wrong place and blinked).
    const startFrame = Math.round((from - start) * FPS), endFrame = Math.round((from - start + len) * FPS);
    await ff(["-y", "-v", "error", ...files.flatMap((f) => ["-i", f]), "-ss", String(from), "-t", String(len), "-i", audio, "-filter_complex", `${files.map((_, i) => `[${i}:v]`).join("")}concat=n=${files.length}:v=1:a=0,setpts=N/${FPS}/TB,trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=N/${FPS}/TB,scale=1280:-2[v];[${files.length}:a]anull[a]`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-r", "24", "-c:a", "aac", "-b:a", "160k", part]);
    parts.push(part);
  }
  const list = join(out, "preview-all.txt");
  await writeFile(list, parts.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  // One encode over the four parts (the concat filter keeps the clock exact; a copy-join broke the timestamps).
  await ff(["-y", "-v", "error", ...parts.flatMap((f) => ["-i", f]), "-filter_complex", previewJoin(parts.length, PREVIEW_CUTS(totalS).map(([, l]) => l)), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-r", "24", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", join(out, "preview.mp4")]);
  log(`Preview (alleen de benodigde stukken): ${join(out, "preview.mp4")}`);
}

// ---------- Run ----------
await mkdir(assetsDir, { recursive: true });
// One montage per folder (a Studio run and a preview at the same time wrote over each other's files).
lockFolder(out, previewOnly ? "montage of preview" : "montage");
await mkdir(piecesDir, { recursive: true });
await mkdir(audioDir, { recursive: true });
const final = join(out, `dreamnest-${minutes}min.mp4`);
const totalS = minutes * 60;
if (!qcOnly) {
  const started = Date.now();
  const assets = new Map<string, Asset>();
  for (const c of CLIPS) assets.set(c.id, await prepAsset(c));
  for (const [view, reg] of Object.entries(SET.regions ?? {})) {
    const f = join(assetsDir, `overlay-${view}.mov`);
    if (!existsSync(`${f}.ok`)) {
      await waitForKivoxel();
      await renderOverlay(ffmpeg, f, reg, SET.weather ?? "rain");
      await writeFile(`${f}.ok`, "");
      log(`${view}: levende laag gemaakt (${SET.weather ?? "rain"}, vuurvliegjes, stofjes, haardgloed)`);
    }
    overlays.set(view, f);
  }
  const segs = (kerst ? buildKerstTimeline : buildEpisodeTimeline)([...assets.values()], minutes, seed);
  const pieces = planPieces(segs);
  await writeFile(join(out, "timeline.json"), JSON.stringify({ minutes, seed, length_s: episodeLength(segs), segments: segs, pieces }, null, 1));
  log(`Tijdlijn: ${segs.length} delen, ${pieces.length} renderstukken.`);
  const audio = await soundtrack(totalS);
  if (previewOnly) {
    await renderPreviewOnly(pieces, assets, totalS, audio);
    process.exit(0);
  }
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
  log("Stap: Samenvoegen tot één bestand");
  await ff(["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(out, "pieces.txt"), "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "h264", join(out, "video.h264")]);
  await ff(["-y", "-v", "error", "-fflags", "+genpts", "-r", String(FPS), "-i", join(out, "video.h264"), "-c", "copy", join(out, "video.mp4")]);
  await rm(join(out, "video.h264"), { force: true });
  await ff(["-y", "-v", "error", "-i", join(out, "video.mp4"), "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]);
  log(`Render klaar in ${Math.round((Date.now() - started) / 60000)} min: ${final}`);
}
log("Stap: Controle per minuut (beeld en geluid)");
const result = await qc(final, totalS);
await writeFile(join(out, "qc.json"), JSON.stringify(result, null, 1));
await writeFile(join(out, "qc.html"), qcPage(result));
log(`QC ${result.ok ? "✅" : "❌"}: ${[...result.video.problems, ...result.audio.flatMap((a) => a.problems.map((p) => `${a.part}: ${p}`))].slice(0, 12).join(" | ") || "alles in orde"}`);
// Preview for Milan (± 3 min, 720p): start, the move to falling asleep, a sleep moment, the end.
log("Stap: Preview van 3 minuten maken");
const cuts = [[0, 90], [PARTS.storyEnd - 15, 30], [PARTS.asleepEnd + 600, 30], [totalS - 30, 30]];
// Each cut as its own small file first, then one join over those small files. Four inputs of the same hour-long file in
// one concat filter hung FFmpeg for 12 hours (incident 15-11-2026, docs/incident-dreamnest-93.md).
const cutFiles: string[] = [];
for (const [i, [s, l]] of cuts.entries()) {
  const f = join(out, `preview-cut-${i}.mp4`);
  // Length on the output side with a fixed frame count (an input-side -t gave 215 s of picture for 90 s of sound).
  await ff(["-y", "-v", "error", "-ss", String(s), "-i", final, "-t", String(l), "-frames:v", String(l * FPS), "-vf", `setpts=N/${FPS}/TB,scale=1280:-2`, "-af", "asetpts=PTS-STARTPTS", "-c:v", "libx264", "-crf", "24", "-r", "24", "-c:a", "aac", "-b:a", "160k", f]);
  cutFiles.push(f);
}
await ff(["-y", "-v", "error", ...cutFiles.flatMap((f) => ["-i", f]), "-filter_complex", previewJoin(cutFiles.length, cuts.map(([, l]) => l)), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "24", "-r", "24", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", join(out, "preview.mp4")]);
for (const f of cutFiles) await rm(f, { force: true });
log(`Preview: ${join(out, "preview.mp4")}`);

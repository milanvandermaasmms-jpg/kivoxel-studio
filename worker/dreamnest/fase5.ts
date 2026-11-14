// Dreamnest fase 5: packaging of an episode. Title, description, tags and chapters (from the timeline), 3 thumbnails
// (an AI background without text + our own text layer) and 3 vertical Shorts from the finished video.
// Run: node worker/dreamnest/fase5.ts [--minutes 60] [--seed 1] [--dry]
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase5/<minutes>min/ (package.json, thumbs/, shorts/).
// Paid: only the 3 backgrounds (Gemini image, ± € 0,11 each, cached). Ceiling: DREAMNEST_BUDGET_CENTS (all phases together).
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants, homedir, setPriority } from "node:os";
import { join, resolve } from "node:path";
import { STYLE_DNA, type Character } from "../../lib/dreamnest/bible.ts";
import { chaptersFrom, dnShortAss, dnThumbAss, episodeText, planShorts, shortText, thumbLines } from "../../lib/dreamnest/package.ts";
import type { Segment } from "../../lib/dreamnest/timeline.ts";
import { findTool } from "../ffmpeg.ts";
import { renderFolder } from "../../lib/dreamnest/steps.ts";
import { createGeminiImage, IMAGE_CENTS } from "../providers/image/gemini.ts";
import { cacheKey, createCache, createLedger } from "./ledger.ts";

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
const seed = Number(arg("--seed", "1"));
const title = arg("--title", "Lumi's Cozy Fireplace Night").slice(0, 80);
const dry = process.argv.includes("--dry");
const base = join(env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube"), "dreamnest");
const render = join(base, "fase4", renderFolder(minutes));
const out = join(base, "fase5", `${minutes}min`);
const rel = (...p: string[]) => ["fase5", `${minutes}min`, ...p].join("/");
const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);
const ledger = createLedger(base, Number(env.DREAMNEST_BUDGET_CENTS || 1000));
const cache = createCache(join(base, "cache"));

function ff(args: string[], cwd: string): Promise<string> {
  return new Promise((ok, no) => {
    const child = execFile(ffmpeg, ["-hide_banner", "-y", "-v", "error", ...args], { cwd, maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (e, so, se) => (e ? no(new Error(String(se).slice(-800))) : ok(`${so}\n${se}`)));
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
  });
}
/** KIVOXEL goes first: wait while another FFmpeg runs. */
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

// ---------- 0. What is there ----------
const qc = JSON.parse(readFileSync(join(render, "qc.json"), "utf8")) as { ok: boolean };
const timeline = JSON.parse(readFileSync(join(render, "timeline.json"), "utf8")) as { segments: Segment[] };
const video = join(render, `dreamnest-${minutes}min.mp4`);
if (!existsSync(video)) throw new Error(`De aflevering van ${minutes} min staat niet op de pc; eerst Montage en controle.`);
log(qc.ok ? "Montage gevonden, QC ✅" : "Let op: de QC van de montage is niet ✅; publiceren blijft geblokkeerd.");
const thumbCost = 3 * IMAGE_CENTS["2K"];
log(`Verpakking: teksten en Shorts gratis; 3 thumbnail-achtergronden hoogstens € ${(thumbCost / 100).toFixed(2)} (uit de opslag gratis). Al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)}.`);
if (dry) process.exit(0);
await mkdir(join(out, "thumbs"), { recursive: true });
await mkdir(join(out, "shorts"), { recursive: true });

// ---------- 1. Texts and chapters ----------
const chapters = chaptersFrom(timeline.segments);
const text = episodeText({ title, minutes, chapters });
log(`Titel: ${text.title}`);
log(`${chapters.length} hoofdstukken, ${text.tags.length} tags`);

// ---------- 2. Thumbnails: AI background (no text) + our own text layer ----------
const lumi = JSON.parse(readFileSync(join(root, "content", "dreamnest", "characters", "lumi.json"), "utf8")) as Character & { prompt_dna: string };
const refs = await Promise.all(["ref-thumbnail.jpg", "ref-turnaround.jpg"].map(async (f) => ({ mime: "image/jpeg", data: await readFile(join(root, "content", "dreamnest", "characters", "lumi", f)) })));
const SCENES = [
  "behind her a cozy cottage living room with a softly glowing fireplace, warm orange firelight on her fur",
  "behind her a big round window with gently falling snow and a soft moon glow, cool blue light with a warm candle glow",
  "around her soft glowing clouds and tiny twinkling stars, as if she floats in a dreamy night sky",
];
const thumbs: string[] = [];
const image = env.GEMINI_API_KEY ? createGeminiImage(env.GEMINI_API_KEY) : null;
for (let i = 0; i < 3; i++) {
  const prompt =
    `YouTube thumbnail artwork, 16:9, no text. Lumi van Dreamnest: ${lumi.prompt_dna} ` +
    `She is big and close in the left 45% of the frame, seen from the waist up, eyes peacefully closed, hugging Twinkle the softly glowing star plush; ${SCENES[i]}. ` +
    "The right half is a calm, mostly empty deep purple-blue night area with a soft glow, kept free for a title. Match the look of the first reference image. " +
    STYLE_DNA;
  const key = cacheKey(["dn-thumb-bg", prompt, String(seed), ...refs.map((r) => r.data)]);
  let bg = await cache.get(key, "png");
  if (!bg) {
    if (!image) throw new Error("GEMINI_API_KEY ontbreekt in worker/.env.local");
    await ledger.guard(IMAGE_CENTS["2K"]);
    log(`Thumbnail-achtergrond ${i + 1}/3 maken...`);
    const r = await image.generate({ prompt, refs, aspect: "16:9", size: "2K" });
    await ledger.add({ provider: "google", model: r.model, purpose: `thumbnail-achtergrond ${i + 1}`, cents: r.costCents, cacheKey: key });
    bg = r.data;
    await cache.put(key, "png", bg);
  } else log(`Thumbnail-achtergrond ${i + 1}/3 uit de opslag (gratis)`);
  const dir = join(out, "thumbs");
  await writeFile(join(dir, `bg-${i + 1}.png`), bg);
  await writeFile(join(dir, `t${i + 1}.ass`), dnThumbAss(thumbLines(title), `${minutes >= 120 ? `${minutes / 60} Hours` : minutes === 90 ? "90 Minutes" : "1 Hour"} of Sleep Music`, i));
  await waitForKivoxel();
  await ff(["-i", `bg-${i + 1}.png`, "-vf", `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=saturation=1.05,ass=t${i + 1}.ass`, "-frames:v", "1", "-q:v", "3", `thumb-${i + 1}.jpg`], dir);
  thumbs.push(rel("thumbs", `thumb-${i + 1}.jpg`));
}
log("3 thumbnails klaar (tekst als eigen laag)");

// ---------- 3. Shorts: 9:16 with a soft blurred fill, our text, gentle fades ----------
const shorts = [];
for (const p of planShorts(timeline.segments)) {
  const dir = join(out, "shorts");
  await writeFile(join(dir, `${p.id}.ass`), dnShortAss(p.caption, p.lengthS));
  await waitForKivoxel();
  const len = p.lengthS;
  await ff(
    [
      "-ss", String(p.fromS), "-t", String(len), "-i", video,
      "-filter_complex",
      `[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.06:saturation=0.9[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,ass=${p.id}.ass,fade=t=in:st=0:d=0.8,fade=t=out:st=${len - 1}:d=1,format=yuv420p[v];[0:a]afade=t=in:d=1,afade=t=out:st=${len - 1.5}:d=1.5[aud]`,
      "-map", "[v]", "-map", "[aud]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "24", "-color_range", "tv", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", `${p.id}.mp4`,
    ],
    dir,
  );
  shorts.push({ id: p.id, file: rel("shorts", `${p.id}.mp4`), lengthS: len, ...shortText(p, title) });
  log(`Short klaar: ${p.caption} (${len} s)`);
}

const pkg = { made_at: new Date().toISOString(), minutes, seed, qc_ok: qc.ok, long_file: `fase4/${renderFolder(minutes)}/dreamnest-${minutes}min.mp4`, ...text, chapters, thumbs, shorts };
await writeFile(join(out, "package.json"), JSON.stringify(pkg, null, 1));
log(`Klaar: ${join(out, "package.json")}. Totaal gebruikt € ${((await ledger.spent()) / 100).toFixed(2)}.`);

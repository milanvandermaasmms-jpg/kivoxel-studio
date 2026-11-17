// Dreamnest kerst (16-11-2026, Milan: "voeg de kerstsfeer toe: kerstboom, kerstsokken en kerstverlichting").
// Christmas versions of the living-room keyframes (image edit, same style and characters) and seamless Christmas loops.
// Run: node worker/dreamnest/kerst.ts images|loops [--dry]
// Budget: Milan approved ± € 6 extra on 16-11-2026. The run stops at KERST_CEILING_CENTS (spent before + 600 cent).
// Output on this pc: <data>/dreamnest/keyframes/huiskamer-kerst/*.png and <data>/dreamnest/fase2/kerst/*.mp4.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { judgeClip, MOTION_DNA } from "../../lib/dreamnest/motion.ts";
import { findTool } from "../ffmpeg.ts";
import { createGeminiImage, IMAGE_CENTS } from "../providers/image/gemini.ts";
import { createOmniVideo } from "../providers/video/omni.ts";
import { cacheKey, createCache, createLedger } from "./ledger.ts";
import { measureClip, runTool, silentArgs } from "./measure.ts";
import { seamlessLoopArgs } from "../../lib/dreamnest/motion.ts";

const root = resolve(import.meta.dirname, "../..");
const env: Record<string, string | undefined> = { ...process.env };
const envFile = env.DREAMNEST_ENV_FILE || join(root, "worker", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const stage = process.argv[2] === "loops" ? "loops" : process.argv[2] === "stories" ? "stories" : "images";
const dry = process.argv.includes("--dry");
const base = join(env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube"), "dreamnest");
const from = join(base, "keyframes", "huiskamer-01");
const kerstDir = join(base, "keyframes", "huiskamer-kerst");
const loopsDir = join(base, "fase2", "kerst");
// Milan's approval: ± € 6 on top of what was spent before 16-11-2026 (2525 cent). Never more.
const CEILING = Number(env.KERST_CEILING_CENTS || 2525 + 600);
const ledger = createLedger(base, CEILING, CEILING);
const cache = createCache(join(base, "cache"));
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);

/** The views that get a Christmas version (all keyframes after the welcome, plus the welcome itself). */
export const KERST_VIEWS = ["b01-welcome-exterior", "b02-lumi-rocking-chair", "b03-pip-arrives", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
/**
 * D0 (Milan, 16-11-2026: "vriendjes moeten in beeld binnenkomen, Lumi moet vloeiend bewegen"): story clips from one
 * Christmas keyframe to the next. Milan approved up to € 4 extra for these (ceiling via KERST_CEILING_CENTS).
 */
export const KERST_STORIES: { id: string; first: string; last: string; motion: string }[] = [
  { id: "story-b02-lumi-rocking-chair", first: "b02-lumi-rocking-chair", last: "b03-pip-arrives", motion: "Pip the little owl waddles in slowly through the round door with his candle and his long scarf; Lumi looks up from her rocking chair with a small happy smile." },
  { id: "story-b03-pip-arrives", first: "b03-pip-arrives", last: "b05-mo-by-fire", motion: "Mo the little fox walks in slowly, sits down by the warm fire next to the Christmas stockings, turns once and settles into a round ball." },
  { id: "story-b05-mo-by-fire", first: "b05-mo-by-fire", last: "b08-blanket-together", motion: "Lumi and Pip walk over slowly and snuggle up together with Mo under a big soft blanket by the Christmas tree." },
  { id: "story-b08-blanket-together", first: "b08-blanket-together", last: "b09-lumi-falls-asleep", motion: "Lumi gives one slow soft yawn, hugs Twinkle the little star and slowly lies down, her eyes closing as she falls asleep." },
];

/** Views that also get a moving Christmas loop (each ± 83 cent). */
export const KERST_LOOPS: Record<string, string> = {
  // Milan 17-11-2026 ("in de intro hangen de grote sneeuwvlokken stil"): the welcome gets real falling snow (≤ € 2 approved with b10).
  "b01-welcome-exterior": "Every snowflake in the sky falls down slowly and softly, all the time, none of them hang still; the smiling moon glows calmly, the warm window and the fairy lights on the tree glow steadily, the stockings sway very slightly.",
  "b02-lumi-rocking-chair": "Lumi rocks very slowly back and forth in the rocking chair, breathing calmly, hugging Twinkle; the fire flickers gently, snow falls softly outside, the Christmas lights glow steadily.",
  "b05-mo-by-fire": "Mo sleeps curled up in a round ball, his body rising and falling slowly with each breath; the fire flickers softly beside the Christmas stockings, the tree lights glow steadily.",
  "b06-window-momo": "Big soft snowflakes drift down slowly outside the round window, the moon Momo glows calmly, the warm fairy lights around the window glow steadily.",
  "b08-blanket-together": "Everyone breathes slowly together under the blanket, eyes closed; the fire flickers gently, snow falls softly outside, the Christmas lights glow steadily.",
  "b09-lumi-falls-asleep": "Lumi breathes slowly in her sleep hugging Twinkle, Twinkle glows softly; snow falls gently outside, the tree lights glow steadily.",
  "b10-sleep-loop-base": "Everyone keeps lying down asleep with eyes closed: the owl, Lumi and Mo breathe slowly and softly, the candle flame flickers very gently, the fire glows low, snow drifts down slowly outside the window, the Christmas tree lights glow softly and steadily.",
};

const EDIT =
  "Edit this exact image. Keep the room, the camera angle and framing, every character (shape, colours, face, pose, size), the lighting and the soft 3D animated-film style exactly the same. " +
  "Only add a cosy, calm Christmas atmosphere: a small Christmas tree with warm golden fairy lights and soft felt ornaments and a little star on top, standing in a free corner of the room where it hides nothing; " +
  "knitted Christmas stockings (red, cream and lilac) hanging from the fireplace mantel if the fireplace is visible; a string of warm golden fairy lights along the round window frame if the window is visible; a little pine garland. " +
  "Outside the window it now snows softly with big gentle flakes instead of rain, with a little snow on the window sill. " +
  "Everything stays warm, soft and baby-friendly: no bright or harsh light, no flashing, no new characters, no text, no logos.";

async function images() {
  await mkdir(kerstDir, { recursive: true });
  const todo = KERST_VIEWS.filter((v) => !existsSync(join(kerstDir, `${v}.png`)));
  log(`Kerst-beelden: ${todo.length} te maken, ± € ${((todo.length * IMAGE_CENTS["2K"]) / 100).toFixed(2)}. Al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)}, plafond € ${(CEILING / 100).toFixed(2)}.`);
  if (dry) return;
  const image = createGeminiImage(env.GEMINI_API_KEY!);
  for (const v of todo) {
    const ref = { mime: "image/png", data: await readFile(join(from, `${v}.png`)) };
    const key = cacheKey([image.model, EDIT, "kerst-v1", ref.data]);
    let data = await cache.get(key, "png");
    if (!data) {
      await ledger.guard(IMAGE_CENTS["2K"]);
      const made = await image.generate({ prompt: EDIT, refs: [ref], aspect: "16:9", size: "2K" });
      data = made.data;
      await cache.put(key, "png", data);
      await ledger.add({ provider: "gemini", model: made.model, purpose: `kerst ${v}`, cents: made.costCents, cacheKey: key });
    }
    await writeFile(join(kerstDir, `${v}.png`), data);
    log(`${v}: kerstversie klaar`);
  }
}

async function loops() {
  await mkdir(loopsDir, { recursive: true });
  const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
  const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
  const video = createOmniVideo(env.GEMINI_API_KEY!);
  const todo = Object.keys(KERST_LOOPS).filter((v) => !existsSync(join(loopsDir, `loop-${v}.mp4`)) && existsSync(join(kerstDir, `${v}.png`)));
  log(`Kerst-lussen: ${todo.length} te maken, ± € ${((todo.length * video.estimateCents(8, "1080p")) / 100).toFixed(2)}. Al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)}, plafond € ${(CEILING / 100).toFixed(2)}.`);
  if (dry) return;
  for (const v of todo) {
    const frame = { mime: "image/png", data: await readFile(join(kerstDir, `${v}.png`)) };
    const prompt = `${MOTION_DNA}\n\nA seamless loop that starts and ends on exactly this image: ${KERST_LOOPS[v]} The Christmas lights never blink or flash.`;
    const key = cacheKey([video.model, prompt, "8s", "1080p", frame.data, frame.data]);
    let data = await cache.get(key, "mp4");
    if (!data) {
      try {
        await ledger.guard(video.estimateCents(8, "1080p"));
      } catch (e) {
        // Milan's € 6 ceiling: stop making new loops; the montage uses the Christmas still of this view instead.
        log(`loop-${v}: niet gemaakt (${e instanceof Error ? e.message.slice(0, 80) : "budget"}); de montage gebruikt het kerst-stilbeeld`);
        break;
      }
      log(`loop-${v}: maken (8 s, 1080p)...`);
      const made = await video.generate({ first: frame, last: frame, prompt, durationS: 8, resolution: "1080p" });
      data = made.data;
      await cache.put(key, "mp4", data);
      await ledger.add({ provider: video.name, model: made.model, purpose: `kerst loop-${v}`, cents: made.costCents, cacheKey: key });
    }
    const silent = join(loopsDir, `loop-${v}.ruw.mp4`);
    await runTool(ffmpeg, silentArgs(cache.path(key, "mp4"), silent));
    const out = join(loopsDir, `loop-${v}.mp4`);
    // Free seam repair first: 1 s cross-fade, then 2 s (as in fase 2).
    let safety = null as ReturnType<typeof judgeClip> | null;
    for (const fade of [1, 2]) {
      await runTool(ffmpeg, seamlessLoopArgs(silent, out, 8, fade));
      safety = judgeClip(await measureClip(ffmpeg, ffprobe, out, true), "loop");
      if (safety.ok) break;
    }
    await rm(silent, { force: true });
    if (!safety) continue;
    log(`loop-${v}: ${safety.ok ? "veilig ✅" : `⚠️ ${safety.problems.join("; ")}`}`);
  }
}

async function stories() {
  await mkdir(loopsDir, { recursive: true });
  const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
  const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
  const video = createOmniVideo(env.GEMINI_API_KEY!);
  const todo = KERST_STORIES.filter((c) => !existsSync(join(loopsDir, `${c.id}.mp4`)));
  log(`Kerst-verhaalclips: ${todo.length} te maken, ± € ${((todo.length * video.estimateCents(8, "1080p")) / 100).toFixed(2)}. Al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)}, plafond € ${(CEILING / 100).toFixed(2)}.`);
  if (dry) return;
  for (const c of todo) {
    const first = { mime: "image/png", data: await readFile(join(kerstDir, `${c.first}.png`)) };
    const last = { mime: "image/png", data: await readFile(join(kerstDir, `${c.last}.png`)) };
    const prompt = `${MOTION_DNA}

From the first image to the last image, as one continuous calm shot in the same room: ${c.motion} Movement is smooth and slow the whole time; the camera stays still. The Christmas lights never blink or flash; snow falls softly outside.`;
    const key = cacheKey([video.model, prompt, "8s", "1080p", first.data, last.data]);
    let data = await cache.get(key, "mp4");
    if (!data) {
      try {
        await ledger.guard(video.estimateCents(8, "1080p"));
      } catch (e) {
        log(`${c.id}: niet gemaakt (${e instanceof Error ? e.message.slice(0, 80) : "budget"})`);
        break;
      }
      log(`${c.id}: maken (8 s, 1080p)...`);
      const made = await video.generate({ first, last, prompt, durationS: 8, resolution: "1080p" });
      data = made.data;
      await cache.put(key, "mp4", data);
      await ledger.add({ provider: video.name, model: made.model, purpose: `kerst ${c.id}`, cents: made.costCents, cacheKey: key });
    }
    const out = join(loopsDir, `${c.id}.mp4`);
    await runTool(ffmpeg, silentArgs(cache.path(key, "mp4"), out));
    const safety = judgeClip(await measureClip(ffmpeg, ffprobe, out, false), "story");
    log(`${c.id}: ${safety.ok ? "veilig ✅" : `⚠️ ${safety.problems.join("; ")}`}`);
  }
}

if (!env.GEMINI_API_KEY && !dry) throw new Error("GEMINI_API_KEY ontbreekt in worker/.env.local");
if (stage === "images") await images();
else if (stage === "stories") await stories();
else await loops();
log(`Totaal Dreamnest nu € ${((await ledger.spent()) / 100).toFixed(2)} (plafond deze run € ${(CEILING / 100).toFixed(2)}).`);

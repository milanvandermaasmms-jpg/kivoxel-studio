// Dreamnest fase 2: story clips and seamless loops from the chosen keyframes, with the baby-safe check.
// Run: node worker/dreamnest/fase2.ts [--only <clip-id>] [--res 720p|1080p] [--dry]
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase2/<res>/index.html. Ceiling: DREAMNEST_BUDGET_CENTS (all phases together).
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { clipCents, judgeClip, planClips, seamlessLoopArgs, type Clip, type SafetyResult } from "../../lib/dreamnest/motion.ts";
import { findTool } from "../ffmpeg.ts";
import { CreditError, createOmniVideo } from "../providers/video/omni.ts";
import { BudgetError, cacheKey, createCache, createLedger } from "./ledger.ts";
import { measureClip, runTool, silentArgs } from "./measure.ts";

const root = resolve(import.meta.dirname, "../..");
const env: Record<string, string | undefined> = { ...process.env };
const envFile = env.DREAMNEST_ENV_FILE || join(root, "worker", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const res = arg("--res") === "720p" ? "720p" : "1080p";
const only = arg("--only");
const dry = process.argv.includes("--dry");
const content = join(root, "content", "dreamnest");
const motion = JSON.parse(readFileSync(join(content, "shots", "fase2-motion.json"), "utf8")) as Parameters<typeof planClips>[0];
const clips = planClips(motion).filter((c) => !only || c.id === only);
const dataDir = env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube");
const base = join(dataDir, "dreamnest");
const keyframes = join(base, "keyframes", "huiskamer-01");
const out = join(base, "fase2", res);
const ceiling = Number(env.DREAMNEST_BUDGET_CENTS || 1000);
const ledger = createLedger(base, ceiling);
const cache = createCache(join(base, "cache"));
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);

const estimate = clips.reduce((s, c) => s + clipCents(c.durationS, res), 0);
log(`${clips.length} clips (${clips.reduce((s, c) => s + c.durationS, 0)} s) in ${res}: ± € ${(estimate / 100).toFixed(2)} (bij één herkansing per clip hoogstens € ${((estimate * 2) / 100).toFixed(2)}). Al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}.`);
if (dry) process.exit(0);
if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ontbreekt in worker/.env.local");

const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
const video = createOmniVideo(env.GEMINI_API_KEY);
await mkdir(out, { recursive: true });
type Row = { clip: Clip; file: string | null; attempts: number; safety: SafetyResult | null; error?: string };
const rows: Row[] = [];
const frame = async (shot: string) => ({ mime: "image/png", data: await readFile(join(keyframes, `${shot}.png`)) });

for (const clip of clips) {
  const row: Row = { clip, file: null, attempts: 0, safety: null };
  rows.push(row);
  try {
    const first = await frame(clip.first);
    const last = await frame(clip.last);
    for (let attempt = 1; attempt <= 2; attempt++) {
      row.attempts = attempt;
      const prompt = attempt === 1 ? clip.prompt : `${clip.prompt}\n\nEven calmer and slower than before; keep the light completely steady.`;
      const key = cacheKey([video.model, prompt, `${clip.durationS}s`, res, first.data, last.data]);
      let data = await cache.get(key, "mp4");
      if (!data) {
        await ledger.guard(video.estimateCents(clip.durationS, res));
        log(`${clip.id}: maken (${clip.durationS} s, ${res}, poging ${attempt})...`);
        const made = await video.generate({ first, last, prompt, durationS: clip.durationS, resolution: res });
        data = made.data;
        await cache.put(key, "mp4", data);
        await ledger.add({ provider: video.name, model: made.model, purpose: `${clip.id} ${res} poging ${attempt}`, cents: made.costCents, cacheKey: key });
      }
      const raw = cache.path(key, "mp4");
      const name = `${clip.id}.mp4`;
      if (clip.kind === "loop") {
        // Loops: silent, then the free cross-fade seam repair (1 s, then 2 s) before any paid retry.
        const silent = join(out, `${clip.id}.ruw.mp4`);
        await runTool(ffmpeg, silentArgs(raw, silent));
        for (const fade of [1, 2]) {
          await runTool(ffmpeg, seamlessLoopArgs(silent, join(out, name), clip.durationS, fade));
          row.safety = judgeClip(await measureClip(ffmpeg, ffprobe, join(out, name), true), clip.kind);
          if (row.safety.ok) break;
        }
        await rm(silent, { force: true });
      } else {
        await runTool(ffmpeg, silentArgs(raw, join(out, name)));
        row.safety = judgeClip(await measureClip(ffmpeg, ffprobe, join(out, name), false), clip.kind);
      }
      row.file = name;
      if (!row.safety) throw new Error("Niet gemeten");
      log(`${clip.id}: ${row.safety.ok ? "veilig ✅" : `❌ ${row.safety.problems.join("; ")}`}`);
      if (row.safety.ok) break;
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e);
    log(`${clip.id}: ${row.error}`);
    if (e instanceof BudgetError || e instanceof CreditError) break;
  }
}

const spent = await ledger.spent();
await writeFile(join(out, "manifest.json"), JSON.stringify({ res, made_at: new Date().toISOString(), spent_cents: spent, rows }, null, 1));
await writeFile(join(out, "index.html"), page());
log(`Klaar. Totaal gebruikt € ${(spent / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}. Overzicht: ${join(out, "index.html")}`);

function page() {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cards = rows
    .map((r) => `<figure>${r.file ? `<video src="${r.file}" controls muted playsinline ${r.clip.kind === "loop" ? "loop autoplay" : ""}></video>` : "<div class=empty></div>"}<figcaption><b>${r.clip.kind === "loop" ? "🔁 lus" : "🎬 verhaal"} · ${esc(r.clip.id)}</b> · ${r.clip.durationS} s<br>${r.safety ? (r.safety.ok ? "✅ veilig (geen flitsen, rustig licht" + (r.clip.kind === "loop" ? ", naadloos" : "") + ")" : `❌ ${esc(r.safety.problems.join("; "))}`) : ""}${r.error ? `<br><small>${esc(r.error)}</small>` : ""}</figcaption></figure>`)
    .join("\n");
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Dreamnest fase 2</title>
<style>body{font:15px system-ui;margin:16px;background:#14162b;color:#eee}h1{font-size:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}figure{margin:0;background:#1f2240;border-radius:10px;overflow:hidden}video,.empty{width:100%;aspect-ratio:16/9;display:block;background:#2a2d52}figcaption{padding:8px 10px}small{color:#bbb}</style>
<h1>🌙 Dreamnest fase 2: beweging (${res})</h1><p>Kosten tot nu toe: € ${(spent / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}. Lussen spelen vanzelf herhaald, zodat je de naad kunt zien.</p><div class=g>${cards}</div>`;
}

// KIVOXEL fase 1: Event Timeline for one recording, without AI. Usage (in the project folder):
//   node scripts/kivoxel-events.ts <first letters of the fingerprint or part of the name> [output folder]
// Writes <data>/events/<fingerprint>.json and, in the output folder, events-<name>.json plus a contact sheet
// (events-<name>.jpg) with the thumbnail frame of the best events, so you can check with your own eyes.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildEvents, topPayoffs } from "../lib/kivoxel/events.ts";
import type { Signals } from "../lib/youtube/footage.ts";
import { detectSignals, findTool } from "../worker/ffmpeg.ts";
import { visualFor } from "../worker/visualSignals.ts";

const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const [query, outArg] = process.argv.slice(2);
if (!query) {
  console.log("Gebruik: node scripts/kivoxel-events.ts <vingerafdruk of naam> [map]");
  process.exit(1);
}
type Rec = { fingerprint: string; label: string; file: string; isTest: boolean; probe: { durationMs: number } | null };
const recs = JSON.parse(await readFile(join(dataDir, "recordings.json"), "utf8")) as Rec[];
const rec = recs.find((r) => r.fingerprint.startsWith(query)) ?? recs.find((r) => r.label.toLowerCase().includes(query.toLowerCase()));
if (!rec?.probe) throw new Error(`Geen opname gevonden voor "${query}"`);
const ffmpeg = findTool("ffmpeg");
const file = join(dataDir, "recordings", rec.file);
const out = resolve(outArg ?? join("testrenders", "events"));
await mkdir(out, { recursive: true });

const t0 = Date.now();
let signals: Signals | null = null;
try {
  signals = JSON.parse(await readFile(join(dataDir, "signals", `${rec.fingerprint}.json`), "utf8")) as Signals;
} catch {
  console.log("Geluidssignalen meten…");
  signals = await detectSignals(ffmpeg, file, rec.probe.durationMs, out);
  await mkdir(join(dataDir, "signals"), { recursive: true });
  await writeFile(join(dataDir, "signals", `${rec.fingerprint}.json`), JSON.stringify(signals));
}
console.log("Beeldsignalen meten (hartjes, doodscherm, beweging)…");
const visual = await visualFor(ffmpeg, dataDir, rec.fingerprint, file, rec.probe.durationMs);
const timeline = buildEvents({ visual, signals });
await mkdir(join(dataDir, "events"), { recursive: true });
await writeFile(join(dataDir, "events", `${rec.fingerprint}.json`), JSON.stringify(timeline, null, 1));
const slug = rec.label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
await writeFile(join(out, `events-${slug}.json`), JSON.stringify(timeline, null, 1));

const tc = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const deadMs = timeline.dead.reduce((s, d) => s + d.endMs - d.startMs, 0);
console.log(`\n${rec.label}: ${timeline.events.length} events, ${Math.round((deadMs / timeline.durationMs) * 100)}% dood beeld, ${Math.round((Date.now() - t0) / 1000)} s`);
for (const e of [...timeline.events].sort((a, b) => b.payoff - a.payoff).slice(0, 15)) {
  console.log(`  ${String(e.payoff).padStart(3)}  ${tc(e.t_peak).padStart(5)}  ${(e.type ?? "-").padEnd(10)} ${e.description}`);
}

// Contact sheet: the thumbnail frame of the top events, 3 per row, with payoff, time and description.
const top = topPayoffs(timeline, 6, 0);
if (top.length) {
  const tiles: string[] = [];
  for (const [i, e] of top.entries()) {
    const ass = join(out, `tile${i}.ass`);
    const label = `${e.payoff}  ${tc(e.t_peak)}  ${e.description}`.replace(/[{}\\]/g, "");
    await writeFile(ass, ["[Script Info]", "PlayResX: 640", "PlayResY: 360", "", "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding", "Style: L,Arial,22,&H0000E5FF,&H0000E5FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,3,2,0,7,8,8,8,1", "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", `Dialogue: 0,0:00:00.00,0:00:10.00,L,,0,0,0,,${label}`, ""].join("\n"), "utf8");
    const tile = join(out, `tile${i}.jpg`);
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", (e.t_thumb / 1000).toFixed(2), "-i", file, "-frames:v", "1", "-vf", `scale=640:360,subtitles=tile${i}.ass`, tile], { cwd: out });
    tiles.push(tile);
  }
  while (tiles.length % 3) tiles.push(tiles[tiles.length - 1]);
  const rows = tiles.length / 3;
  const inputs = tiles.flatMap((t) => ["-i", t]);
  const graph = Array.from({ length: rows }, (_, r) => `[${r * 3}][${r * 3 + 1}][${r * 3 + 2}]hstack=3[r${r}]`).join(";") + (rows > 1 ? `;${Array.from({ length: rows }, (_, r) => `[r${r}]`).join("")}vstack=${rows}[o]` : "");
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", rows > 1 ? "[o]" : "[r0]", join(out, `events-${slug}.jpg`)]);
  console.log(`\nOverzicht: ${join(out, `events-${slug}.jpg`)}`);
}

// KIVOXEL fase 1: makes the self-made sound effects (in the repo, assets/kivoxel/sfx) and three generated TEST music
// tracks (on this pc, <data>/kivoxel-media/music). Everything is synthesised with FFmpeg: nobody else owns any rights.
// The test tracks are only for testing the mix (ducking, beat on the payoff); the worker never uses them for a real
// video. Real music: put royalty-free tracks in <data>/kivoxel-media/music and add them to library.json (see
// docs/kivoxel-presets.md).
//   node scripts/kivoxel-make-media.ts
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Sfx, Track } from "../lib/kivoxel/media.ts";
import { findTool } from "../worker/ffmpeg.ts";

const ffmpeg = findTool("ffmpeg", process.env.FFMPEG_PATH);
const sfxDir = resolve("assets", "kivoxel", "sfx");
const dataDir = process.env.WORKER_DATA_DIR ?? join(homedir(), "FamilieMK-YouTube");
const musicDir = join(dataDir, "kivoxel-media", "music");
await mkdir(sfxDir, { recursive: true });
await mkdir(musicDir, { recursive: true });

const make = (graph: string, seconds: number, out: string) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-filter_complex", `${graph},atrim=0:${seconds},aformat=sample_rates=48000:channel_layouts=stereo[o]`, "-map", "[o]", out]);

// ---- SFX ----
const sfx: Sfx[] = [];
const whoosh = (name: string, d: number, color: string, hp: number) => {
  make(`anoisesrc=d=${d}:c=${color}:a=0.9,highpass=f=${hp},lowpass=f=7000,afade=t=in:d=${(d * 0.6).toFixed(2)}:curve=exp,afade=t=out:st=${(d * 0.6).toFixed(2)}:d=${(d * 0.4).toFixed(2)}:curve=exp,volume=1.6`, d, join(sfxDir, name));
  sfx.push({ file: name, kind: "whoosh", db: 8 });
};
whoosh("whoosh-1.wav", 0.45, "pink", 400);
whoosh("whoosh-2.wav", 0.6, "pink", 250);
whoosh("whoosh-3.wav", 0.8, "brown", 150);

const impact = (name: string, base: number, drop: number) => {
  make(`aevalsrc='0.95*sin(2*PI*(${base}+${drop}*exp(-t*22))*t)*exp(-t*5.5)|0.95*sin(2*PI*(${base}+${drop}*exp(-t*22))*t)*exp(-t*5.5)':d=1.1:s=48000[k];anoisesrc=d=0.12:c=white:a=0.5,lowpass=f=3500,afade=t=out:st=0:d=0.12[n];[k][n]amix=inputs=2:normalize=0,alimiter=limit=0.9`, 1.1, join(sfxDir, name));
  sfx.push({ file: name, kind: "impact" });
};
impact("impact-1.wav", 45, 120);
impact("impact-2.wav", 55, 90);
impact("impact-3.wav", 38, 160);

const scratch = (name: string, f: number, wob: number) => {
  make(`aevalsrc='0.55*sin(2*PI*(${f}+${f * 0.7}*sin(2*PI*${wob}*t))*t)*exp(-t*2.5)|0.55*sin(2*PI*(${f}+${f * 0.7}*sin(2*PI*${wob}*t))*t)*exp(-t*2.5)':d=0.55:s=48000[s];anoisesrc=d=0.55:c=pink:a=0.35,bandpass=f=1800:w=900,tremolo=f=${wob * 2}:d=0.9[n];[s][n]amix=inputs=2:normalize=0`, 0.55, join(sfxDir, name));
  sfx.push({ file: name, kind: "scratch" });
};
scratch("scratch-1.wav", 380, 7);
scratch("scratch-2.wav", 300, 9);

make(`aevalsrc='0.8*sin(2*PI*(1100-3000*t)*t)*exp(-t*28)|0.8*sin(2*PI*(1100-3000*t)*t)*exp(-t*28)':d=0.18:s=48000`, 0.18, join(sfxDir, "pop-1.wav"));
sfx.push({ file: "pop-1.wav", kind: "pop" });
make(`anoisesrc=d=1.6:c=white:a=0.7,highpass=f=600,afade=t=in:d=1.5:curve=exp,afade=t=out:st=1.5:d=0.1`, 1.6, join(sfxDir, "riser-1.wav"));
sfx.push({ file: "riser-1.wav", kind: "riser", db: -4 });
await writeFile(join(sfxDir, "library.json"), JSON.stringify({ $comment: "Self-made with FFmpeg (scripts/kivoxel-make-media.ts): no rights of others.", source: "eigen (KIVOXEL, gesynthetiseerd)", license: "eigen werk", sfx }, null, 2) + "\n");

// ---- TEST music (chiptune-like loops) ----
const loop = (bpm: number, notes: number[], lead: boolean, seconds = 64) => {
  const B = (60 / bpm).toFixed(5);
  const bar = `mod(t,16*${B})`;
  const n = `if(lt(${bar},4*${B}),${notes[0]},if(lt(${bar},8*${B}),${notes[1]},if(lt(${bar},12*${B}),${notes[2]},${notes[3]})))`;
  const F = `(55*pow(2,(${n})/12))`;
  const kick = `0.9*sin(2*PI*(45+90*exp(-mod(t,${B})*30))*mod(t,${B}))*exp(-mod(t,${B})*9)`;
  const hat = `0.12*(random(0)*2-1)*exp(-mod(t+${B}/2,${B})*70)`;
  const bass = `0.22*(lt(mod(t*${F},1),0.5)*2-1)*gt(mod(t,${B}/2),${B}/10)`;
  const arp = lead ? `+0.07*(lt(mod(t*${F}*4*pow(2,floor(mod(t*4/${B},3))*4/12),1),0.5)*2-1)` : "";
  const e = `${kick}+${hat}+${bass}${arp}`;
  return `aevalsrc='${e}|${e}':d=${seconds}:s=48000,lowpass=f=9000,volume=0.8`;
};
const tracks: Track[] = [
  { file: "test-hype-140.wav", title: "TEST hype 140", source: "TESTTRACK, gesynthetiseerd", license: "eigen werk, alleen voor tests", energy: 5, moods: ["hype", "funny"], bpm: 140, beat_offset_ms: 0, test: true },
  { file: "test-tense-120.wav", title: "TEST tense 120", source: "TESTTRACK, gesynthetiseerd", license: "eigen werk, alleen voor tests", energy: 4, moods: ["tense", "epic", "dark"], bpm: 120, beat_offset_ms: 0, test: true },
  { file: "test-chill-92.wav", title: "TEST chill 92", source: "TESTTRACK, gesynthetiseerd", license: "eigen werk, alleen voor tests", energy: 2, moods: ["chill", "happy"], bpm: 92, beat_offset_ms: 0, test: true },
];
make(loop(140, [0, 5, 7, 3], true), 64, join(musicDir, tracks[0].file));
make(loop(120, [0, 1, 0, -2], false), 64, join(musicDir, tracks[1].file));
make(loop(92, [0, 4, 7, 5], true), 64, join(musicDir, tracks[2].file));
// Keep tracks Milan added himself; replace only the test entries.
let own: Track[] = [];
try {
  own = (JSON.parse(await readFile(join(musicDir, "library.json"), "utf8")) as { tracks: Track[] }).tracks.filter((t) => !t.test);
} catch {
  // first time
}
await writeFile(join(musicDir, "library.json"), JSON.stringify({ $comment: "Music library for KIVOXEL. Only royalty-free tracks with source and licence. See docs/kivoxel-presets.md.", tracks: [...own, ...tracks] }, null, 2) + "\n");
console.log(`${sfx.length} SFX in ${sfxDir}\n${tracks.length} testtracks in ${musicDir} (plus ${own.length} eigen tracks bewaard)`);

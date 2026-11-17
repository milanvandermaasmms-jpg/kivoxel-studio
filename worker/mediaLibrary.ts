// The local media libraries on this pc (KIVOXEL fase 1, section 3):
// - music: <data>/kivoxel-media/music/library.json + the audio files next to it (royalty-free, with source and licence);
// - SFX: the self-made sounds in the repo (assets/kivoxel/sfx) plus any extra in <data>/kivoxel-media/sfx.
// Entries with a problem (no licence, wrong file type, missing file) are skipped and reported in Dutch.
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SFX_KINDS, trackProblems, type Sfx, type Track } from "../lib/kivoxel/media.ts";
import { createPhraseLog } from "./phraseLog.ts";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function createMediaLibrary(dataDir: string, repoSfxDir: string, log: (msg: string) => void = () => {}) {
  const musicDir = join(dataDir, "kivoxel-media", "music");
  const extraSfxDir = join(dataDir, "kivoxel-media", "sfx");
  return {
    musicDir,
    async music(): Promise<{ dir: string; tracks: Track[] }> {
      const lib = await readJson<{ tracks?: Partial<Track>[] }>(join(musicDir, "library.json"));
      const tracks: Track[] = [];
      for (const t of lib?.tracks ?? []) {
        const problems = trackProblems(t);
        if (!problems.length && !existsSync(join(musicDir, t.file!))) problems.push(`Track "${t.title ?? t.file}": bestand ${t.file} staat niet in ${musicDir}.`);
        if (problems.length) problems.forEach((p) => log(`Muziek: ${p}`));
        else tracks.push(t as Track);
      }
      return { dir: musicDir, tracks };
    },
    async sfx(): Promise<{ dir: string; items: Sfx[] }> {
      // Both folders end up in one list with absolute file names; the dir is then empty.
      const items: Sfx[] = [];
      for (const dir of [repoSfxDir, extraSfxDir]) {
        const lib = await readJson<{ sfx?: Sfx[] }>(join(dir, "library.json"));
        for (const s of lib?.sfx ?? []) if (SFX_KINDS.includes(s.kind) && existsSync(join(dir, s.file))) items.push({ ...s, file: join(dir, s.file) });
      }
      return { dir: "", items };
    },
    /** The KIVOXEL motif (own work, scripts/kivoxel-make-music.ts) in <data>/kivoxel-media/jingles; null when it is not there. */
    async motif(): Promise<{ file: string; durMs: number } | null> {
      const file = join(dataDir, "kivoxel-media", "jingles", "kivoxel-motief.wav");
      try {
        const { size } = await stat(file);
        return { file, durMs: Math.round(((size - 44) / (48_000 * 4)) * 1000) }; // 48 kHz, 16-bit stereo
      } catch {
        return null;
      }
    },
    musicLog: createPhraseLog(join(dataDir, "kivoxel-music-log.json")),
    sfxLog: createPhraseLog(join(dataDir, "kivoxel-sfx-log.json")),
  };
}

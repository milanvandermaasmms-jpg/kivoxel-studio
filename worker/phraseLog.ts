// Which phrases (hooks, VO lines) were used recently, on this pc: <data>/kivoxel-phrases.json.
// The free script engine and the AI prompt avoid them, so videos do not sound like one template (section 7.8).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const KEEP = 120;

export function createPhraseLog(file: string) {
  async function recent(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { recent?: unknown };
      return Array.isArray(parsed.recent) ? parsed.recent.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return {
    recent,
    async add(used: string[]) {
      if (!used.length) return;
      const next = [...(await recent()), ...used].slice(-KEEP);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ recent: next }), "utf8");
    },
  };
}
export type PhraseLog = ReturnType<typeof createPhraseLog>;

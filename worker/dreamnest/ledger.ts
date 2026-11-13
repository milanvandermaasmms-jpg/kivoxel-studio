// Dreamnest cost ledger and cache on this pc (megaprompt §9): every paid call is logged, nothing is paid twice,
// and a call that would pass the ceiling is refused before it is made.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type LedgerEntry = { at: string; provider: string; model: string; purpose: string; cents: number; cacheKey: string | null };

export class BudgetError extends Error {}

export function cacheKey(parts: (string | Buffer)[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : createHash("sha256").update(p).digest("hex")).update("\u0000");
  return h.digest("hex").slice(0, 32);
}

export function createLedger(dir: string, ceilingCents: number) {
  const file = join(dir, "costs.json");
  let entries: LedgerEntry[] | null = null;
  async function load() {
    if (!entries) entries = existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as LedgerEntry[]) : [];
    return entries;
  }
  const spent = async () => (await load()).reduce((s, e) => s + e.cents, 0);
  return {
    file,
    spent,
    /** Throws before a call that would pass the ceiling. */
    async guard(estimateCents: number) {
      const now = await spent();
      if (now + estimateCents > ceilingCents) throw new BudgetError(`Budget op: ${now} van ${ceilingCents} cent gebruikt, deze stap kost ± ${estimateCents} cent. Gepauzeerd tot Milan meer budget geeft.`);
    },
    async add(entry: Omit<LedgerEntry, "at">) {
      const list = await load();
      list.push({ at: new Date().toISOString(), ...entry });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(list, null, 1));
    },
    async entries() {
      return [...(await load())];
    },
  };
}

/** Files by cache key: a request that was made before comes back from disk, for free. */
export function createCache(dir: string) {
  return {
    path: (key: string, ext: string) => join(dir, `${key}.${ext}`),
    async get(key: string, ext: string): Promise<Buffer | null> {
      const p = join(dir, `${key}.${ext}`);
      return existsSync(p) ? readFile(p) : null;
    },
    async put(key: string, ext: string, data: Buffer | string) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.${ext}`), data);
    },
  };
}

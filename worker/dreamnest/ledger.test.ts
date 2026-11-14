import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetError, createLedger } from "./ledger.ts";

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("cost ledger brakes", () => {
  it("stops at the total ceiling and at the monthly brake (shared Google credit with KIVOXEL)", async () => {
    dir = await mkdtemp(join(tmpdir(), "dn-ledger-"));
    const month = new Date().toISOString().slice(0, 7);
    await writeFile(join(dir, "costs.json"), JSON.stringify([
      { at: "2026-01-10T10:00:00.000Z", provider: "google", model: "m", purpose: "old month", cents: 900, cacheKey: null },
      { at: `${month}-01T10:00:00.000Z`, provider: "google", model: "m", purpose: "this month", cents: 1400, cacheKey: null },
    ]));
    const l = createLedger(dir, 3500, 1500);
    await expect(l.guard(100)).resolves.toBeUndefined(); // 1400 + 100 = the brake exactly
    await expect(l.guard(101)).rejects.toThrow(/Maandrem/);
    await expect(l.guard(101)).rejects.toBeInstanceOf(BudgetError);
    await expect(createLedger(dir, 2400, 99999).guard(101)).rejects.toThrow(/Budget op/);
  });
});

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Runs the rights and privacy checks on a throwaway in-memory Postgres; never touches Supabase.
it("migrations keep the studio private", () => {
  // Every migration in number order, so a new one (also from another branch) is always checked.
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => resolve("supabase/migrations", f));
  const output = execFileSync(process.execPath, [resolve("supabase/tests/rls-check.mjs"), ...migrations], { encoding: "utf8", timeout: 80_000 });
  expect(output).toContain("ALL PASSED");
}, 90_000);

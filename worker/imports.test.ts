import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 23-11-2026: the worker runs on plain Node (type stripping), which needs the ".ts" in every relative import. The app
// (Next.js) does not, so a missing extension in a lib file passes tsc, tests and build, and only the worker fails to
// start. This walks every file the worker loads and names each relative import without an extension.
describe("worker imports", () => {
  it("every relative import the worker loads has a file extension", () => {
    const root = resolve(__dirname, "..");
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s(?!type\s)[^;]*?from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const spec = m[1];
        if (!/\.(ts|js|json|mjs)$/.test(spec)) {
          bad.push(`${file.slice(root.length + 1)}: "${spec}"`);
          continue;
        }
        const next = join(dirname(file), spec);
        if (next.endsWith(".ts") && existsSync(next)) walk(next);
      }
    };
    walk(join(root, "worker", "index.ts"));
    expect(bad).toEqual([]);
  });
});

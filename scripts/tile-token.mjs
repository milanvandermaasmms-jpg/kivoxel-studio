// Makes the secret token for the tile "KIVOXEL: X klaar voor review" in the family dashboard.
// Usage: node scripts/tile-token.mjs <path to familie-m-en-k/.env.local>
// The token goes straight into that .env.local (KIVOXEL_TILE_TOKEN) and is never printed.
// It prints only the SQL with the SHA-256 fingerprint, which is safe to paste into the SQL Editor of KIVOXEL Studio.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.error("Geef het pad naar de .env.local van het familie-dashboard mee.");
  process.exit(1);
}
const text = readFileSync(target, "utf8");
if (/^KIVOXEL_TILE_TOKEN=\S+/m.test(text)) {
  console.error("Er staat al een KIVOXEL_TILE_TOKEN in dit bestand. Haal die eerst weg als je een nieuwe wilt.");
  process.exit(1);
}
const token = randomBytes(32).toString("hex");
const line = `KIVOXEL_TILE_TOKEN=${token}`;
writeFileSync(target, text.replace(/^#?\s*KIVOXEL_TILE_TOKEN=.*$/m, "").replace(/\s*$/, "\n") + line + "\n");
const sha = createHash("sha256").update(token, "utf8").digest("hex");
console.log(`insert into public.studio_tile_tokens (token_sha256, label) values ('${sha}', 'familie-dashboard');`);

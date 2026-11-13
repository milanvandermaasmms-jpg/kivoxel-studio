// Dreamnest fase 1: make the designs (stage a) or the keyframes (stage b) and an overview page for Milan.
// Run: node worker/dreamnest/fase1.ts a        (or b; add --dry to only show the plan and the worst-case cost)
// Output on this pc: <WORKER_DATA_DIR>/dreamnest/fase1/stage-<a|b>/index.html. Ceiling: DREAMNEST_BUDGET_CENTS (default 1000).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { worstCaseCents, type Character, type SetPack, type Shot } from "../../lib/dreamnest/bible.ts";
import { createGeminiImage, createGeminiVision, IMAGE_CENTS } from "../providers/image/gemini.ts";
import { createCache, createLedger } from "./ledger.ts";
import { runShots, type ShotResult } from "./shots.ts";

const root = resolve(import.meta.dirname, "../..");
const env: Record<string, string | undefined> = { ...process.env };
// DREAMNEST_ENV_FILE: use the settings of the running worker (e.g. from a worktree), without the key ever being printed.
const envFile = env.DREAMNEST_ENV_FILE || join(root, "worker", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

const stage = process.argv[2] === "b" ? "b" : "a";
const dry = process.argv.includes("--dry");
const content = join(root, "content", "dreamnest");
const readJson = <T,>(p: string) => JSON.parse(readFileSync(p, "utf8")) as T;
const characters = readdirSync(join(content, "characters")).filter((f) => f.endsWith(".json")).map((f) => readJson<Character>(join(content, "characters", f)));
const sets = readdirSync(join(content, "sets")).filter((f) => f.endsWith(".json")).map((f) => readJson<SetPack>(join(content, "sets", f)));
const shots = readJson<Shot[]>(join(content, "shots", "fase1.json")).filter((s) => s.stage === stage);
const dataDir = env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube");
const base = join(dataDir, "dreamnest");
const out = join(base, "fase1", `stage-${stage}`);
const ceiling = Number(env.DREAMNEST_BUDGET_CENTS || 1000);
const ledger = createLedger(base, ceiling);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL")}] ${m}`);

const worst = worstCaseCents(shots, (s) => IMAGE_CENTS[s] + 1);
log(`Stap ${stage}: ${shots.length} shots, ${shots.reduce((n, s) => n + s.variants, 0)} beelden. Hoogstens ± € ${(worst / 100).toFixed(2)}; al gebruikt € ${((await ledger.spent()) / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}.`);
if (dry) process.exit(0);
if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ontbreekt in worker/.env.local");

await mkdir(out, { recursive: true });
const results = await runShots(shots, {
  image: createGeminiImage(env.GEMINI_API_KEY),
  vision: createGeminiVision(env.GEMINI_API_KEY),
  ledger,
  cache: createCache(join(base, "cache")),
  characters,
  sets,
  readRef: async (p, kind) => ({ mime: extname(p) === ".png" ? "image/png" : "image/jpeg", data: await readFile(join(content, kind === "set" ? "sets" : "characters", p)) }),
  save: async (name, data) => (await writeFile(join(out, name), data), name),
  log,
});

const spent = await ledger.spent();
await writeFile(join(out, "manifest.json"), JSON.stringify({ stage, made_at: new Date().toISOString(), spent_cents: spent, results }, null, 1));
await writeFile(join(out, "index.html"), page(results, spent));
log(`Klaar. Totaal gebruikt € ${(spent / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}. Overzicht: ${join(out, "index.html")}`);

function page(rs: ShotResult[], cents: number) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const label: Record<ShotResult["status"], string> = { accepted: "✅ consistent", no_check: "🆕 nieuw ontwerp (kies er één)", to_milan: "⚠️ jij beslist", failed: "❌ mislukt", budget: "⏸️ budget op" };
  const cards = rs
    .map((r) => `<figure>${r.file ? `<a href="${r.file}"><img src="${r.file}" loading="lazy"></a>` : "<div class=empty></div>"}<figcaption><b>${esc(r.shot)} · v${r.variant}</b><br>${label[r.status]}${r.score !== null ? ` · score ${r.score}` : ""} · ${r.attempts} poging(en)${r.error ? `<br><small>${esc(r.error)}</small>` : ""}${r.issues.length ? `<br><small>${esc(r.issues.join("; "))}</small>` : ""}</figcaption></figure>`)
    .join("\n");
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Dreamnest fase 1 stap ${stage}</title>
<style>body{font:15px system-ui;margin:16px;background:#14162b;color:#eee}h1{font-size:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}figure{margin:0;background:#1f2240;border-radius:10px;overflow:hidden}img,.empty{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#2a2d52}figcaption{padding:8px 10px}small{color:#bbb}</style>
<h1>🌙 Dreamnest fase 1, stap ${stage}</h1><p>Kosten tot nu toe: € ${(cents / 100).toFixed(2)} van € ${(ceiling / 100).toFixed(2)}. Klik op een beeld voor de grote versie.</p><div class=g>${cards}</div>`;
}

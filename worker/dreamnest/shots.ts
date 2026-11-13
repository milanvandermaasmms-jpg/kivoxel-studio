// Dreamnest fase 1: make the images of a shot list, with the consistency check and the budget ceiling.
// Everything is injected, so the tests run without Gemini, money or files.
import { buildPrompt, consistencyDecision, type Character, type SetPack, type Shot } from "../../lib/dreamnest/bible.ts";
import type { ImageProvider, ImageRequest, VisionProvider } from "../providers/image/types.ts";
import { BudgetError, cacheKey, type createCache, type createLedger } from "./ledger.ts";

export type ShotResult = {
  shot: string;
  variant: number;
  file: string | null;
  attempts: number;
  score: number | null;
  issues: string[];
  status: "accepted" | "no_check" | "to_milan" | "failed" | "budget";
  error?: string;
};

type Deps = {
  image: ImageProvider;
  vision: VisionProvider | null;
  ledger: ReturnType<typeof createLedger>;
  cache: ReturnType<typeof createCache>;
  characters: Character[];
  sets: SetPack[];
  readRef: (path: string, kind: "character" | "set") => Promise<ImageRequest["refs"][number]>;
  save: (name: string, data: Buffer) => Promise<string>;
  log: (msg: string) => void;
  threshold?: number;
  maxAttempts?: number;
};

export async function runShots(shots: Shot[], d: Deps): Promise<ShotResult[]> {
  const results: ShotResult[] = [];
  const max = d.maxAttempts ?? 3;
  let stopped = false;
  for (const shot of shots) {
    const cast = shot.characters.map((id) => d.characters.find((c) => c.id === id)!);
    const missing = shot.stage === "b" ? cast.filter((c) => !c.reference_images.length).map((c) => c.name) : [];
    const set = d.sets.find((s) => s.id === shot.set) ?? null;
    const refsByChar = await Promise.all(cast.map(async (c) => ({ c, refs: await Promise.all(c.reference_images.map((p) => d.readRef(p, "character"))) })));
    // Keyframes also get the approved set plate, so the room stays the same room.
    const setRefs = shot.kind === "keyframe" && set?.reference_images ? await Promise.all(set.reference_images.map((p) => d.readRef(p, "set"))) : [];
    const allRefs = [...refsByChar.flatMap((r) => r.refs), ...setRefs];
    for (let v = 1; v <= shot.variants; v++) {
      const result: ShotResult = { shot: shot.id, variant: v, file: null, attempts: 0, score: null, issues: [], status: "failed" };
      results.push(result);
      if (stopped) {
        result.status = "budget";
        continue;
      }
      if (missing.length) {
        result.error = `Eerst een gekozen ontwerp nodig voor: ${missing.join(", ")}`;
        continue;
      }
      let fix: string[] = [];
      for (let attempt = 1; attempt <= max; attempt++) {
        result.attempts = attempt;
        const prompt = `${buildPrompt(shot, d.characters, set)}\n\nVariation ${v}.${fix.length ? `\nCorrect these differences from the reference: ${fix.join("; ")}.` : ""}`;
        const key = cacheKey([d.image.model, prompt, shot.aspect, shot.size, `a${attempt}`, ...allRefs.map((r) => r.data)]);
        let data = await d.cache.get(key, "png");
        try {
          if (!data) {
            await d.ledger.guard(d.image.estimateCents(shot.size) + (d.vision ? refsByChar.filter((r) => r.refs.length).length : 0));
            const out = await d.image.generate({ prompt, refs: allRefs, aspect: shot.aspect, size: shot.size });
            data = out.data;
            await d.cache.put(key, "png", data);
            await d.ledger.add({ provider: d.image.name, model: out.model, purpose: `${shot.id} v${v} poging ${attempt}`, cents: out.costCents, cacheKey: key });
          }
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e);
          if (e instanceof BudgetError) {
            result.status = "budget";
            stopped = true;
          }
          d.log(`${shot.id} v${v}: ${result.error}`);
          break;
        }
        result.file = await d.save(`${shot.id}-v${v}.png`, data);
        const checks = d.vision ? refsByChar.filter((r) => r.refs.length) : [];
        if (!checks.length) {
          result.status = "no_check";
          break;
        }
        let worst = 100;
        const issues: string[] = [];
        for (const { c, refs } of checks) {
          const vkey = `${key}-${c.id}`;
          const cached = await d.cache.get(vkey, "json");
          const check = cached ? (JSON.parse(cached.toString()) as { score: number; issues: string[] }) : await d.vision!.consistency(refs, { mime: "image/png", data }, `${c.name}: ${c.prompt_dna}`);
          if (!cached) {
            await d.cache.put(vkey, "json", JSON.stringify(check));
            await d.ledger.add({ provider: "gemini", model: d.vision!.model, purpose: `consistentie ${c.id} ${shot.id} v${v}`, cents: (check as { costCents?: number }).costCents ?? 1, cacheKey: vkey });
          }
          worst = Math.min(worst, check.score);
          issues.push(...check.issues.map((i) => `${c.name}: ${i}`));
        }
        result.score = worst;
        result.issues = issues;
        const decision = consistencyDecision(worst, attempt, d.threshold ?? 80, max);
        d.log(`${shot.id} v${v} poging ${attempt}: score ${worst} → ${decision}`);
        if (decision === "accept") {
          result.status = "accepted";
          break;
        }
        if (decision === "to_milan") {
          result.status = "to_milan";
          break;
        }
        fix = issues.slice(0, 5);
      }
    }
  }
  return results;
}

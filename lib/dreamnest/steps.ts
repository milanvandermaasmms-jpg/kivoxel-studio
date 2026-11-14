// Dreamnest fase 0.5: the production steps as the Studio shows them, and which tested script the worker runs for each.
// Pure (no Node, no database), so the Studio and the worker share it. Every step waits for Milan's "Goedkeuren"
// before the next one is queued; paid steps say their maximum cost on the button.
import type { DnStep } from "./core";

export type FlowStep = {
  step: DnStep;
  label: string;
  /** What the step does, in plain Dutch. */
  about: string;
  /** Maximum cost in euro cents when nothing is cached yet (0 = free, on the pc). */
  maxCents: number;
  /** Episode status while this step runs. */
  stage: "concept" | "keyframes" | "animation" | "music" | "rendering";
  /** What "Aanpassen" does for this step (null = only Opnieuw). */
  adjust: "seed" | "clip" | null;
};

export const FLOW: FlowStep[] = [
  { step: "dn_concept", label: "Concept", about: "Titel, personages, set en het verhaal per beeld.", maxCents: 0, stage: "concept", adjust: null },
  { step: "dn_keyframes", label: "Keyframes", about: "De stilstaande beelden per scène (Gemini-beeld), met controle op gelijkenis van Lumi.", maxCents: 250, stage: "keyframes", adjust: null },
  { step: "dn_animate", label: "Animatie", about: "Korte AI-clips tussen de keyframes en naadloze lussen (Gemini Omni).", maxCents: 2500, stage: "animation", adjust: "clip" },
  { step: "dn_music", label: "Muziek", about: "Eigen slaapliedjes en sfeergeluid, op de pc gemaakt (gratis).", maxCents: 0, stage: "music", adjust: "seed" },
  { step: "dn_render", label: "Montage en controle", about: "De hele aflevering op de pc, met controle per minuut en een preview van 3 minuten.", maxCents: 0, stage: "rendering", adjust: "seed" },
];

export type JobLike = { step: string; status: string; created_at: string };
export type StepView = { flow: FlowStep; state: "todo" | "queued" | "running" | "done" | "failed"; job: JobLike | null };

/** The newest job per step decides its state; a cancelled job counts as not started. */
export function stepViews<J extends JobLike>(jobs: J[]): (StepView & { job: J | null })[] {
  return FLOW.map((flow) => {
    const job = jobs.filter((j) => j.step === flow.step && j.status !== "cancelled").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    return { flow, job, state: job ? (job.status as StepView["state"]) : "todo" };
  });
}

/** The one step Milan can start now: the first that is not done, once everything before it is done. */
export function nextStep(views: StepView[]): FlowStep | null {
  for (const v of views) {
    if (v.state === "done") continue;
    return v.state === "todo" || v.state === "failed" ? v.flow : null;
  }
  return null;
}

export type StepPayload = { seed?: number; only?: string; minutes?: number };

/** The tested script (worker/dreamnest/faseN.ts) and its arguments for a step. */
export function scriptFor(step: DnStep, durationMin: number, payload: StepPayload): { script: string; args: string[] } | null {
  const seed = Number.isInteger(payload.seed) ? String(payload.seed) : "11";
  switch (step) {
    case "dn_keyframes":
      return { script: "fase1.ts", args: ["b"] };
    case "dn_animate":
      return { script: "fase2.ts", args: ["--res", "1080p", ...(payload.only && /^[a-z0-9-]{1,80}$/.test(payload.only) ? ["--only", payload.only] : [])] };
    case "dn_music":
      return { script: "fase3.ts", args: ["--seed", seed] };
    case "dn_render":
      return { script: "fase4.ts", args: ["--minutes", String(durationMin), "--seed", seed] };
    default:
      return null;
  }
}

/** "[09:12:27] Render 54% (50/73), nog ± 20 min" -> 54. Only the render reports a percentage. */
export function parseProgress(line: string): number | null {
  const m = /Render (\d{1,3})%/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

export const euro = (cents: number) => `€ ${(cents / 100).toFixed(2).replace(".", ",")}`;

/** Relative file paths under the Dreamnest folder only: no "..", no drive letters, only media the Studio shows. */
export function safeMediaPath(p: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]{0,200}$/i.test(p) && !p.split("/").some((s) => s === ".." || s === "." || s === "") && /\.(jpg|jpeg|png|mp4|m4a)$/i.test(p);
}

// Dreamnest fase 0.5: the real worker steps. Each step runs the tested script of its phase (fase1..fase4.ts) as a
// child process at low priority, reports progress to dn_render_jobs and returns what the Studio shows (files on this
// pc, relative to the Dreamnest folder). Paid steps go through the scripts' own ledger, cache and budget ceiling.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DnStep } from "../../lib/dreamnest/core.ts";
import { FLOW, parseProgress, renderFolder, scriptFor, type StepPayload } from "../../lib/dreamnest/steps.ts";
import type { DnHandler, DnJob } from "./lane.ts";
import { createLedger } from "./ledger.ts";

const root = resolve(import.meta.dirname, "../..");

export type RunScript = (script: string, args: string[], onLine: (line: string) => void, env?: Record<string, string>) => Promise<void>;

/** Runs worker/dreamnest/<script> with this Node, below normal priority (KIVOXEL and the pc stay fast). */
export const runScript: RunScript = (script, args, onLine, extraEnv = {}) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(root, "worker", "dreamnest", script), ...args], { cwd: root, env: { ...process.env, ...extraEnv }, windowsHide: true });
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // not allowed on this pc: it still works, only at normal priority
    }
    const tail: string[] = [];
    const read = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 20) tail.shift();
        onLine(line);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(tail.slice(-3).join(" | ").slice(-400) || `${script} stopte met code ${code}`))));
  });

const list = (dir: string, rel: string, ext: RegExp) => (existsSync(dir) ? readdirSync(dir).filter((f) => ext.test(f) && !f.includes(".raw.")).sort().map((f) => `${rel}/${f}`) : []);
const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** fase4 qc.json: { ok, video: { problems }, audio: [{ part, problems }] } -> a short list for the Studio. */
export function qcProblems(qc: Record<string, unknown> | null): string[] {
  if (!qc) return ["Geen controlerapport gevonden"];
  const video = ((qc.video as { problems?: string[] } | undefined)?.problems ?? []).map((p) => `Beeld: ${p}`);
  const audio = ((qc.audio as { part: string; problems?: string[] }[] | undefined) ?? []).flatMap((a) => (a.problems ?? []).map((p) => `Geluid ${a.part}: ${p}`));
  return [...video, ...audio].slice(0, 10);
}

type Episode = { id: string; title: string; duration_min: number; spent_cents: number };

/** envFile: the worker's own .env.local, so the scripts use the same keys, budget ceiling and data folder as the worker. */
export function createDnHandlers(o: { db: SupabaseClient; dataDir: string; log: (msg: string) => void; run?: RunScript; envFile?: string; publish?: DnHandler }): Partial<Record<DnStep, DnHandler>> {
  const base = join(o.dataDir, "dreamnest");
  const run = o.run ?? runScript;
  // Only to read what was spent (fresh each time: the script writes costs.json); the scripts keep the ceiling.
  const spent = () => createLedger(base, Number.MAX_SAFE_INTEGER).spent();

  async function episode(job: DnJob): Promise<Episode> {
    const { data, error } = await o.db.from("dn_episodes").select("id, title, duration_min, spent_cents").eq("id", job.episode_id).single<Episode>();
    if (error || !data) throw new Error(`Aflevering niet gevonden: ${error?.message ?? job.episode_id}`);
    return data;
  }
  const setStage = (job: DnJob, status: string) => o.db.from("dn_episodes").update({ status }).eq("id", job.episode_id).then(() => undefined);

  /** Runs the step's script; progress and the last line go to the job row, so the Studio can show them. */
  async function runStep(job: DnJob, ep: Episode) {
    const plan = scriptFor(job.step, ep.duration_min, (job.payload ?? {}) as StepPayload, ep.title);
    if (!plan) throw new Error(`Stap ${job.step} heeft geen script`);
    const before = await spent();
    let lastWrite = 0;
    let progress: number | null = null;
    try {
      await run(plan.script, plan.args, (line) => {
        progress = parseProgress(line) ?? progress;
        o.log(`Dreamnest ${job.step}: ${line.replace(/^\[\d\d:\d\d:\d\d\] /, "")}`);
        if (Date.now() - lastWrite < 5000) return;
        lastWrite = Date.now();
        void o.db.from("dn_render_jobs").update({ heartbeat_at: new Date().toISOString(), result: { last: line.slice(0, 300) }, ...(progress !== null ? { progress } : {}) }).eq("id", job.id).then(() => undefined);
      }, { WORKER_DATA_DIR: o.dataDir, ...(o.envFile ? { DREAMNEST_ENV_FILE: o.envFile } : {}) });
    } finally {
      // Also after a failure (e.g. the budget ceiling): what was paid is booked on the episode.
      const paid = (await spent()) - before;
      if (paid > 0) await o.db.from("dn_episodes").update({ spent_cents: ep.spent_cents + paid }).eq("id", ep.id);
    }
    return { paid_cents: (await spent()) - before };
  }

  return {
    dn_ping: async () => ({ pong: true }),
    /** Free: the concept of the first episode comes from the content folder (bible and shots, fase 1). */
    dn_concept: async (job) => {
      await setStage(job, "concept");
      const shots = JSON.parse(readFileSync(join(root, "content", "dreamnest", "shots", "fase1.json"), "utf8")) as { id: string; stage: string; description: string; characters: string[] }[];
      const story = shots.filter((s) => s.stage === "b").map((s) => ({ id: s.id, text: s.description.slice(0, 300), characters: s.characters }));
      const concept = { title: "Lumi's Cozy Fireplace Night", set: "huiskamer", characters: ["lumi", "pip", "mo"], story };
      await o.db.from("dn_episodes").update({ concept }).eq("id", job.episode_id);
      return { story: story.map((s) => s.text.split(". ")[0]).slice(0, 12) };
    },
    dn_keyframes: async (job) => {
      const ep = await episode(job);
      await setStage(job, "keyframes");
      const r = await runStep(job, ep);
      return { ...r, files: list(join(base, "keyframes", "huiskamer-01"), "keyframes/huiskamer-01", /\.(png|jpg)$/) };
    },
    dn_animate: async (job) => {
      const ep = await episode(job);
      await setStage(job, "animation");
      const r = await runStep(job, ep);
      return { ...r, files: list(join(base, "fase2", "1080p"), "fase2/1080p", /\.mp4$/) };
    },
    dn_music: async (job) => {
      const ep = await episode(job);
      await setStage(job, "music");
      const r = await runStep(job, ep);
      const qc = readJson(join(base, "fase3", "qc.json"));
      return { ...r, files: ["fase3/dreamnest-fase3-test.m4a"], qc: qc?.parts ?? null };
    },
    dn_render: async (job) => {
      const ep = await episode(job);
      await setStage(job, "rendering");
      const r = await runStep(job, ep);
      const dir = `fase4/${renderFolder(ep.duration_min)}`;
      const qc = readJson(join(base, "fase4", renderFolder(ep.duration_min), "qc.json"));
      const ok = qc?.ok === true;
      await setStage(job, ok ? "packaging" : "qc");
      return { ...r, files: [`${dir}/preview.mp4`], video: `${dir}/dreamnest-${ep.duration_min}min.mp4`, qc_ok: ok, qc_problems: qcProblems(qc) };
    },
    /** Fase 5: texts, chapters, 3 thumbnails and 3 Shorts (fase5.ts). The Studio shows them and fills the publish form. */
    dn_package: async (job) => {
      const ep = await episode(job);
      await setStage(job, "packaging");
      const r = await runStep(job, ep);
      const pkg = readJson(join(base, "fase5", `${ep.duration_min}min`, "package.json"));
      if (!pkg) throw new Error("De verpakking (package.json) is niet gemaakt");
      await setStage(job, "ready");
      const shorts = (pkg.shorts as { file: string }[] | undefined) ?? [];
      return { ...r, files: [...((pkg.thumbs as string[] | undefined) ?? []), ...shorts.map((s) => s.file)], package: pkg };
    },
    ...(o.publish ? { dn_publish: o.publish } : {}),
  };
}

export const DN_FLOW_STEPS = FLOW.map((f) => f.step);

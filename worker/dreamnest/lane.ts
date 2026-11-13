// Dreamnest lane in the worker (fase 0 skeleton). Only started with FEATURE_DREAMNEST=true.
// Own table (dn_render_jobs) and own claim function (claim_dn_job, migration 052): KIVOXEL never sees this work.
// KIVOXEL goes first: before every step (and later every render chunk) the lane checks that the KIVOXEL main lane is idle.
import type { SupabaseClient } from "@supabase/supabase-js";
import { dreamnestMayStart, type DnStep } from "../../lib/dreamnest/core.ts";

export type DnJob = { id: string; studio_id: string; episode_id: string; step: DnStep; attempts: number; max_attempts: number; payload: Record<string, unknown> | null };
export type DnHandler = (job: DnJob) => Promise<unknown>;

/** Fase 0: only a test step that does nothing, to prove the lane works end to end. Real steps come per phase. */
export const DN_HANDLERS: Partial<Record<DnStep, DnHandler>> = {
  dn_ping: async () => ({ pong: true }),
};

export function createDreamnestLane(opts: { db: SupabaseClient; workerName: string; log: (msg: string) => void; kivoxelBusy: () => boolean; handlers?: Partial<Record<DnStep, DnHandler>> }) {
  const { db, workerName, log, kivoxelBusy } = opts;
  const handlers = opts.handlers ?? DN_HANDLERS;
  let busy = false;
  let timer: NodeJS.Timeout | null = null;

  async function finish(job: DnJob, outcome: { result: unknown } | { error: string }) {
    const failed = "error" in outcome;
    const again = failed && job.attempts < job.max_attempts;
    const { error } = await db
      .from("dn_render_jobs")
      .update(
        failed
          ? { status: again ? "queued" : "failed", error: outcome.error.slice(0, 500), locked_by: null, locked_at: null, finished_at: again ? null : new Date().toISOString() }
          : { status: "done", result: outcome.result ?? {}, error: null, locked_by: null, progress: 100, finished_at: new Date().toISOString() },
      )
      .eq("id", job.id)
      .eq("locked_by", workerName);
    if (error) log(`Dreamnest: kon stap ${job.id} niet afronden: ${error.message}`);
  }

  /** After a restart: own interrupted steps back in the queue (or failed after the last attempt). */
  async function recover(): Promise<number> {
    const { data, error } = await db.from("dn_render_jobs").select("id, attempts, max_attempts").eq("status", "running").eq("locked_by", workerName).returns<{ id: string; attempts: number; max_attempts: number }[]>();
    if (error) {
      log(`Dreamnest: onderbroken stappen niet nagekeken: ${error.message}`);
      return 0;
    }
    for (const j of data ?? []) {
      const again = j.attempts < j.max_attempts;
      await db
        .from("dn_render_jobs")
        .update({ status: again ? "queued" : "failed", error: "Onderbroken: de werker is opnieuw gestart", locked_by: null, locked_at: null, finished_at: again ? null : new Date().toISOString() })
        .eq("id", j.id)
        .eq("locked_by", workerName);
    }
    return data?.length ?? 0;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        if (!dreamnestMayStart({ mainBusy: kivoxelBusy() })) return;
        const { data, error } = await db.rpc("claim_dn_job", { p_worker: workerName, p_steps: Object.keys(handlers) });
        if (error) {
          // Before migration 052 the function does not exist: stay quiet, KIVOXEL is not affected.
          if (!/claim_dn_job|does not exist|schema cache/i.test(error.message)) log(`Dreamnest-wachtrij niet bereikbaar: ${error.message}`);
          return;
        }
        const job = (data as DnJob[] | null)?.[0];
        if (!job) return;
        log(`Dreamnest: stap ${job.step} gestart (${job.id})`);
        try {
          const handler = handlers[job.step];
          if (!handler) throw new Error(`Stap ${job.step} bestaat nog niet in deze werker`);
          await finish(job, { result: await handler(job) });
          log(`Dreamnest: stap ${job.step} klaar (${job.id})`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await finish(job, { error: message });
          log(`Dreamnest: stap ${job.step} mislukt (${job.id}): ${message}`);
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    recover,
    busy: () => busy,
    start(intervalMs = 15_000) {
      void recover().then(() => tick());
      timer = setInterval(() => void tick(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

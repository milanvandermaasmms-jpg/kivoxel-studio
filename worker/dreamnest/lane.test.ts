import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDreamnestLane, type DnJob } from "./lane.ts";

function fakeDb(claims: unknown[][], rpcError: string | null = null) {
  const queue = [...claims];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    let values: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (v: Record<string, unknown>) => ((values = v), chain),
      eq: () => chain,
      returns: () => chain,
      then: (resolve: (r: unknown) => void) => {
        if (values) updates.push({ table, values });
        resolve({ data: values ? null : [], error: null });
      },
    };
    return chain;
  };
  const db = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return rpcError ? { data: null, error: { message: rpcError } } : { data: queue.shift() ?? [], error: null };
    },
  } as unknown as SupabaseClient;
  return { db, rpcs, updates };
}

const job: DnJob = { id: "d1", studio_id: "s", episode_id: "e1", step: "dn_ping", attempts: 1, max_attempts: 3, payload: null };

describe("Dreamnest lane", () => {
  it("claims only Dreamnest steps through its own function and finishes them", async () => {
    const { db, rpcs, updates } = fakeDb([[job]]);
    await createDreamnestLane({ db, workerName: "pc", log: () => {}, kivoxelBusy: () => false }).tick();
    expect(rpcs[0]).toEqual({ fn: "claim_dn_job", args: { p_worker: "pc", p_steps: ["dn_ping"] } });
    expect(rpcs.some((r) => r.fn === "claim_yt_job")).toBe(false);
    expect(updates).toEqual([{ table: "dn_render_jobs", values: expect.objectContaining({ status: "done", result: { pong: true } }) }]);
  });

  it("does not start anything while KIVOXEL is busy", async () => {
    const { db, rpcs } = fakeDb([[job]]);
    await createDreamnestLane({ db, workerName: "pc", log: () => {}, kivoxelBusy: () => true }).tick();
    expect(rpcs).toEqual([]);
  });

  it("stops between steps as soon as KIVOXEL gets work", async () => {
    let kivoxel = false;
    const { db, rpcs } = fakeDb([[job], [{ ...job, id: "d2" }]]);
    const lane = createDreamnestLane({ db, workerName: "pc", log: () => {}, kivoxelBusy: () => kivoxel, handlers: { dn_ping: async () => ((kivoxel = true), {}) } });
    await lane.tick();
    expect(rpcs).toHaveLength(1);
  });

  it("retries a failed step while attempts are left", async () => {
    const { db, updates } = fakeDb([[job]]);
    await createDreamnestLane({ db, workerName: "pc", log: () => {}, kivoxelBusy: () => false, handlers: { dn_ping: async () => Promise.reject(new Error("kapot")) } }).tick();
    expect(updates[0].values).toMatchObject({ status: "queued", error: "kapot" });
  });

  it("stays quiet before migration 052", async () => {
    const logs: string[] = [];
    const { db } = fakeDb([], "Could not find the function public.claim_dn_job in the schema cache");
    await createDreamnestLane({ db, workerName: "pc", log: (m) => logs.push(m), kivoxelBusy: () => false }).tick();
    expect(logs).toEqual([]);
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { LocalRecording } from "../lib/youtube/protocol";
import { createRegistrar } from "./register";

// A tiny stand-in for the database: one studio, unique fingerprints, unique intake steps.
function fakeDb(studios: string[]) {
  const recordings: { id: string; fingerprint: string; studio_id: string }[] = [];
  const jobs: { idempotency_key: string }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let pendingInsert: Record<string, unknown> | null = null;
    const result = () => {
      if (table === "studios") return { data: studios[0] ? { id: studios[0] } : null, error: null };
      if (table === "yt_recordings" && pendingInsert) {
        const row = pendingInsert as { fingerprint: string; studio_id: string };
        if (recordings.some((r) => r.fingerprint === row.fingerprint)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const rec = { id: `rec-${recordings.length + 1}`, fingerprint: row.fingerprint, studio_id: row.studio_id };
        recordings.push(rec);
        return { data: { id: rec.id }, error: null };
      }
      if (table === "yt_recordings") {
        const rec = recordings.find((r) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        return rec ? { data: { id: rec.id }, error: null } : { data: null, error: { code: "PGRST116", message: "not found" } };
      }
      if (table === "yt_jobs" && pendingInsert) {
        const key = String(pendingInsert.idempotency_key);
        if (jobs.some((j) => j.idempotency_key === key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        jobs.push({ idempotency_key: key });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const builder = {
      select: () => builder,
      limit: () => builder,
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      insert: (row: Record<string, unknown>) => ((pendingInsert = row), builder),
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => void) => resolve(result()),
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, recordings, jobs };
}

const rec = (fingerprint: string): LocalRecording => ({ fingerprint, sha256: null, label: "TESTDATA", originalName: "t.mp4", size: 1, isTest: false, file: "t.mp4", receivedAt: "2026-11-13T00:00:00Z", probe: null, intakeError: null });

describe("registering an inbox recording", () => {
  it("adds the recording and one intake step, also when it runs twice", async () => {
    const { db, recordings, jobs } = fakeDb(["studio-1"]);
    const register = createRegistrar(db);
    await register(rec("a".repeat(64)));
    await register(rec("a".repeat(64)));
    expect(recordings).toEqual([{ id: "rec-1", fingerprint: "a".repeat(64), studio_id: "studio-1" }]);
    expect(jobs).toEqual([{ idempotency_key: "intake:rec-1" }]);
  });

  it("explains that the studio must be made first", async () => {
    const register = createRegistrar(fakeDb([]).db);
    await expect(register(rec("b".repeat(64)))).rejects.toThrow(/nog geen studio/);
  });
});

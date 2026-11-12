import { describe, expect, it } from "vitest";
import { studioOverview, type OverviewInput } from "./actions";

const base: OverviewInput = { videos: [], scripts: [], jobs: [], settings: null, spentCents: 0, workerOnline: true, stepLabel: (s) => s };
const video = (id: string, status: string, is_test = false) => ({ id, status, is_test, format: "A" as const });
const job = (id: string, step: string, status: "queued" | "running" | "done" | "failed" | "cancelled", video_id: string | null = null) => ({ id, step, status, error: status === "failed" ? "kapot" : null, recording_id: null, video_id });

describe("studio overview", () => {
  it("is empty and has no actions when nothing is going on", () => {
    expect(studioOverview(base)).toEqual({ ready: 0, review: 0, scriptsToApprove: 0, rendering: 0, actions: [] });
  });

  it("counts real videos only; test data never needs action", () => {
    const o = studioOverview({ ...base, videos: [video("a", "approved"), video("b", "review"), video("c", "rendering"), video("t", "review", true)] });
    expect(o).toMatchObject({ ready: 1, review: 1, rendering: 1 });
    expect(o.actions.map((a) => a.key)).toEqual(["review:b"]);
  });

  it("asks for a script approval only when no version is approved", () => {
    const scripts = [
      { video_id: "a", status: "draft" as const, version: 2, top_line: "LOW HEALTH" },
      { video_id: "b", status: "draft" as const, version: 2, top_line: null },
      { video_id: "b", status: "approved" as const, version: 1, top_line: null },
    ];
    const o = studioOverview({ ...base, videos: [video("a", "scripted"), video("b", "scripted")], scripts });
    expect(o.scriptsToApprove).toBe(1);
    expect(o.actions[0].text).toContain('"LOW HEALTH"');
  });

  it("reports a failed step until a newer attempt for the same video exists", () => {
    expect(studioOverview({ ...base, jobs: [job("1", "render", "failed", "v")] }).actions[0]).toMatchObject({ key: "job:1", tone: "error" });
    expect(studioOverview({ ...base, jobs: [job("2", "render", "done", "v"), job("1", "render", "failed", "v")] }).actions).toEqual([]);
    expect(studioOverview({ ...base, jobs: [job("2", "render", "done", "w"), job("1", "render", "failed", "v")] }).actions).toHaveLength(1);
  });

  it("warns when work waits for a stopped worker, not while checking", () => {
    const jobs = [job("1", "render", "queued")];
    expect(studioOverview({ ...base, jobs, workerOnline: false }).actions[0].key).toBe("worker");
    expect(studioOverview({ ...base, jobs, workerOnline: undefined }).actions).toEqual([]);
  });

  it("warns from the warning percentage of the monthly cap", () => {
    const settings = { monthly_cap_cents: 500, warn_at_percent: 80 };
    expect(studioOverview({ ...base, settings, spentCents: 399 }).actions).toEqual([]);
    expect(studioOverview({ ...base, settings, spentCents: 400 }).actions[0]).toMatchObject({ key: "budget", tone: "warn" });
    expect(studioOverview({ ...base, settings, spentCents: 500 }).actions[0].tone).toBe("error");
  });
});

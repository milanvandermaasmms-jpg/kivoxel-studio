import { describe, expect, it } from "vitest";
import { minutes, pipelines, queueByStep, runningView, workerState } from "./productionOverview";
import type { LiveJob } from "./production";

const NOW = Date.parse("2026-11-18T09:40:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const job = (over: Partial<LiveJob>): LiveJob => ({ id: Math.random().toString(36).slice(2), step: "render", status: "queued", recording_id: null, video_id: "v1", attempts: 1, max_attempts: 3, error: null, created_at: ago(600), ...over });

describe("runningView", () => {
  it("shows the percentage, the phase, the time left and the last sign of life", () => {
    const v = runningView(job({ status: "running", progress: 0.4286, phase: "Montage in 7 delen voorbereiden", started_at: ago(300), heartbeat_at: ago(4), metrics: { eta_ms: 400_000 } }), NOW);
    expect(v).toMatchObject({ label: "Montage", pct: 42.9, phase: "Montage in 7 delen voorbereiden", etaMs: 400_000, heartbeatAgoMs: 4000, stalled: false, elapsedMs: 300_000 });
  });
  it("marks a step without a heartbeat for more than 2 minutes as stuck", () => {
    expect(runningView(job({ status: "running", heartbeat_at: ago(200) }), NOW).stalled).toBe(true);
  });
  it("has no percentage when the step does not report one", () => {
    expect(runningView(job({ status: "running", progress: null }), NOW).pct).toBeNull();
  });
});

describe("workerState", () => {
  it("says the worker is busy", () => {
    expect(workerState({ jobs: [job({ status: "running", heartbeat_at: ago(3) }), job({})], workerOnline: true, nowMs: NOW })).toMatchObject({ tone: "ok", title: "De werker is bezig" });
  });
  it("explains that uploads go first", () => {
    expect(workerState({ jobs: [job({ step: "upload", status: "running", heartbeat_at: ago(2) }), job({ step: "render" })], workerOnline: true, nowMs: NOW }).title).toBe("Eerst de uploads");
  });
  it("warns when work waits but nothing has started for a while", () => {
    expect(workerState({ jobs: [job({}), job({ status: "done", finished_at: ago(600) })], workerOnline: true, nowMs: NOW })).toMatchObject({ tone: "warn", title: "De werker staat stil" });
  });
  it("is red when a running step gives no sign of life, or when the worker is off while work waits", () => {
    expect(workerState({ jobs: [job({ status: "running", heartbeat_at: ago(400) })], workerOnline: true, nowMs: NOW }).tone).toBe("error");
    expect(workerState({ jobs: [job({})], workerOnline: false, nowMs: NOW }).title).toBe("Werker staat uit");
  });
  it("is calm when nothing waits", () => {
    expect(workerState({ jobs: [], workerOnline: true, nowMs: NOW }).title).toBe("Alles is klaar");
  });
});

describe("queueByStep and pipelines", () => {
  it("lists the queue per step, uploads first", () => {
    const q = queueByStep([job({ step: "render" }), job({ step: "render", status: "running" }), job({ step: "upload" }), job({ step: "analyse", status: "done" })]);
    expect(q.map((x) => [x.step, x.running, x.queued])).toEqual([["upload", 0, 1], ["render", 1, 1]]);
  });
  it("shows a recording from analysis to montage, and leaves finished recordings out", () => {
    const recs = [{ id: "r1", label: "17-11 v6" }, { id: "r2", label: "klaar" }];
    const vids = [
      { id: "a", recording_id: "r1", format: "A", status: "rendering" },
      { id: "b", recording_id: "r1", format: "A", status: "review" },
      { id: "c", recording_id: "r1", format: "C", status: "scripted" },
      { id: "d", recording_id: "r1", format: "A", status: "approved" },
      { id: "e", recording_id: "r2", format: "A", status: "published" },
    ];
    const p = pipelines(recs, vids, [job({ step: "analyse", recording_id: "r1", status: "done" })], NOW);
    expect(p).toEqual([expect.objectContaining({ label: "17-11 v6", analysis: "klaar", scripting: 1, montage: 1, review: 1, ready: 1, total: 4, pct: 50 })]);
  });
  it("minutes reads like a person would say it", () => {
    expect([minutes(45_000), minutes(7 * 60_000), minutes(95 * 60_000)]).toEqual(["45 s", "7 min", "1 u 35 min"]);
  });
});

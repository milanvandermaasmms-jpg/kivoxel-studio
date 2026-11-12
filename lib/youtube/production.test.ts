import { describe, expect, it } from "vitest";
import { heartbeatAge, overallProgress, pickProduction, productionSteps, shortDuration, type LiveJob } from "./production";

const job = (id: string, step: string, status: LiveJob["status"], extra: Partial<LiveJob> = {}): LiveJob => ({
  id,
  step,
  status,
  recording_id: step === "analyse" ? "r1" : null,
  video_id: step === "analyse" ? null : "v1",
  attempts: 1,
  error: null,
  created_at: `2026-11-11T22:0${id}:00Z`,
  ...extra,
});
const video = { id: "v1", recording_id: "r1", status: "rendering" };

describe("one production", () => {
  it("follows the real steps of the video", () => {
    const steps = productionSteps(video, [job("1", "analyse", "done"), job("2", "script", "done"), job("3", "render", "running", { progress: "0.4000" })]);
    expect(steps.map((s) => s.status)).toEqual(["COMPLETED", "COMPLETED", "RENDERING", "WAITING"]);
    expect(steps[2].progress).toBe(0.4);
  });

  it("uses the newest attempt of a step", () => {
    const steps = productionSteps(video, [job("1", "render", "failed"), job("2", "render", "queued")]);
    expect(steps[2].status).toBe("WAITING");
    expect(steps[2].job?.id).toBe("2");
  });

  it("shows a failed or cancelled step as failed, and review from the video status", () => {
    expect(productionSteps(video, [job("1", "render", "cancelled")])[2].status).toBe("FAILED");
    expect(productionSteps({ ...video, status: "review" }, [])[3].status).toBe("REVIEW");
    expect(productionSteps({ ...video, status: "approved" }, [])[3].status).toBe("COMPLETED");
  });

  it("counts finished steps plus only the measured part of the current step", () => {
    const steps = productionSteps(video, [job("1", "analyse", "done"), job("2", "script", "done"), job("3", "render", "running", { progress: 0.5 })]);
    expect(overallProgress(steps)).toEqual({ done: 2, total: 4, share: 0.625 });
    const unmeasured = productionSteps(video, [job("1", "analyse", "done"), job("3", "render", "running")]);
    expect(overallProgress(unmeasured).share).toBe(0.25);
  });
});

describe("live helpers", () => {
  it("opens the montage that is running first", () => {
    expect(pickProduction([job("1", "render", "done", { video_id: "a" }), job("2", "render", "running", { video_id: "b" }), job("3", "render", "queued", { video_id: "c" })])).toBe("b");
    expect(pickProduction([job("1", "render", "done", { video_id: "a" })])).toBe("a");
    expect(pickProduction([])).toBeNull();
  });

  it("measures the age of the heartbeat", () => {
    expect(heartbeatAge(job("1", "render", "running", { heartbeat_at: "2026-11-11T22:00:00Z" }), Date.parse("2026-11-11T22:00:12Z"))).toBe(12_000);
    expect(heartbeatAge(job("1", "render", "running"))).toBeNull();
  });

  it("writes durations short", () => {
    expect(shortDuration(12_000)).toBe("12 s");
    expect(shortDuration(185_000)).toBe("3 min 5 s");
    expect(shortDuration(3_900_000)).toBe("1 u 5 min");
  });
});

describe("private upload in Live (fase D3)", () => {
  const video = { id: "v1", recording_id: "r1", status: "approved" };
  it("adds the upload step only once Milan asked for it, and follows it", () => {
    expect(productionSteps(video, []).map((s) => s.key)).toEqual(["analyse", "script", "render", "review"]);
    const up = job("u1", "upload", "running", { video_id: "v1", progress: 0.5, created_at: "2026-11-12T19:00:00Z" });
    const steps = productionSteps(video, [up]);
    expect(steps.at(-1)).toMatchObject({ key: "upload", status: "UPLOADING", progress: 0.5, label: "Uploaden naar YouTube" });
    const pub = job("p1", "publish", "done", { video_id: "v1", created_at: "2026-11-12T20:00:00Z" });
    expect(productionSteps(video, [up, pub]).at(-1)).toMatchObject({ key: "upload", status: "COMPLETED", label: "Zichtbaarheid bij YouTube" });
    expect(pickProduction([job("m1", "render", "done", { video_id: "v0", created_at: "2026-11-12T10:00:00Z" }), up])).toBe("v1");
  });
});

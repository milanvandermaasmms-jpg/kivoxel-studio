import { describe, expect, it } from "vitest";
import type { AnalysisState, DbScript, DbVideo } from "./analysisData";
import { makerRecordings, makerStep } from "./maker";

type Ready = Extract<AnalysisState, { ready: true }>;
const rec = (id: string, extra: Partial<Ready["recordings"][number]> = {}) => ({ id, label: id, status: "ready", is_test: false, duration_ms: 1000, ...extra });
const video = (extra: Partial<DbVideo> = {}): DbVideo => ({ id: "v1", recording_id: "r1", format: "A", status: "idea", language: "en", promise: null, is_test: false, created_at: "2026-11-13T00:00:00Z", yt_video_moments: [], ...extra });
const script = (extra: Partial<DbScript> = {}): DbScript => ({ id: "s1", video_id: "v1", version: 1, top_line: "X", hook: "Hook", lines: [], edit_plan: [], target_ms: 18000, source: "ai", status: "draft", is_test: false, created_at: "2026-11-13T00:00:00Z", ...extra });
const state = (extra: Partial<Ready> = {}): Ready => ({ ready: true, settings: null, spentCents: 0, recordings: [rec("r1")], moments: [], videos: [], scripts: [], analyseJobs: {}, montage: { renders: [], jobs: [], voice: { voice_name: "x", speaking_rate: 1, game_volume: 0.25 }, privacy: null }, ...extra });
const moment = { id: "m1", recording_id: "r1" } as unknown as Ready["moments"][number];

describe("AI Video Maker: the next step", () => {
  it("puts real gameplay before test data", () => {
    expect(makerRecordings(state({ recordings: [rec("t", { is_test: true }), rec("r")] })).map((r) => r.id)).toEqual(["r", "t"]);
  });

  it("waits for the intake, then asks to start the analysis", () => {
    expect(makerStep(state({ recordings: [rec("r1", { status: "received" })] }), "r1", null).kind).toBe("intake");
    expect(makerStep(state(), "r1", null)).toMatchObject({ kind: "analyse", test: false });
    expect(makerStep(state({ recordings: [rec("r1", { is_test: true })] }), "r1", null)).toMatchObject({ kind: "analyse", test: true });
    expect(makerStep(state({ analyseJobs: { r1: "running" } }), "r1", null).kind).toBe("analysing");
  });

  it("asks for a format, then writes and approves the script by hand", () => {
    const s = state({ moments: [moment], videos: [video()] });
    expect(makerStep(s, "r1", null).kind).toBe("no-videos");
    expect(makerStep(s, "r1", "v1")).toMatchObject({ kind: "script", version: 1 });
    expect(makerStep({ ...s, scripts: [script()] }, "r1", "v1").kind).toBe("approve-script");
    expect(makerStep({ ...s, scripts: [script({ status: "rejected" })] }, "r1", "v1")).toMatchObject({ kind: "script", version: 2 });
  });

  it("starts the montage after approval and then sends Milan to review and publish", () => {
    const base = state({ moments: [moment], videos: [video({ status: "scripted" })], scripts: [script({ status: "approved" })] });
    expect(makerStep(base, "r1", "v1")).toMatchObject({ kind: "render", attempt: 1 });
    const busy = { ...base, montage: { ...base.montage!, jobs: [{ script_id: "s1", status: "running", error: null, created_at: "x" }] } };
    expect(makerStep(busy, "r1", "v1").kind).toBe("rendering");
    const rendered = { ...base, videos: [video({ status: "review" })], montage: { ...base.montage!, renders: [{ id: "x", video_id: "v1", script_id: "s1" } as never] } };
    expect(makerStep(rendered, "r1", "v1").kind).toBe("review");
    expect(makerStep({ ...rendered, videos: [video({ status: "approved" })] }, "r1", "v1").kind).toBe("publish");
  });
});

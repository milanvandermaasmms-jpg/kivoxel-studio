import { describe, expect, it } from "vitest";
import { pipelineSteps, reviewBlockers, reviewChecks } from "./review";

const state = (steps: ReturnType<typeof pipelineSteps>, key: string) => steps.find((s) => s.key === key)?.state;

describe("pipeline status", () => {
  it("shows worker steps as offline when the pc is not reachable", () => {
    const steps = pipelineSteps({ worker: null, paidEnabled: true, montageReady: true });
    expect(state(steps, "upload")).toBe("offline");
    expect(state(steps, "voice")).toBe("offline");
    expect(state(steps, "review")).toBe("works");
    expect(state(steps, "publish")).toBe("offline");
    expect(state(pipelineSteps({ worker: { ffmpeg: "8.0", analysis: null, voice: false, youtube: true }, paidEnabled: false, montageReady: true }), "publish")).toBe("works");
    expect(state(pipelineSteps({ worker: { ffmpeg: "8.0", analysis: null, voice: false }, paidEnabled: false, montageReady: true }), "publish")).toBe("connect");
  });

  it("needs both a key and paid processing for real analysis", () => {
    const worker = { ffmpeg: "8.0", analysis: "gemini", voice: false };
    expect(state(pipelineSteps({ worker, paidEnabled: false, montageReady: true }), "analyse")).toBe("connect");
    expect(state(pipelineSteps({ worker, paidEnabled: true, montageReady: true }), "analyse")).toBe("works");
    expect(state(pipelineSteps({ worker: { ...worker, analysis: null }, paidEnabled: true, montageReady: true }), "analyse")).toBe("connect");
  });

  it("shows the voice and montage honestly", () => {
    const steps = pipelineSteps({ worker: { ffmpeg: "8.0", analysis: null, voice: false }, paidEnabled: false, montageReady: false });
    expect(state(steps, "voice")).toBe("connect");
    expect(state(steps, "montage")).toBe("connect");
    expect(state(steps, "privacy")).toBe("connect");
    expect(state(pipelineSteps({ worker: null, paidEnabled: false, montageReady: true, privacyReady: true }), "privacy")).toBe("works");
  });
});

describe("video approval", () => {
  const ok = { approvedScriptId: "s2", latestRender: { script_id: "s2" }, renderBusy: false, privacyFlags: [] };

  it("allows approval of a montage of the approved script", () => {
    expect(reviewBlockers(ok)).toEqual([]);
  });

  it("blocks without an approved script, while rendering, without montage or with an older montage", () => {
    expect(reviewBlockers({ ...ok, approvedScriptId: null })).toHaveLength(1);
    expect(reviewBlockers({ ...ok, renderBusy: true })[0]).toMatch(/bezig/);
    expect(reviewBlockers({ ...ok, latestRender: null })[0]).toMatch(/nog geen montage/);
    expect(reviewBlockers({ ...ok, latestRender: { script_id: "s1" } })[0]).toMatch(/ander script/);
  });

  it("blocks a flagged video until the montage was made with blurring or muting", () => {
    expect(reviewBlockers({ ...ok, privacyFlags: ["gamertag"] })[0]).toMatch(/vervaagde hoeken/);
    expect(reviewBlockers({ ...ok, latestRender: { script_id: "s2", privacy_blur: true }, privacyFlags: ["chat"] })).toEqual([]);
    expect(reviewBlockers({ ...ok, latestRender: { script_id: "s2", privacy_blur: true }, privacyFlags: ["voice"] })[0]).toMatch(/gamegeluid uit/);
    expect(reviewBlockers({ ...ok, latestRender: { script_id: "s2", privacy_blur: true, game_muted: true }, privacyFlags: ["voice", "notification"] })).toEqual([]);
  });

  it("never allows a face", () => {
    expect(reviewBlockers({ ...ok, latestRender: { script_id: "s2", privacy_blur: true, game_muted: true }, privacyFlags: ["face"] })[0]).toMatch(/gezicht/);
  });

  it("tells what to check in the preview", () => {
    expect(reviewChecks([])).toEqual([]);
    expect(reviewChecks(["gamertag", "voice"])).toHaveLength(2);
  });
});

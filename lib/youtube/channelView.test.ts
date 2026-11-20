import { describe, expect, it } from "vitest";
import type { AnalysisState } from "./analysisData";
import { analysisForChannel, dbForChannel } from "./channelView";
import type { DbState } from "./studio";

// Milan, 20-11-2026: "videos van roblox & fortnite staan in kivoxel" — the KIVOXEL page showed SpawnNado's recordings.
const state = {
  ready: true,
  settings: null,
  spentCents: 0,
  recordings: [
    { id: "mc", label: "19-11 minecraft", status: "ready", is_test: false, duration_ms: 1, channel_id: "kivoxel" },
    { id: "rb", label: "20-11 roblox", status: "ready", is_test: false, duration_ms: 1, channel_id: "spawnnado" },
  ],
  moments: [{ id: "m1", recording_id: "mc" }, { id: "m2", recording_id: "rb" }],
  videos: [
    { id: "v1", recording_id: "mc", channel_id: "kivoxel" },
    { id: "v2", recording_id: "rb", channel_id: "spawnnado" },
  ],
  scripts: [{ id: "s1", video_id: "v1" }, { id: "s2", video_id: "v2" }],
  analyseJobs: { mc: "done", rb: "done" },
  montage: { renders: [{ video_id: "v1" }, { video_id: "v2" }], jobs: [{ script_id: "s1" }, { script_id: "s2" }], voice: {}, privacy: null },
} as unknown as AnalysisState;

describe("a channel's page shows only that channel", () => {
  it("KIVOXEL shows no Roblox or Fortnite, SpawnNado no Minecraft from KIVOXEL", () => {
    const k = analysisForChannel(state, "kivoxel");
    if (!k?.ready) throw new Error("not ready");
    expect(k.recordings.map((r) => r.label)).toEqual(["19-11 minecraft"]);
    expect(k.videos.map((v) => v.id)).toEqual(["v1"]);
    expect(k.moments.map((m) => m.id)).toEqual(["m1"]);
    expect(k.scripts.map((s) => s.id)).toEqual(["s1"]);
    expect(Object.keys(k.analyseJobs)).toEqual(["mc"]);
    expect(k.montage?.renders).toHaveLength(1);
    expect(k.montage?.jobs).toHaveLength(1);
    const s = analysisForChannel(state, "spawnnado");
    if (!s?.ready) throw new Error("not ready");
    expect(s.recordings.map((r) => r.label)).toEqual(["20-11 roblox"]);
  });

  it("'alle kanalen' shows everything", () => {
    expect(analysisForChannel(state, null)).toBe(state);
  });

  it("the worker queue follows the channel too", () => {
    const db = { ready: true, recordings: [{ id: "a", channel_id: "kivoxel" }, { id: "b", channel_id: "spawnnado" }], jobs: [{ id: "j1", channel_id: "spawnnado" }, { id: "j2", channel_id: "kivoxel" }] } as unknown as DbState;
    const k = dbForChannel(db, "kivoxel");
    expect(k?.ready && k.jobs.map((j) => j.id)).toEqual(["j2"]);
    expect(k?.ready && k.recordings.map((r) => r.id)).toEqual(["a"]);
    expect(dbForChannel(db, null)).toBe(db);
  });
});

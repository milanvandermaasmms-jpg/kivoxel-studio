import { describe, expect, it } from "vitest";
import type { BoardScript } from "./board";
import { buildFlow, countFlow, needsAction, placeOf, privacyOf, type FlowJob, type FlowPublication, type FlowVideo } from "./flow";

const video = (over: Partial<FlowVideo> = {}): FlowVideo => ({ id: "v1", recording_id: "r1", format: "A", status: "scripted", is_test: false, channel_id: "c1", created_at: "2026-11-13T10:00:00Z", ...over });
const script = (over: Partial<BoardScript> = {}): BoardScript => ({ id: "s1", video_id: "v1", version: 1, status: "approved", ...over });
const pub = (over: Partial<FlowPublication> = {}): FlowPublication => ({ video_id: "v1", status: "draft", visibility: "private", publish_at: null, youtube_video_id: null, title: "", error: null, ...over });
const job = (over: Partial<FlowJob> = {}): FlowJob => ({ id: "j1", recording_id: null, video_id: "v1", step: "render", status: "queued", error: null, created_at: "2026-11-13T11:00:00Z", ...over });
const flow = (v: FlowVideo, s: BoardScript[], p: FlowPublication | null = null, j: FlowJob[] = []) => placeOf(v, s, p, j).flow;

describe("one video, one place", () => {
  it("follows the life of a video", () => {
    expect(placeOf(video({ status: "idea" }), [], null, [job({ step: "script", status: "running" })])).toMatchObject({ flow: "production", sub: "script" });
    expect(placeOf(video(), [script({ status: "draft" })], null, [])).toMatchObject({ flow: "review", reviewKind: "concept" });
    expect(placeOf(video({ status: "rendering" }), [script()], null, [job({ status: "running", phase: "Voice-over maken" })])).toMatchObject({ flow: "production", sub: "voiceover" });
    expect(placeOf(video({ status: "rendering" }), [script()], null, [job({ status: "running", phase: "Video renderen" })])).toMatchObject({ flow: "production", sub: "montage" });
    expect(placeOf(video({ status: "review" }), [script()], null, [])).toMatchObject({ flow: "review", reviewKind: "final" });
    expect(flow(video({ status: "approved" }), [script()])).toBe("ready");
    expect(flow(video({ status: "approved" }), [script()], pub({ status: "uploading" }))).toBe("uploading");
    expect(flow(video({ status: "approved" }), [script()], pub({ status: "scheduled", youtube_video_id: "yt", publish_at: "2026-11-20T17:00:00Z" }))).toBe("scheduled");
    expect(flow(video({ status: "approved" }), [script()], pub({ status: "uploaded", youtube_video_id: "yt" }))).toBe("live");
  });

  it("once on YouTube, a video is live and nothing else, whatever other rows say", () => {
    // A review status left behind, an old draft script and a failed render do not pull it back.
    expect(flow(video({ status: "review", youtube_video_id: "yt" }), [script({ status: "draft", version: 2 })], null, [job({ status: "failed" })])).toBe("live");
    expect(flow(video({ status: "published" }), [], null)).toBe("live");
  });

  it("a turned-down concept without a new version is archived, out of sight", () => {
    expect(placeOf(video(), [script({ status: "rejected" })], null, [])).toMatchObject({ flow: "archived", reason: "Concept afgewezen" });
    // Sent back with a comment: a new version is being written, so it is still in production.
    expect(flow(video(), [script({ status: "rejected" })], null, [job({ step: "script", status: "queued" })])).toBe("production");
    expect(flow(video({ status: "archived" }), [script()])).toBe("archived");
  });

  it("a failed step is a failure with its reason", () => {
    expect(placeOf(video({ status: "rendering" }), [script()], null, [job({ status: "failed", error: "FFmpeg stopte" })])).toMatchObject({ flow: "failed", sub: "montage", reason: "Montage mislukt: FFmpeg stopte" });
    expect(placeOf(video({ status: "idea" }), [], null, [job({ step: "script", status: "failed" })])).toMatchObject({ flow: "failed", sub: "script" });
  });
});

describe("buildFlow", () => {
  it("sorts on creation time only, so a status change never moves a card", () => {
    const videos = [video({ id: "a", created_at: "2026-11-10T00:00:00Z" }), video({ id: "b", created_at: "2026-11-12T00:00:00Z", status: "approved" })];
    const scripts = [script({ video_id: "a" }), script({ id: "s2", video_id: "b" })];
    const before = buildFlow(videos, scripts, [], () => "t").map((i) => i.videoId);
    const after = buildFlow(videos, scripts, [pub({ video_id: "b", status: "uploading" })], () => "t").map((i) => i.videoId);
    expect(before).toEqual(["b", "a"]);
    expect(after).toEqual(before);
  });

  it("knows the place in the worker's queue", () => {
    const videos = [video({ id: "a", status: "rendering" }), video({ id: "b", status: "rendering" })];
    const scripts = [script({ video_id: "a" }), script({ id: "s2", video_id: "b" })];
    const jobs = [job({ id: "ja", video_id: "a", status: "running", progress: "0.5" }), job({ id: "jb", video_id: "b", created_at: "2026-11-13T12:00:00Z" })];
    const items = buildFlow(videos, scripts, [], () => "t", jobs);
    expect(items.find((i) => i.videoId === "a")).toMatchObject({ queuePos: 1, progress: 0.5 });
    expect(items.find((i) => i.videoId === "b")).toMatchObject({ queuePos: 2, progress: null });
  });

  it("counts per place and tells what needs Milan", () => {
    const items = buildFlow([video({ id: "a", status: "approved" }), video({ id: "b", status: "failed" }), video({ id: "c", status: "published" })], [script({ video_id: "a" })], [], () => "t");
    const c = countFlow(items);
    expect([c.ready, c.failed, c.live, c.production]).toEqual([1, 1, 1, 0]);
    expect(items.filter(needsAction).length).toBe(2);
  });
});

describe("privacyOf", () => {
  it("is private by default and shows a schedule", () => {
    expect(privacyOf(null)).toBe("private");
    expect(privacyOf(pub({ visibility: "unlisted" }))).toBe("unlisted");
    expect(privacyOf(pub({ publish_at: "2026-11-20T17:00:00Z" }))).toBe("scheduled");
    expect(privacyOf(pub({ status: "published", visibility: "public" }))).toBe("public");
  });
});

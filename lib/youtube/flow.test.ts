import { describe, expect, it } from "vitest";
import type { BoardScript, BoardVideo } from "./board";
import { buildFlow, countFlow, flowOf, privacyOf, type FlowPublication } from "./flow";

const video = (over: Partial<BoardVideo> = {}): BoardVideo => ({ id: "v1", recording_id: "r1", format: "A", status: "scripted", is_test: false, channel_id: "c1", created_at: "2026-11-13T10:00:00Z", ...over });
const script = (over: Partial<BoardScript> = {}): BoardScript => ({ id: "s1", video_id: "v1", version: 1, status: "approved", ...over });
const pub = (over: Partial<FlowPublication> = {}): FlowPublication => ({ video_id: "v1", status: "draft", visibility: "private", publish_at: null, youtube_video_id: null, title: "", error: null, ...over });

describe("flowOf", () => {
  it("follows a video through all five statuses", () => {
    expect(flowOf(video({ status: "idea" }), [], null)).toBe("production");
    expect(flowOf(video(), [script({ status: "draft" })], null)).toBe("review");
    expect(flowOf(video({ status: "rendering" }), [script()], null)).toBe("production");
    expect(flowOf(video({ status: "review" }), [script()], null)).toBe("review");
    expect(flowOf(video({ status: "approved" }), [script()], null)).toBe("ready");
    expect(flowOf(video({ status: "approved" }), [script()], pub())).toBe("ready");
    expect(flowOf(video({ status: "approved" }), [script()], pub({ status: "uploading" }))).toBe("uploading");
    expect(flowOf(video({ status: "approved" }), [script()], pub({ status: "uploaded", youtube_video_id: "yt" }))).toBe("live");
    expect(flowOf(video({ status: "published" }), [script()], pub({ status: "published", visibility: "public", youtube_video_id: "yt" }))).toBe("live");
  });

  it("keeps a failed first upload ready, but a failed visibility change live", () => {
    expect(flowOf(video({ status: "approved" }), [script()], pub({ status: "failed" }))).toBe("ready");
    expect(flowOf(video({ status: "approved" }), [script()], pub({ status: "failed", youtube_video_id: "yt" }))).toBe("live");
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

describe("buildFlow", () => {
  it("sorts on creation time only, so a status change never moves a card", () => {
    const videos = [video({ id: "a", created_at: "2026-11-10T00:00:00Z" }), video({ id: "b", created_at: "2026-11-12T00:00:00Z", status: "approved" })];
    const scripts = [script({ video_id: "a" }), script({ id: "s2", video_id: "b" })];
    const before = buildFlow(videos, scripts, [], () => "t").map((i) => i.videoId);
    const after = buildFlow(videos, scripts, [pub({ video_id: "b", status: "uploading" })], () => "t").map((i) => i.videoId);
    expect(before).toEqual(["b", "a"]);
    expect(after).toEqual(before);
  });

  it("counts per status and leaves failed videos out", () => {
    const items = buildFlow([video({ id: "a", status: "approved" }), video({ id: "b", status: "failed" })], [script({ video_id: "a" })], [], () => "t");
    expect(countFlow(items)).toEqual({ production: 0, review: 0, ready: 1, uploading: 0, live: 0 });
  });
});

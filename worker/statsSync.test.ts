import { describe, expect, it } from "vitest";
import { statusFixes } from "./statsSync.ts";

const NOW = Date.parse("2026-11-18T20:00:00Z");
const video = (id: string, status: string, privacy: string | null, scheduled: string | null = null) => ({ id, youtube_video_id: `yt_${id}`, status, privacy_status: privacy, scheduled_at: scheduled });
const pub = (video_id: string, status: string, visibility: string, publish_at: string | null = null) => ({ id: `p_${video_id}`, video_id, status, visibility, publish_at });
const st = (id: string, privacyStatus: "private" | "public" | "unlisted", publishAt: string | null = null, channelId = "UCk") => ({ videoId: `yt_${id}`, channelId, privacyStatus, publishAt, publishedAt: "2026-11-16T20:44:00Z" });

describe("statusFixes: the Studio follows YouTube", () => {
  it("a scheduled video that YouTube made public moves to Live, with public visibility", () => {
    const f = statusFixes([video("a", "published", "private")], [pub("a", "uploaded", "private")], [st("a", "public")], "UCk", NOW);
    expect(f).toEqual([{ video: { id: "a", set: { status: "published", privacy_status: "public", scheduled_at: null } }, pub: { id: "p_a", set: { status: "published", visibility: "public", publish_at: null } } }]);
  });
  it("a video planned in YouTube Studio shows as Ingepland", () => {
    const f = statusFixes([video("b", "published", "private")], [pub("b", "uploaded", "private")], [st("b", "private", "2026-11-19T20:00:00Z")], "UCk", NOW);
    expect(f[0].video?.set).toEqual({ status: "scheduled", privacy_status: "private", scheduled_at: "2026-11-19T20:00:00Z" });
    expect(f[0].pub?.set).toEqual({ status: "scheduled", visibility: "private", publish_at: "2026-11-19T20:00:00Z" });
  });
  it("nothing to do when it already matches; other channels and drafts are left alone", () => {
    expect(statusFixes([video("c", "published", "public")], [pub("c", "published", "public")], [st("c", "public")], "UCk", NOW)).toEqual([]);
    expect(statusFixes([video("d", "published", "private")], [], [st("d", "public", null, "UCother")], "UCk", NOW)).toEqual([]);
    const f = statusFixes([video("e", "published", "public")], [pub("e", "uploading", "private")], [st("e", "public")], "UCk", NOW);
    expect(f).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { chunkPlan, tiktokAuthUrl } from "./tiktok.ts";
import { isTikTokLimit, nextToSend, type TikTokItem } from "./tiktokQueue.ts";

const MB = 1024 * 1024;
const item = (o: Partial<TikTokItem>): TikTokItem => ({ videoId: "v", title: "t", file: "f", status: "wacht", publishId: null, error: null, addedAt: "2026-11-24T10:00:00Z", tryAfter: null, attempts: 0, ...o });

describe("TikTok", () => {
  it("sends a Short in one piece, a big file in pieces of 10 MB with the rest in the last", () => {
    expect(chunkPlan(30 * MB)).toEqual({ chunkSize: 30 * MB, count: 1, ranges: [{ start: 0, end: 30 * MB - 1 }] });
    const big = chunkPlan(95 * MB);
    expect(big.count).toBe(9);
    expect(big.ranges[8]).toEqual({ start: 80 * MB, end: 95 * MB - 1 });
  });

  it("asks only for reading the profile and uploading drafts, with PKCE", () => {
    const u = new URL(tiktokAuthUrl({ clientKey: "abc123def456", redirectUri: "https://kivoxel-studio.vercel.app/kivoxel/tiktok", state: "s", challenge: "c" }));
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.upload");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("sends the oldest waiting Short whose retry time has passed", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(nextToSend([item({ videoId: "a", addedAt: "2026-11-24T11:00:00Z" }), item({ videoId: "b", addedAt: "2026-11-24T09:00:00Z", tryAfter: "2026-11-24T13:00:00Z" }), item({ videoId: "c", status: "in inbox" })], now)?.videoId).toBe("a");
    expect(nextToSend([item({ status: "gepubliceerd" })], now)).toBeNull();
  });

  it("treats TikTok's daily limit as waiting, not as a failure", () => {
    expect(isTikTokLimit("TikTok gaf een fout: spam_risk_too_many_pending_share (User has too many pending shares)")).toBe(true);
    expect(isTikTokLimit("TikTok gaf een fout: rate_limit_exceeded")).toBe(true);
    expect(isTikTokLimit("TikTok gaf een fout: invalid_file_upload")).toBe(false);
  });
});

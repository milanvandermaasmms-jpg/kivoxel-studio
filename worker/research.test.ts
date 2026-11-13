import { describe, expect, it } from "vitest";
import { createResearch } from "./research.ts";

describe("reference videos from the YouTube Data API", () => {
  it("searches, reads counts and subscribers, and spends the right quota", async () => {
    const spent: string[] = [];
    const urls: string[] = [];
    const answers: Record<string, unknown> = {
      search: { items: [{ id: { videoId: "abc123def45" } }, { id: { videoId: "zzz999yyy88" } }] },
      videos: {
        items: [
          { id: "abc123def45", snippet: { title: "I survived 100 days!", description: "Wait for the end! More text.", tags: ["minecraft"], publishedAt: "2026-11-10T17:00:00Z", channelId: "UC1" }, statistics: { viewCount: "50000" }, contentDetails: { duration: "PT45S" } },
          { id: "zzz999yyy88", snippet: { title: "Long survival", channelId: "UC2" }, statistics: { viewCount: "1000" }, contentDetails: { duration: "PT12M3S" } },
        ],
      },
      channels: { items: [{ id: "UC1", statistics: { subscriberCount: "1000" } }, { id: "UC2", statistics: { hiddenSubscriberCount: true } }] },
    };
    const r = createResearch({
      yt: { accessToken: async () => "t", spend: async (c: string) => void spent.push(c) },
      fetch: (async (url: string) => {
        urls.push(url);
        const key = Object.keys(answers).find((k) => url.includes(`/${k}?`))!;
        return new Response(JSON.stringify(answers[key]), { status: 200 });
      }) as typeof fetch,
    });
    const found = await r.search("minecraft shorts", "en", Date.parse("2026-11-13T00:00:00Z"));
    expect(spent).toEqual(["search.list", "videos.list", "channels.list"]);
    expect(urls[0]).toContain("safeSearch=strict");
    expect(urls[0]).toContain("publishedAfter=2026-10-14");
    expect(found[0]).toMatchObject({ youtube_video_id: "abc123def45", is_short: true, duration_s: 45, views: 50000, subscribers: 1000, ratio: 50, hook: "Wait for the end!" });
    expect(found[1]).toMatchObject({ is_short: false, subscribers: null, ratio: null });
  });

  it("reports a YouTube error in plain words", async () => {
    const r = createResearch({ yt: { accessToken: async () => "t", spend: async () => {} }, fetch: (async () => new Response(JSON.stringify({ error: { message: "quotaExceeded" } }), { status: 403 })) as typeof fetch });
    await expect(r.search("x", "nl")).rejects.toThrow("YouTube gaf een fout bij search.list: quotaExceeded");
  });
});

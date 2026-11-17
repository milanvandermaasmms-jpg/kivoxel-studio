import { describe, expect, it } from "vitest";
import { isQuotaError, linkState, lookupVideo, parseYouTubeId, safeTitle } from "./manualLink.ts";
import { createManualLink } from "./manualLinkRoute.ts";
import type { YouTube } from "./youtube.ts";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId", () => {
  it("reads every kind of YouTube link and the bare id", () => {
    for (const s of [ID, `https://youtu.be/${ID}`, `https://www.youtube.com/watch?v=${ID}&t=3`, `youtube.com/shorts/${ID}`, `https://m.youtube.com/shorts/${ID}?feature=share`, `https://studio.youtube.com/video/${ID}/edit`, ` https://youtube.com/live/${ID} `]) {
      expect(parseYouTubeId(s)).toBe(ID);
    }
  });
  it("refuses links that are not a YouTube video", () => {
    for (const s of ["", "hallo", "https://example.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/@Kivoxel", "https://youtu.be/kort"]) expect(parseYouTubeId(s)).toBeNull();
  });
});

describe("linkState", () => {
  const now = Date.parse("2026-11-17T22:30:00Z");
  const base = { id: ID, channelId: "UC1", title: "t", publishedAt: "2026-11-17T22:00:00Z", madeForKids: false, containsSyntheticMedia: false };
  it("a private video with a moment in the future is scheduled", () => {
    const s = linkState({ ...base, privacyStatus: "private", publishAt: "2026-11-18T03:00:00Z" }, now);
    expect(s.pub).toEqual({ status: "scheduled", visibility: "private", publish_at: "2026-11-18T03:00:00Z" });
    expect(s.video.status).toBe("scheduled");
  });
  it("a public or unlisted video is live; a private one without a moment is uploaded", () => {
    expect(linkState({ ...base, privacyStatus: "public", publishAt: null }, now).pub.status).toBe("published");
    expect(linkState({ ...base, privacyStatus: "unlisted", publishAt: null }, now).pub).toMatchObject({ status: "published", visibility: "unlisted" });
    expect(linkState({ ...base, privacyStatus: "private", publishAt: null }, now).pub.status).toBe("uploaded");
  });
});

describe("quota guard", () => {
  it("recognises our own counter and YouTube's refusal", () => {
    expect(isQuotaError("YouTube-quotum voor vandaag is op (100 van 100 uploads); morgen weer")).toBe(true);
    expect(isQuotaError("YouTube-quotum of uploadlimiet voor vandaag is op; morgen weer.")).toBe(true);
    expect(isQuotaError("YouTube weigerde de upload te starten: 500")).toBe(false);
  });
  it("keeps titles within YouTube's rules", () => {
    expect(safeTitle("<b>x</b>".padEnd(150, "y"))).toHaveLength(100);
  });
});

describe("lookupVideo", () => {
  it("reads channel, visibility and the scheduled moment", async () => {
    const http = (async () => new Response(JSON.stringify({ items: [{ id: ID, snippet: { channelId: "UC1", title: "Hidden TNT Trap", publishedAt: "2026-11-17T22:00:00Z" }, status: { privacyStatus: "private", publishAt: "2026-11-18T03:00:00Z", madeForKids: false } }] }))) as unknown as typeof fetch;
    expect(await lookupVideo("tok", ID, http)).toMatchObject({ channelId: "UC1", title: "Hidden TNT Trap", privacyStatus: "private", publishAt: "2026-11-18T03:00:00Z" });
  });
  it("gives null when YouTube does not know the video", async () => {
    const http = (async () => new Response(JSON.stringify({ items: [] }))) as unknown as typeof fetch;
    expect(await lookupVideo("tok", ID, http)).toBeNull();
  });
});

// A tiny fake of the Supabase calls the link makes: enough to see what is written.
function fakeDb(video: Record<string, unknown>, channel: Record<string, unknown>, existingPub: Record<string, unknown> | null = null, otherPub = false) {
  const writes: { table: string; op: string; values: unknown }[] = [];
  const db = {
    from(table: string) {
      let op = "select";
      let values: unknown = null;
      const q: Record<string, unknown> = {};
      const result = () => {
        if (op !== "select") return { data: null, error: null };
        if (table === "yt_videos") return { data: video, error: null };
        if (table === "yt_channels") return { data: channel, error: null };
        if (table === "yt_publications") return otherPub ? { data: [{ video_id: "x" }], error: null } : { data: q.limited ? [] : existingPub, error: null };
        return { data: null, error: null };
      };
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        neq: () => q,
        in: () => q,
        limit: () => ((q.limited = true), q),
        returns: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve(result()),
        update: (v: unknown) => ((op = "update"), (values = v), writes.push({ table, op, values }), q),
        insert: (v: unknown) => ((op = "insert"), (values = v), writes.push({ table, op, values }), Promise.resolve({ error: null })),
        then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
      });
      return q;
    },
  };
  return { db, writes };
}
const yt = { spend: async () => {}, accessToken: async () => "tok" } as unknown as YouTube;
const scheduled = (async () => new Response(JSON.stringify({ items: [{ id: ID, snippet: { channelId: "UC1", title: "Hidden TNT Trap Goes Off Instantly!" }, status: { privacyStatus: "private", publishAt: "2026-11-18T03:00:00Z" } }] }))) as unknown as typeof fetch;

describe("createManualLink", () => {
  const video = { id: "v1", studio_id: "s1", channel_id: "c1", status: "approved", youtube_video_id: null };
  const channel = { id: "c1", name: "KIVOXEL", youtube_channel_id: "UC1" };

  it("links a scheduled video, writes publication and video, and closes the queued upload", async () => {
    const { db, writes } = fakeDb(video, channel);
    const link = createManualLink({ db: db as never, youtubeFor: async () => yt, log: () => {}, now: () => Date.parse("2026-11-17T22:30:00Z"), http: scheduled });
    const r = await link("v1", `https://youtube.com/shorts/${ID}`);
    expect(r).toMatchObject({ youtubeVideoId: ID, status: "scheduled", publishAt: "2026-11-18T03:00:00Z" });
    expect(writes.find((w) => w.table === "yt_publications")).toMatchObject({ op: "insert", values: { youtube_video_id: ID, status: "scheduled", visibility: "private" } });
    expect(writes.find((w) => w.table === "yt_videos")?.values).toMatchObject({ youtube_video_id: ID, status: "scheduled" });
    expect(writes.find((w) => w.table === "yt_jobs")?.values).toMatchObject({ status: "cancelled" });
  });

  it("refuses a video from another YouTube channel, a bad link and an unapproved video", async () => {
    const other = fakeDb(video, { ...channel, youtube_channel_id: "UC2" });
    await expect(createManualLink({ db: other.db as never, youtubeFor: async () => yt, log: () => {}, http: scheduled })("v1", ID)).rejects.toThrow(/ander YouTube-kanaal/);
    expect(other.writes).toHaveLength(0);
    await expect(createManualLink({ db: fakeDb(video, channel).db as never, youtubeFor: async () => yt, log: () => {}, http: scheduled })("v1", "geen link")).rejects.toThrow(/geen YouTube-link/);
    await expect(createManualLink({ db: fakeDb({ ...video, status: "review" }, channel).db as never, youtubeFor: async () => yt, log: () => {}, http: scheduled })("v1", ID)).rejects.toThrow(/Keur de video eerst goed/);
  });

  it("never links one YouTube video to two Studio videos", async () => {
    const { db, writes } = fakeDb(video, channel, null, true);
    await expect(createManualLink({ db: db as never, youtubeFor: async () => yt, log: () => {}, http: scheduled })("v1", ID)).rejects.toThrow(/al aan een andere video/);
    expect(writes).toHaveLength(0);
  });
});

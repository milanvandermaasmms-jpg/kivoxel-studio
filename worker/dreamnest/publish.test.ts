import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { YouTube } from "../youtube.ts";
import { createUploader } from "../youtubeUpload.ts";
import type { DnJob } from "./lane.ts";
import { createDnPublish, type Publication } from "./publish.ts";

const DN = "UCR7om7XJ6YawyHouGFDA0MA";
const NOW = Date.parse("2026-11-14T12:00:00Z");

function fakeDb(rows: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let values: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (v: Record<string, unknown>) => ((values = v), chain),
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (r: unknown) => void) => {
        if (values && table === "dn_publications") updates.push(values);
        resolve(values ? { data: null, error: null } : { data: rows[table] ?? null, error: null });
      },
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup(over: Partial<Publication> = {}, o: { live?: string; qc?: boolean; thumbFails?: boolean } = {}) {
  dir = await mkdtemp(join(tmpdir(), "dn-pub-"));
  await mkdir(join(dir, "dreamnest", "fase4", "60min"), { recursive: true });
  await mkdir(join(dir, "dreamnest", "fase5", "60min", "thumbs"), { recursive: true });
  await writeFile(join(dir, "dreamnest", "fase4", "60min", "dreamnest-60min.mp4"), "video");
  await writeFile(join(dir, "dreamnest", "fase5", "60min", "thumbs", "thumb-1.jpg"), "jpg");
  const pub: Publication = { id: "p1", episode_id: "e1", channel_id: "c-dn", kind: "long", file: "fase4/60min/dreamnest-60min.mp4", thumbnail: "fase5/60min/thumbs/thumb-1.jpg", title: "Lumi's Cozy Fireplace Night", description: "Calm", tags: ["lullaby"], publish_at: "2026-11-16T18:00:00.000Z", status: "queued", youtube_video_id: null, ...over };
  const { db, updates } = fakeDb({ dn_publications: pub, yt_channels: { name: "Dreamnest NL", youtube_channel_id: DN }, dn_render_jobs: { result: { qc_ok: o.qc ?? true } } });
  const calls: { what: string; arg?: unknown }[] = [];
  const yt = { myChannel: async () => ({ id: o.live ?? DN, title: o.live ? "Kivoxel" : "DreamNest", thumbnail: null }) } as unknown as YouTube;
  const handler = createDnPublish({
    db,
    dataDir: dir,
    log: () => {},
    now: () => NOW,
    youtubeFor: async () => yt,
    makeUploader: () => ({
      upload: async (a) => (calls.push({ what: "upload", arg: a.meta }), a.onProgress(1, 1), { videoId: "dnvideo1234", resumed: false, adopted: false, bytes: 5 }),
      setThumbnail: async () => {
        calls.push({ what: "thumbnail" });
        if (o.thumbFails) throw new Error("niet geverifieerd");
      },
      addToPlaylist: async (_v, title) => (calls.push({ what: "playlist", arg: title }), "PL1"),
    }),
  });
  const job: DnJob = { id: "j1", studio_id: "s", episode_id: "e1", step: "dn_publish", attempts: 1, max_attempts: 3, payload: { publication_id: "p1" } };
  return { run: () => handler(job), calls, updates };
}

describe("publishing to the Dreamnest channel (fase 5)", () => {
  it("uploads private and scheduled, always Made for Kids with the AI label, then thumbnail and playlist", async () => {
    const s = await setup();
    await s.run();
    const meta = s.calls.find((c) => c.what === "upload")!.arg as Record<string, unknown>;
    expect(meta).toMatchObject({ made_for_kids: true, contains_synthetic_media: true, visibility: "private", publish_at: "2026-11-16T18:00:00.000Z", language: "en" });
    expect(s.calls.map((c) => c.what)).toEqual(["upload", "thumbnail", "playlist"]);
    expect(s.calls.at(-1)!.arg).toBe("DreamNest | Magical Sleep Worlds");
    expect(s.updates.at(-1)).toEqual({ status: "scheduled", error: null });
    expect(s.updates).toContainEqual({ youtube_video_id: "dnvideo1234", youtube_channel_id: DN, progress: 100 });
  });

  it("never uploads when YouTube says the sign-in writes to another channel", async () => {
    const s = await setup({}, { live: "UC6zZPLDaBan9Jr8WpEhbdwA" });
    await expect(s.run()).rejects.toThrow(/schrijft naar "Kivoxel"/);
    expect(s.calls).toEqual([]);
    expect(s.updates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("never publishes the long video without QC ✅", async () => {
    const s = await setup({}, { qc: false });
    await expect(s.run()).rejects.toThrow(/QC/);
    expect(s.calls).toEqual([]);
  });

  it("never uploads twice, and only what Milan queued", async () => {
    const done = await setup({ youtube_video_id: "already1234", status: "scheduled" });
    expect(await done.run()).toMatchObject({ already: true });
    expect(done.calls).toEqual([]);
    const draft = await setup({ status: "draft" });
    await expect(draft.run()).rejects.toThrow(/niet klaar/);
    expect(draft.calls).toEqual([]);
  });

  it("refuses a moment less than an hour ahead", async () => {
    const s = await setup({ publish_at: "2026-11-14T12:20:00.000Z" });
    await expect(s.run()).rejects.toThrow(/uur/);
    expect(s.calls).toEqual([]);
  });

  it("a thumbnail problem does not undo the upload; it is shown", async () => {
    const s = await setup({}, { thumbFails: true });
    await s.run();
    expect(s.updates.at(-1)).toMatchObject({ status: "scheduled", error: "Thumbnail: niet geverifieerd" });
  });
});

describe("playlist", () => {
  const fakeYt = { accessToken: async () => "a", spend: async () => {} } as unknown as YouTube;
  it("uses the playlist with that title, or makes it once", async () => {
    const seen: string[] = [];
    let exists = false;
    const fetchFake = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      seen.push(`${init?.method ?? "GET"} ${u.split("?")[0].split("/").pop()}`);
      if (u.includes("/playlists?part=snippet&mine")) return new Response(JSON.stringify({ items: exists ? [{ id: "PLold", snippet: { title: "DreamNest | Magical Sleep Worlds" } }] : [] }));
      if (u.includes("/playlists?part=snippet,status")) return new Response(JSON.stringify({ id: "PLnew" }));
      return new Response(JSON.stringify({ id: "item" }));
    }) as typeof fetch;
    const up = createUploader({ yt: fakeYt, sessionDir: tmpdir(), fetch: fetchFake });
    expect(await up.addToPlaylist("v1", "DreamNest | Magical Sleep Worlds")).toBe("PLnew");
    expect(seen).toEqual(["GET playlists", "POST playlists", "POST playlistItems"]);
    seen.length = 0;
    exists = true;
    expect(await up.addToPlaylist("v1", "DreamNest | Magical Sleep Worlds")).toBe("PLold");
    expect(seen).toEqual(["GET playlists", "POST playlistItems"]);
  });
});

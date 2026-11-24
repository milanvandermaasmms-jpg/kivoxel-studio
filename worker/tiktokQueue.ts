// 24-11-2026: the TikTok send line on this pc (<data>/tiktok/queue.json, no migration). Every Short that goes to YouTube
// after TikTok was connected joins it by itself; Milan can also add a Short by hand. One at a time, to Milan's TikTok
// inbox as a draft; a refusal (TikTok's daily limit) is tried again an hour later, at most 3 times.
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TikTok } from "./tiktok.ts";
import { tiktokCaption } from "../lib/kivoxel/tiktokCaption.ts";

/** caption: the English text with hashtags Milan pastes in the TikTok app ("Kopieer TikTok-tekst"). */
export type TikTokItem = { videoId: string; title: string; caption?: string; file: string; status: "wacht" | "bezig" | "in inbox" | "gepubliceerd" | "mislukt"; publishId: string | null; error: string | null; addedAt: string; tryAfter: string | null; attempts: number };
/** known: the Shorts that were already on YouTube when TikTok was connected; they only go by hand ("Naar TikTok"). */
export type TikTokQueueFile = { enabledAt: string | null; known?: string[]; items: TikTokItem[] };
const RETRY_MS = 3_600_000;

/** TikTok's own limit (a few drafts per day, or too many requests): wait and try again, it is no failure. Pure, tested. */
export function isTikTokLimit(message: string) {
  return /spam_risk|rate_limit|too_many|reached_active_user_cap|429/i.test(message);
}

/** The next item to send: the oldest waiting one whose retry time has passed. Pure, tested. */
export function nextToSend(items: TikTokItem[], now = Date.now()): TikTokItem | null {
  return items.filter((i) => i.status === "wacht" && (!i.tryAfter || Date.parse(i.tryAfter) <= now)).sort((a, b) => a.addedAt.localeCompare(b.addedAt))[0] ?? null;
}

export function createTikTokQueue(o: { db: SupabaseClient; dataDir: string; rendersDir: string; tiktok: TikTok; log: (m: string) => void }) {
  const file = join(o.dataDir, "tiktok", "queue.json");
  let busy = false;
  async function read(): Promise<TikTokQueueFile> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as TikTokQueueFile;
    } catch {
      return { enabledAt: null, items: [] };
    }
  }
  async function write(q: TikTokQueueFile) {
    await mkdir(join(o.dataDir, "tiktok"), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(q, null, 1));
    await rename(`${file}.tmp`, file);
  }

  const exists = (f: string) => access(f).then(() => true, () => false);
  /** The TikTok account is @kivoxel: only the KIVOXEL channel's Shorts go there (not SpawnNado or Dreamnest). */
  let kivoxelChannel: string | null = null;
  async function channelId() {
    if (!kivoxelChannel) kivoxelChannel = (await o.db.from("yt_channels").select("id").eq("is_default", true).maybeSingle<{ id: string }>()).data?.id ?? null;
    return kivoxelChannel;
  }

  /** Newest export and first title of a video; null when it is no KIVOXEL Short or has no export. */
  async function videoInfo(videoId: string): Promise<{ title: string; caption: string; file: string } | null> {
    const v = await o.db.from("yt_videos").select("format, promise, channel_id").eq("id", videoId).maybeSingle<{ format: string; promise: string | null; channel_id: string | null }>();
    const kx = await channelId();
    if (!v.data || v.data.format === "C" || (kx && v.data.channel_id !== kx)) return null;
    const r = await o.db.from("yt_renders").select("file_name").eq("video_id", videoId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ file_name: string }>();
    if (!r.data) return null;
    const s = await o.db.from("yt_scripts").select("titles").eq("video_id", videoId).order("version", { ascending: false }).limit(1).maybeSingle<{ titles: string[] | null }>();
    const p = await o.db.from("yt_publications").select("title, tags").eq("video_id", videoId).maybeSingle<{ title: string; tags: string[] | null }>();
    const titles = [p.data?.title, ...(s.data?.titles ?? []), v.data.promise];
    return { title: p.data?.title || s.data?.titles?.[0] || v.data.promise || "Short", caption: tiktokCaption(titles, p.data?.tags ?? []), file: join(o.rendersDir, r.data.file_name) };
  }

  async function add(videoId: string): Promise<TikTokItem> {
    const q = await read();
    const have = q.items.find((i) => i.videoId === videoId && i.status !== "mislukt");
    if (have) return have;
    const info = await videoInfo(videoId);
    if (!info) throw new Error("Alleen een KIVOXEL-Short met een montage kan naar TikTok");
    if (!(await exists(info.file))) throw new Error("Het videobestand van deze Short staat niet meer op de pc");
    const item: TikTokItem = { videoId, title: info.title, caption: info.caption, file: info.file, status: "wacht", publishId: null, error: null, addedAt: new Date().toISOString(), tryAfter: null, attempts: 0 };
    q.items = [...q.items.filter((i) => i.videoId !== videoId), item];
    await write(q);
    return item;
  }

  /** Shorts that went to YouTube after TikTok was connected join the line by themselves. */
  async function collect() {
    let q = await read();
    if (!q.enabledAt) return;
    if (!q.known) {
      // Connected before this list existed: everything that was on YouTube before connecting counts as old.
      const old = await o.db.from("yt_publications").select("video_id").not("youtube_video_id", "is", null).lt("updated_at", q.enabledAt).limit(2000).returns<{ video_id: string }[]>();
      if (old.error) return;
      q = { ...q, known: (old.data ?? []).map((p) => p.video_id) };
      await write(q);
    }
    const known = new Set(q.known);
    // An update to an old publication (stats, captions) changes updated_at, so the known list is what keeps old Shorts out.
    const pubs = await o.db.from("yt_publications").select("video_id, updated_at").not("youtube_video_id", "is", null).gte("updated_at", q.enabledAt).limit(200).returns<{ video_id: string; updated_at: string }[]>();
    for (const p of pubs.data ?? []) if (!known.has(p.video_id) && !q.items.some((i) => i.videoId === p.video_id)) await add(p.video_id).catch(() => undefined);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!(await o.tiktok.status()).connected) return;
      await collect();
      const q = await read();
      // Shorts that joined before the caption existed get it now (once).
      for (const i of q.items.filter((x) => !x.caption)) {
        const info = await videoInfo(i.videoId).catch(() => null);
        if (info) Object.assign(i, { caption: info.caption, title: info.title });
      }
      // Follow what is in the inbox: once Milan published it in the TikTok app, it says so.
      for (const i of q.items.filter((x) => x.status === "in inbox" && x.publishId)) {
        const s = await o.tiktok.publishStatus(i.publishId!).catch(() => null);
        if (s?.status === "PUBLISH_COMPLETE") i.status = "gepubliceerd";
        else if (s?.status === "FAILED") Object.assign(i, { status: "mislukt", error: s.reason ?? "TikTok meldde een fout" });
      }
      const next = nextToSend(q.items);
      if (next) {
        next.status = "bezig";
        await write(q);
        try {
          next.publishId = await o.tiktok.toInbox(next.file);
          next.status = "in inbox";
          next.error = null;
          o.log(`TikTok: "${next.title}" staat als concept in de TikTok-inbox`);
        } catch (e) {
          next.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          // TikTok's daily limit is no failure: the Short simply waits its turn.
          if (!isTikTokLimit(next.error)) next.attempts += 1;
          next.status = next.attempts >= 3 ? "mislukt" : "wacht";
          next.tryAfter = new Date(Date.now() + RETRY_MS).toISOString();
          o.log(`TikTok: "${next.title}" niet verstuurd: ${next.error}`);
        }
      }
      await write(q);
    } finally {
      busy = false;
    }
  }

  /**
   * The KIVOXEL Shorts whose export is still on this pc and that Milan approved (ready, scheduled or live). Not the ones
   * still to judge or archived. This is what "Naar TikTok" can send.
   */
  async function sendable(): Promise<string[]> {
    const kx = await channelId();
    if (!kx) return [];
    const v = await o.db.from("yt_videos").select("id").eq("channel_id", kx).neq("format", "C").in("status", ["approved", "scheduled", "published"]).limit(2000).returns<{ id: string }[]>();
    const ids = (v.data ?? []).map((x) => x.id);
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const r = await o.db.from("yt_renders").select("video_id, file_name, created_at").in("video_id", ids.slice(i, i + 200)).order("created_at", { ascending: false }).returns<{ video_id: string; file_name: string }[]>();
      const newest = new Map<string, string>();
      for (const x of r.data ?? []) if (!newest.has(x.video_id)) newest.set(x.video_id, x.file_name);
      for (const [id, f] of newest) if (await exists(join(o.rendersDir, f))) out.push(id);
    }
    return out;
  }

  return {
    read,
    add,
    sendable,
    /** Every Short that can go (see sendable) and is not in the line yet joins it. */
    async addAll() {
      const q = await read();
      let added = 0;
      for (const id of await sendable()) {
        if (q.items.some((i) => i.videoId === id && i.status !== "mislukt")) continue;
        await add(id).then(() => (added += 1)).catch(() => undefined);
      }
      return { added };
    },
    tick,
    /** From this moment on, every new Short for YouTube also goes to TikTok. */
    async enable() {
      const q = await read();
      if (q.enabledAt) return;
      const old = await o.db.from("yt_publications").select("video_id").not("youtube_video_id", "is", null).limit(2000).returns<{ video_id: string }[]>();
      await write({ ...q, enabledAt: new Date().toISOString(), known: old.error ? undefined : (old.data ?? []).map((p) => p.video_id) });
    },
  };
}
export type TikTokQueue = ReturnType<typeof createTikTokQueue>;

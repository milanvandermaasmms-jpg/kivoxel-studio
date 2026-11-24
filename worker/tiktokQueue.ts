// 24-11-2026: the TikTok send line on this pc (<data>/tiktok/queue.json, no migration). Every Short that goes to YouTube
// after TikTok was connected joins it by itself; Milan can also add a Short by hand. One at a time, to Milan's TikTok
// inbox as a draft; a refusal (TikTok's daily limit) is tried again an hour later, at most 3 times.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TikTok } from "./tiktok.ts";

export type TikTokItem = { videoId: string; title: string; file: string; status: "wacht" | "bezig" | "in inbox" | "gepubliceerd" | "mislukt"; publishId: string | null; error: string | null; addedAt: string; tryAfter: string | null; attempts: number };
export type TikTokQueueFile = { enabledAt: string | null; items: TikTokItem[] };
const RETRY_MS = 3_600_000;

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

  /** Newest export and first title of a video; null when it is no Short or has no export. */
  async function videoInfo(videoId: string): Promise<{ title: string; file: string } | null> {
    const v = await o.db.from("yt_videos").select("format, promise").eq("id", videoId).maybeSingle<{ format: string; promise: string | null }>();
    if (!v.data || v.data.format === "C") return null;
    const r = await o.db.from("yt_renders").select("file_name").eq("video_id", videoId).order("created_at", { ascending: false }).limit(1).maybeSingle<{ file_name: string }>();
    if (!r.data) return null;
    const s = await o.db.from("yt_scripts").select("titles").eq("video_id", videoId).order("version", { ascending: false }).limit(1).maybeSingle<{ titles: string[] | null }>();
    return { title: s.data?.titles?.[0] ?? v.data.promise ?? "Short", file: join(o.rendersDir, r.data.file_name) };
  }

  async function add(videoId: string): Promise<TikTokItem> {
    const q = await read();
    const have = q.items.find((i) => i.videoId === videoId && i.status !== "mislukt");
    if (have) return have;
    const info = await videoInfo(videoId);
    if (!info) throw new Error("Alleen een Short met een montage kan naar TikTok");
    const item: TikTokItem = { videoId, title: info.title, file: info.file, status: "wacht", publishId: null, error: null, addedAt: new Date().toISOString(), tryAfter: null, attempts: 0 };
    q.items = [...q.items.filter((i) => i.videoId !== videoId), item];
    await write(q);
    return item;
  }

  /** Shorts that went to YouTube after TikTok was connected join the line by themselves. */
  async function collect() {
    const q = await read();
    if (!q.enabledAt) return;
    const pubs = await o.db.from("yt_publications").select("video_id, updated_at").not("youtube_video_id", "is", null).gte("updated_at", q.enabledAt).limit(200).returns<{ video_id: string; updated_at: string }[]>();
    for (const p of pubs.data ?? []) if (!q.items.some((i) => i.videoId === p.video_id)) await add(p.video_id).catch(() => undefined);
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!(await o.tiktok.status()).connected) return;
      await collect();
      const q = await read();
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
          next.attempts += 1;
          next.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
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

  return {
    read,
    add,
    tick,
    /** From this moment on, every new Short for YouTube also goes to TikTok. */
    async enable() {
      const q = await read();
      if (!q.enabledAt) await write({ ...q, enabledAt: new Date().toISOString() });
    },
  };
}
export type TikTokQueue = ReturnType<typeof createTikTokQueue>;

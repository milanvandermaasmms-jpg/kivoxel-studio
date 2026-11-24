// 24-11-2026 (opdracht 4): Ivar's learning cycle on this pc. Every 6 hours (and on request) the lessons are built again
// from Milan's decisions in the database, stored in <data>/ivar/lessons.json with a version history, and handed to the
// production (which kinds of moments become a Short, how long the outcome stays, the default audio). Milan can switch a
// lesson off; that choice is kept across rebuilds.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { activeFor, deriveLessons, diffLessons, type LearnAudio, type LearnFeedback, type LearnVideo, type Lesson } from "../lib/ivar/learningCycle.ts";
import { GAMING_SET } from "../lib/kivoxel/audioOptions.ts";
import type { FeedbackItem } from "../lib/youtube/reviewFeedback.ts";

export type LessonFile = { version: number; builtAt: string | null; lessons: Lesson[]; off: string[]; history: { version: number; at: string; changes: string[] }[]; applied: Record<string, number> };
const EMPTY: LessonFile = { version: 0, builtAt: null, lessons: [], off: [], history: [], applied: {} };
const EVERY_MS = 6 * 3_600_000;

export function createIvarLearning(o: { db: SupabaseClient; dataDir: string; log: (m: string) => void }) {
  const file = join(o.dataDir, "ivar", "lessons.json");
  let busy: Promise<LessonFile> | null = null;
  let lastRun = 0;

  async function read(): Promise<LessonFile> {
    try {
      return { ...EMPTY, ...(JSON.parse(await readFile(file, "utf8")) as LessonFile) };
    } catch {
      return { ...EMPTY };
    }
  }
  async function write(f: LessonFile) {
    await mkdir(join(o.dataDir, "ivar"), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(f, null, 1));
    await rename(`${file}.tmp`, file);
  }

  async function gather(): Promise<{ videos: LearnVideo[]; feedback: LearnFeedback[]; audio: LearnAudio[] }> {
    type V = { id: string; channel_id: string | null; status: string; review_note: string | null; format: string; yt_video_moments: { yt_moments: { kind: string } | null }[] };
    const videos: LearnVideo[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const r = await o.db.from("yt_videos").select("id, channel_id, status, review_note, format, yt_video_moments(yt_moments(kind))").eq("is_test", false).range(from, from + 999).returns<V[]>();
      if (r.error) throw new Error(r.error.message);
      for (const v of r.data ?? []) videos.push({ id: v.id, channelId: v.channel_id, status: v.status, note: v.review_note, format: v.format, momentKind: v.yt_video_moments?.map((m) => m.yt_moments?.kind).find(Boolean) ?? null });
      if ((r.data ?? []).length < 1000) break;
    }
    const chanOf = new Map(videos.map((v) => [v.id, v.channelId]));
    const jobs = await o.db.from("yt_jobs").select("video_id, payload").in("step", ["render", "script"]).not("payload->feedback", "is", null).limit(2000).returns<{ video_id: string | null; payload: { feedback?: FeedbackItem[] } | null }[]>();
    if (jobs.error) throw new Error(jobs.error.message);
    const feedback: LearnFeedback[] = (jobs.data ?? []).filter((j) => j.video_id && Array.isArray(j.payload?.feedback)).map((j) => ({ videoId: j.video_id!, channelId: chanOf.get(j.video_id!) ?? null, kinds: (j.payload!.feedback ?? []).map((i) => i.kind) }));
    const ev = await o.db.from("studio_events").select("channel_id, metadata").eq("action", "audio_keuze").limit(2000).returns<{ channel_id: string | null; metadata: { music?: string; sfx?: string } }[]>();
    if (ev.error) throw new Error(ev.error.message);
    const pickOf = (m?: string) => (m === "geen" ? "none" : m && m in GAMING_SET.music ? GAMING_SET.music[m as "A" | "B" | "C"].pick : null);
    const audio: LearnAudio[] = (ev.data ?? []).map((e) => ({ channelId: e.channel_id, music: pickOf(e.metadata?.music), sfx: e.metadata?.sfx ?? null }));
    return { videos, feedback, audio };
  }

  async function rebuild(): Promise<LessonFile> {
    if (busy) return busy;
    busy = (async () => {
      const before = await read();
      const lessons = deriveLessons(await gather());
      const changes = diffLessons(before.lessons, lessons);
      const at = new Date().toISOString();
      const next: LessonFile = { ...before, lessons, builtAt: at, version: changes.length ? before.version + 1 : before.version, history: changes.length ? [{ version: before.version + 1, at, changes }, ...before.history].slice(0, 50) : before.history };
      await write(next);
      lastRun = Date.now();
      if (changes.length) o.log(`Ivar leerde (versie ${next.version}): ${changes.join("; ")}`.slice(0, 500));
      return next;
    })().finally(() => (busy = null));
    return busy;
  }

  return {
    get: read,
    rebuild,
    /** Rebuild when the last build is older than 6 hours (called from the worker's own rounds). */
    async tick() {
      if (Date.now() - lastRun > EVERY_MS) await rebuild().catch((e) => o.log(`Ivar-lessen niet bijgewerkt: ${e instanceof Error ? e.message : String(e)}`));
    },
    async setOff(id: string, off: boolean) {
      const f = await read();
      const set = new Set(f.off);
      if (off) set.add(id);
      else set.delete(id);
      const at = new Date().toISOString();
      const title = f.lessons.find((l) => l.id === id)?.title ?? id;
      const next = { ...f, off: [...set], version: f.version + 1, history: [{ version: f.version + 1, at, changes: [`${off ? "Uitgezet door Milan" : "Weer aangezet door Milan"}: ${title}`] }, ...f.history].slice(0, 50) };
      await write(next);
      return next;
    },
    /** The active lessons of a channel, for the production. */
    async active(channelId: string | null): Promise<Lesson[]> {
      const f = await read();
      return activeFor(f.lessons, channelId, f.off);
    },
    /** Counts how often each lesson was applied to a production (the proof that it is used). */
    async applied(ids: string[]) {
      if (!ids.length) return;
      const f = await read();
      for (const id of ids) f.applied[id] = (f.applied[id] ?? 0) + 1;
      await write(f);
    },
  };
}
export type IvarLearning = ReturnType<typeof createIvarLearning>;

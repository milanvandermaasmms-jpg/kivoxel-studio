// 23-11-2026 (Milan, superprompt V5, fase 4-6): builds the content register on this pc. Reads every production of the
// gaming channels from Supabase (versions, scripts, checks, publications, YouTube stats), measures the newest export of
// each one with FFmpeg (black, frozen, silence, peaks, motion; cached per file so nothing is measured twice) and scores
// it with lib/kivoxel/contentRegister.ts. No AI, no costs. Changes nothing: it only writes <data>/register/register.json.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assess, summarize, type Entry, type Facts, type Register } from "../lib/kivoxel/contentRegister.ts";
import type { ExportMeasure } from "../lib/kivoxel/editorReview.ts";
import { profileFor } from "../lib/youtube/gameProfile.ts";
import { gameplayShareOf } from "../lib/kivoxel/events.ts";
import { HUD_VERSION, type VisualSignals } from "../lib/kivoxel/visual.ts";
import { measureExport } from "./editorMeasure.ts";

type Video = { id: string; status: string; format: "A" | "B" | "C"; channel_id: string | null; recording_id: string | null; review_note: string | null; created_at: string; promise: string | null };
type Render = { video_id: string; script_id: string; file_name: string; duration_ms: number; width: number; height: number; voice_name: string | null; qc: { items?: { key?: string; level?: string }[] } | null; created_at: string };
type Script = { id: string; video_id: string; version: number; top_line: string | null; hook: string; lines: { at_ms: number; text: string }[] | null; titles?: string[] | null; edit_plan: { part?: string; out_start_ms: number; src_start_ms: number; src_end_ms: number; speed?: number; effects?: string[] }[] | null };

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await q(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
    if (!r.data || r.data.length < 1000) return out;
  }
}

export function createContentRegister(opts: { db: SupabaseClient; ffmpeg: string; dataDir: string; rendersDir: string; log: (m: string) => void; /** 23-11-2026: measure a recording's picture signals again (newest HUD recognition); null when it is not on the pc. */ visual?: (fingerprint: string) => Promise<VisualSignals | null> }) {
  const dir = join(opts.dataDir, "register");
  const file = join(dir, "register.json");
  let running: { done: number; total: number } | null = null;

  async function measured(name: string, durationMs: number): Promise<ExportMeasure | null> {
    const path = join(opts.rendersDir, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    const cache = join(dir, "measure", `${name}.${info.size}.json`);
    const hit = await readFile(cache, "utf8").then((t) => JSON.parse(t) as ExportMeasure).catch(() => null);
    if (hit) return hit;
    const srt = path.replace(/\.mp4$/i, ".srt");
    const m = await measureExport(opts.ffmpeg, path, durationMs, existsSync(srt) ? srt : null);
    await mkdir(join(dir, "measure"), { recursive: true });
    await writeFile(cache, JSON.stringify(m));
    return m;
  }


  async function build(): Promise<Register> {
    const db = opts.db;
    const studio = await db.from("studios").select("id").limit(1).single<{ id: string }>();
    if (studio.error) throw new Error(studio.error.message);
    const sid = studio.data.id;
    const [videos, renders, scripts, recs, channels, pubs, snaps] = await Promise.all([
      all<Video>((a, b) => db.from("yt_videos").select("id, status, format, channel_id, recording_id, review_note, created_at, promise").eq("studio_id", sid).eq("is_test", false).order("created_at").range(a, b)),
      all<Render>((a, b) => db.from("yt_renders").select("video_id, script_id, file_name, duration_ms, width, height, voice_name, qc, created_at").eq("studio_id", sid).eq("is_test", false).order("created_at").range(a, b)),
      all<Script>((a, b) => db.from("yt_scripts").select("id, video_id, version, top_line, hook, lines, titles, edit_plan").eq("studio_id", sid).eq("is_test", false).order("created_at").range(a, b)),
      all<{ id: string; fingerprint: string; label: string }>((a, b) => db.from("yt_recordings").select("id, fingerprint, label").eq("studio_id", sid).range(a, b)),
      all<{ id: string; name: string; slug: string | null; safety_profile?: string | null }>((a, b) => db.from("yt_channels").select("id, name, slug, safety_profile").eq("studio_id", sid).range(a, b)),
      all<{ video_id: string; status: string; title: string }>((a, b) => db.from("yt_publications").select("video_id, status, title").eq("studio_id", sid).range(a, b)),
      all<{ video_id: string; views: number | null; avg_view_pct: number | null; taken_at: string }>((a, b) => db.from("yt_video_snapshots").select("video_id, views, avg_view_pct, taken_at").eq("studio_id", sid).not("video_id", "is", null).order("taken_at", { ascending: false }).range(a, b)),
    ]);
    // Milan's own content judgements (viral score parts he judged in the review).
    const judged = new Set((await all<{ metadata: { video_id?: string } }>((a, b) => db.from("studio_events").select("metadata").eq("studio_id", sid).eq("action", "viral_oordeel").range(a, b)).catch(() => [])).map((x) => x.metadata.video_id).filter((x): x is string => !!x));
    const onDisk = new Set((await readdir(join(opts.dataDir, "recordings")).catch(() => [] as string[])).map((n) => n.replace(/\.[^.]+$/, "")));
    const visualCache = new Map<string, VisualSignals | null>();
    /** The stored measurement; for productions still in play (not live, not archived) the newest one is made first. */
    const visualOf = async (fp: string, fresh: boolean) => {
      if (!visualCache.has(fp)) {
        let v = (await readFile(join(opts.dataDir, "visual", `${fp}.json`), "utf8").then((t) => JSON.parse(t) as VisualSignals).catch(() => null));
        if (fresh && opts.visual && v?.hud !== HUD_VERSION) v = (await opts.visual(fp).catch((e) => (opts.log(`Register: beeldmeting ${fp.slice(0, 12)} mislukt: ${e instanceof Error ? e.message : e}`), null))) ?? v;
        visualCache.set(fp, v);
      }
      return visualCache.get(fp)!;
    };
    const stat1 = new Map<string, { views: number | null; pct: number | null }>();
    for (const s of snaps) if (!stat1.has(s.video_id)) stat1.set(s.video_id, { views: s.views, pct: s.avg_view_pct === null ? null : Number(s.avg_view_pct) });
    // Gaming channels only (Dreamnest has its own productions and its own checks).
    const gaming = videos.filter((v) => {
      const ch = channels.find((c) => c.id === v.channel_id);
      return !ch || ch.safety_profile !== "infant_sleep";
    });
    running = { done: 0, total: gaming.length };
    const entries: Entry[] = [];
    for (const v of gaming) {
      const render = renders.filter((r) => r.video_id === v.id).at(-1) ?? null;
      const vScripts = scripts.filter((s) => s.video_id === v.id).sort((a, b) => b.version - a.version);
      const sc = (render && vScripts.find((s) => s.id === render.script_id)) ?? vScripts[0] ?? null;
      const ch = channels.find((c) => c.id === v.channel_id);
      const rec = recs.find((r) => r.id === v.recording_id);
      const pub = pubs.find((p) => p.video_id === v.id);
      const minecraftOnly = profileFor(ch).games.length === 1 && profileFor(ch).games[0] === "minecraft";
      let measure: ExportMeasure | null = null;
      let renderFile: boolean | null = null;
      if (render) {
        renderFile = existsSync(join(opts.rendersDir, render.file_name));
        if (renderFile) {
          try {
            measure = await measured(render.file_name, render.duration_ms);
          } catch (e) {
            opts.log(`Register: ${render.file_name} niet te meten: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      const segs = sc?.edit_plan ?? null;
      const slow = segs?.find((g) => g.effects?.includes("slowmo"));
      const payoff = segs?.find((g) => g.part === "payoff");
      const peakOutMs = slow ? slow.out_start_ms + Math.round((slow.src_end_ms - slow.src_start_ms) / (slow.speed || 1)) : payoff ? payoff.out_start_ms : null;
      const items = render?.qc?.items ?? [];
      const st = stat1.get(v.id);
      const facts: Facts = {
        videoId: v.id,
        channel: ch?.name ?? "KIVOXEL",
        title: pub?.title || sc?.titles?.[0] || sc?.top_line || v.promise || rec?.label || "Zonder titel",
        format: v.format,
        status: v.status,
        publication: pub?.status ?? null,
        createdAt: v.created_at,
        source: rec ? onDisk.has(rec.fingerprint) : null,
        renderFile,
        renderName: render?.file_name ?? null,
        width: render?.width ?? null,
        height: render?.height ?? null,
        durationMs: render?.duration_ms ?? null,
        measure,
        // 23-11-2026: no new picture measurement here (an hour of footage kept the worker too busy to answer the studio);
        // recordings are measured again when they are next analysed or edited.
        gameplayShare: minecraftOnly && rec && segs?.length ? gameplayShareOf(await visualOf(rec.fingerprint, false), segs.map((g) => ({ startMs: g.src_start_ms, endMs: g.src_end_ms }))) : null,
        hasVoice: !!render?.voice_name,
        topLine: sc?.top_line ?? null,
        lines: render?.voice_name ? (sc?.lines ?? []).map((l) => ({ atMs: l.at_ms, text: l.text })) : [],
        peakOutMs,
        qcRed: items.filter((i) => i.level === "red").length,
        voSyncRed: items.some((i) => i.key === "vo_sync" && i.level === "red"),
        reviewNote: v.review_note,
        avgViewPct: st?.pct ?? null,
        views: st?.views ?? null,
        milanJudged: judged.has(v.id),
      };
      entries.push(assess(facts));
      running = { done: entries.length, total: gaming.length };
    }
    const reg = summarize(entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), new Date().toISOString());
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(reg));
    return reg;
  }

  return {
    /** The last register (and progress while a new one is being built). */
    async get(): Promise<Register | { entries: []; builtAt: null; running: typeof running }> {
      const last = await readFile(file, "utf8").then((t) => JSON.parse(t) as Register).catch(() => null);
      return last ? { ...last, running } : { entries: [], builtAt: null, running };
    },
    /** Starts a new build in the background; one at a time. */
    run(): "started" | "running" {
      if (running && running.done < running.total) return "running";
      running = { done: 0, total: 0 };
      void build()
        .then((r) => opts.log(`Contentregister klaar: ${r.entries.length} producties (${Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ")})`))
        .catch((e) => opts.log(`Contentregister mislukt: ${e instanceof Error ? e.message : e}`))
        .finally(() => {
          running = null;
        });
      return "started";
    },
  };
}

// 23-11-2026 (Milan, superprompt V6, fase 28): Ivar's first aid on this pc. Every two minutes: a snapshot of the studio,
// incidents from lib/kivoxel/incidents.ts, the safe level-1 actions taken once (free a stuck step, retry a transient
// failure once), and the log in <data>/incidents.json (GET /incidents; the studio and Ivar's button read it). Never
// stops FFmpeg, never restarts the worker, never deletes, never spends money, never touches published videos.

import { statfs } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detect, healthLine, merge, type Incident, type JobSnap, type Snapshot } from "../lib/kivoxel/incidents.ts";
import { parseWait } from "../lib/youtube/uploadWait.ts";

export function createIncidentMonitor(opts: { db: SupabaseClient; dataDir: string; log: (m: string) => void; youtube?: () => Promise<{ connected: boolean; scopes: string[] } | null>; /** When this worker process started: only steps claimed before it are orphans that may be freed. */ startedAt: string }) {
  const file = join(opts.dataDir, "incidents.json");
  const progressSeen: Snapshot["progressSeen"] = {};
  const acted = new Set<string>();
  let last: { checkedAt: string; incidents: Incident[] } | null = null;

  async function load(): Promise<Incident[]> {
    if (last) return last.incidents;
    const stored = await readFile(file, "utf8").then((t) => JSON.parse(t) as { incidents: Incident[] }).catch(() => null);
    return stored?.incidents ?? [];
  }

  async function snapshot(): Promise<Snapshot> {
    const db = opts.db;
    const now = new Date().toISOString();
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const cols = "id, step, status, error, locked_at, attempts, max_attempts, heartbeat_at, progress, phase, started_at, finished_at, video_id, recording_id";
    const [running, failed, settings, costs, line] = await Promise.all([
      db.from("yt_jobs").select(cols).eq("status", "running").limit(100).returns<JobSnap[]>(),
      db.from("yt_jobs").select(cols).eq("status", "failed").gte("finished_at", since).limit(100).returns<JobSnap[]>(),
      db.from("yt_settings").select("monthly_cap_cents").limit(1).maybeSingle<{ monthly_cap_cents: number }>(),
      db.from("yt_costs").select("amount_cents").eq("currency", "EUR").gte("incurred_on", `${now.slice(0, 7)}-01`).returns<{ amount_cents: number }[]>(),
      db.from("yt_publications").select("error").eq("status", "queued").like("error", "Wachtrij YouTube%").limit(500).returns<{ error: string | null }[]>(),
    ]);
    const jobs = [...(running.data ?? []), ...(failed.data ?? [])].map((j) => ({ ...j, progress: j.progress === null ? null : Number(j.progress) }));
    // 23-11-2026: a failure that a later attempt of the same video and step already replaced (done, running or waiting)
    // is no incident any more (first real round: three "failed" montages, one already succeeded at 00:32).
    const failedVids = [...new Set((failed.data ?? []).map((j) => j.video_id).filter((x): x is string => !!x))];
    if (failedVids.length) {
      const later = await db.from("yt_jobs").select("video_id, step, status, created_at, payload").in("video_id", failedVids).in("status", ["done", "running", "queued"]).limit(1000).returns<{ video_id: string; step: string; status: string; created_at: string; payload: { preview?: unknown } | null }[]>();
      const created = new Map((await db.from("yt_jobs").select("id, created_at").in("id", (failed.data ?? []).map((j) => j.id)).returns<{ id: string; created_at: string }[]>()).data?.map((x) => [x.id, x.created_at]) ?? []);
      for (const j of jobs) if (j.status === "failed" && j.video_id) j.superseded = (later.data ?? []).some((x) => x.video_id === j.video_id && x.step === j.step && !x.payload?.preview && x.created_at > (created.get(j.id) ?? ""));
    }
    // 24-11-2026: the same for a recording step (intake, analysis): a later attempt that is done, running or waiting
    // replaces the failure (praktijktest: the first intake failed, the second succeeded, the "storing" stayed).
    const failedRecs = [...new Set((failed.data ?? []).filter((j) => !j.video_id).map((j) => (j as JobSnap & { recording_id?: string | null }).recording_id).filter((x): x is string => !!x))];
    if (failedRecs.length) {
      const later = await db.from("yt_jobs").select("recording_id, step, status, created_at").in("recording_id", failedRecs).in("status", ["done", "running", "queued"]).limit(1000).returns<{ recording_id: string; step: string; status: string; created_at: string }[]>();
      const created = new Map((await db.from("yt_jobs").select("id, created_at").in("id", (failed.data ?? []).map((j) => j.id)).returns<{ id: string; created_at: string }[]>()).data?.map((x) => [x.id, x.created_at]) ?? []);
      for (const j of jobs as (JobSnap & { recording_id?: string | null })[]) if (j.status === "failed" && !j.video_id && j.recording_id) j.superseded = (later.data ?? []).some((x) => x.recording_id === j.recording_id && x.step === j.step && x.created_at > (created.get(j.id) ?? ""));
    }
    // Titles for the messages (newest script's first title, else the promise).
    const vids = [...new Set(jobs.map((j) => j.video_id).filter((x): x is string => !!x))];
    if (vids.length) {
      const v = await db.from("yt_videos").select("id, promise").in("id", vids).returns<{ id: string; promise: string | null }[]>();
      for (const j of jobs) j.title = v.data?.find((x) => x.id === j.video_id)?.promise?.slice(0, 60) ?? null;
    }
    // Below the 8.0 norm: the newest render of videos in review.
    const review = await db.from("yt_videos").select("id, promise").eq("status", "review").limit(200).returns<{ id: string; promise: string | null }[]>();
    const belowNorm: Snapshot["belowNorm"] = [];
    if (review.data?.length) {
      const r = await db.from("yt_renders").select("video_id, qc, created_at").in("video_id", review.data.map((x) => x.id)).order("created_at", { ascending: false }).returns<{ video_id: string; qc: { viral?: { status: string; summary: string } } | null }[]>();
      const seen = new Set<string>();
      for (const x of r.data ?? []) {
        if (seen.has(x.video_id)) continue;
        seen.add(x.video_id);
        const v = x.qc?.viral;
        if (v && (v.status === "onder 8,0" || v.status === "geblokkeerd")) belowNorm.push({ videoId: x.video_id, title: review.data.find((y) => y.id === x.video_id)?.promise?.slice(0, 60) ?? "Video", summary: v.summary });
      }
    }
    const waits = (line.data ?? []).map((p) => parseWait(p.error)).filter((w): w is NonNullable<ReturnType<typeof parseWait>> => !!w).map((w) => w.since).sort();
    const disk = await statfs(opts.dataDir).then((s) => s.bavail * s.bsize).catch(() => null);
    return {
      now,
      jobs,
      progressSeen: { ...progressSeen },
      diskFreeBytes: disk,
      budget: settings.data ? { spentCents: (costs.data ?? []).reduce((a, c) => a + c.amount_cents, 0), capCents: settings.data.monthly_cap_cents } : null,
      youtube: opts.youtube ? await opts.youtube().catch(() => null) : null,
      uploadLineOldest: waits[0] ?? null,
      uploadLineCount: waits.length,
      belowNorm,
    };
  }

  /** Level 1 only, once per incident: free a stuck step (the database's own retry), or retry a transient failure. */
  async function act(i: Incident): Promise<Incident["done"] | undefined> {
    if (!i.action?.auto || i.action.level !== 1 || acted.has(i.id) || !i.ref?.jobId) return undefined;
    acted.add(i.id);
    const at = new Date().toISOString();
    if (i.kind === "stap_vast") {
      // A busy worker can also miss heartbeats for a while (23-11-2026): only a step claimed before this worker started
      // is an orphan. Otherwise wait; the database frees it by itself after its own stale time.
      const job = (await opts.db.from("yt_jobs").select("locked_at").eq("id", i.ref.jobId).maybeSingle<{ locked_at: string | null }>()).data;
      if (!job?.locked_at || job.locked_at >= opts.startedAt) {
        acted.delete(i.id);
        return undefined;
      }
      const r = await opts.db.from("yt_jobs").update({ status: "queued", locked_by: null, locked_at: null }).eq("id", i.ref.jobId).eq("status", "running");
      return { what: r.error ? `Vrijgeven mislukt: ${r.error.message}` : "Stap vrijgegeven; de werker pakt hem opnieuw op", at, verified: r.error ? false : null };
    }
    if (i.kind === "stap_mislukt") {
      const r = await opts.db.from("yt_jobs").update({ status: "queued", error: null, finished_at: null, locked_by: null, locked_at: null }).eq("id", i.ref.jobId).eq("status", "failed");
      return { what: r.error ? `Opnieuw proberen mislukt: ${r.error.message}` : "Tijdelijke fout: één keer opnieuw in de rij gezet", at, verified: r.error ? false : null };
    }
    return undefined;
  }

  async function round() {
    const s = await snapshot();
    for (const j of s.jobs.filter((x) => x.status === "running")) {
      const seen = progressSeen[j.id];
      if (!seen || seen.progress !== j.progress) progressSeen[j.id] = { progress: j.progress, since: s.now };
    }
    for (const id of Object.keys(progressSeen)) if (!s.jobs.some((j) => j.id === id && j.status === "running")) delete progressSeen[id];
    const list = merge(await load(), detect(s), s.now);
    for (const i of list.filter((x) => !x.resolvedAt && !x.done)) {
      const done = await act(i);
      if (done) {
        i.done = done;
        opts.log(`Ivar: ${i.title} → ${done.what}`);
      }
    }
    last = { checkedAt: s.now, incidents: list };
    await mkdir(opts.dataDir, { recursive: true });
    await writeFile(file, JSON.stringify(last));
  }

  return {
    start(intervalMs = 120_000) {
      const tick = () => void round().catch((e) => opts.log(`Ivar-monitor: ronde mislukt: ${e instanceof Error ? e.message : e}`));
      setTimeout(tick, 15_000);
      return setInterval(tick, intervalMs);
    },
    round,
    async get() {
      const incidents = await load();
      return { checkedAt: last?.checkedAt ?? null, health: healthLine(incidents), incidents };
    },
  };
}

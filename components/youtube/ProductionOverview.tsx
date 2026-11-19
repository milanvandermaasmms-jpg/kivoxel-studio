"use client";
// Productie-overzicht (Milan, 18-11-2026): in één oogopslag wat de werker doet, met percentages, wat er wacht, wat per
// opname al klaar is (van analyse tot montage) en duidelijk rood als iets stil staat. Ververst elke 4 seconden.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pollOnce } from "@/lib/visible";
import type { LiveJob } from "@/lib/youtube/production";
import { minutes, pipelines, queueByStep, runningView, stepView, workerState, type RecordingPipeline, type RunningView } from "@/lib/youtube/productionOverview";

type Props = {
  studioId: string;
  workerOnline: boolean;
  titleOf: (videoId: string) => string | null;
  recordings: { id: string; label: string; is_test?: boolean }[];
  videos: { id: string; recording_id: string | null; format: string; status: string; is_test?: boolean }[];
};

const COLS = "id, step, status, recording_id, video_id, attempts, max_attempts, error, created_at, started_at, finished_at, progress, phase, metrics, heartbeat_at";

function useProductionJobs(studioId: string) {
  const [active, setActive] = useState<LiveJob[] | null>(null);
  const [today, setToday] = useState<LiveJob[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const polling = useRef(false);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const [a, t] = await Promise.all([
      supabase.from("yt_jobs").select(COLS).eq("studio_id", studioId).in("status", ["queued", "running"]).order("created_at").limit(500).returns<LiveJob[]>(),
      supabase.from("yt_jobs").select(COLS).eq("studio_id", studioId).in("status", ["done", "failed"]).gte("finished_at", since).order("finished_at", { ascending: false }).limit(500).returns<LiveJob[]>(),
    ]);
    if (!a.error) setActive(a.data ?? []);
    if (!t.error) setToday(t.data ?? []);
    setNow(Date.now());
  }, [studioId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => pollOnce(polling, load), 15_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => (clearInterval(t), clearInterval(tick));
  }, [load]);
  return { active, today, now };
}

// Translucent colours: readable on the dark Studio and on a light screen alike.
const TONE: Record<string, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/10",
  wait: "border-sky-500/50 bg-sky-500/10",
  warn: "border-amber-500/60 bg-amber-500/15",
  error: "border-red-500/60 bg-red-500/15",
  idle: "border-slate-400/40 bg-slate-500/10",
};
const DOT: Record<string, string> = { ok: "bg-emerald-500 animate-pulse", wait: "bg-sky-500 animate-pulse", warn: "bg-amber-500", error: "bg-red-500", idle: "bg-slate-400" };

function Bar({ pct, stalled = false, slim = false }: { pct: number | null; stalled?: boolean; slim?: boolean }) {
  const color = stalled ? "bg-red-500" : "bg-[#7c3aed]";
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-200 ${slim ? "h-1.5" : "h-3"}`} role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {pct === null ? <div className={`h-full w-1/3 animate-pulse rounded-full ${color} opacity-60`} /> : <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${Math.max(2, pct)}%` }} />}
    </div>
  );
}

function RunningCard({ r, title }: { r: RunningView; title: string }) {
  return (
    <li className={`rounded-xl border p-3 ${r.stalled ? "border-red-500/60 bg-red-500/15" : "border-slate-200 bg-surface"}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">{r.icon}</span>
        <span className="font-semibold">{r.label}</span>
        {r.attempt && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{r.attempt}</span>}
        <span className="ml-auto text-2xl font-bold tabular-nums">{r.pct === null ? "…" : `${Math.floor(r.pct)}%`}</span>
      </div>
      <p className="mt-0.5 line-clamp-1 text-sm text-slate-700">{title}</p>
      <div className="mt-2">
        <Bar pct={r.pct} stalled={r.stalled} />
      </div>
      <p className="mt-1.5 text-xs text-slate-600">{r.phase ?? "Bezig"}</p>
      <p className={`mt-0.5 text-xs ${r.stalled ? "font-semibold text-red-700" : "text-slate-500"}`}>
        {r.etaMs ? `nog ± ${minutes(r.etaMs)} · ` : ""}
        {r.elapsedMs !== null ? `bezig ${minutes(r.elapsedMs)} · ` : ""}
        {r.stalled ? `⚠️ al ${minutes(r.heartbeatAgoMs ?? 0)} geen teken van leven` : r.heartbeatAgoMs !== null ? `laatste teken van leven ${minutes(r.heartbeatAgoMs)} geleden` : ""}
      </p>
    </li>
  );
}

function PipelineRow({ p }: { p: RecordingPipeline }) {
  const cell = (n: number, label: string, tone = "text-slate-700") => (
    <span className={`flex flex-col items-center ${n ? tone : "text-slate-300"}`}>
      <span className="text-base font-bold tabular-nums">{n}</span>
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
    </span>
  );
  const analysis = p.analysis === "klaar" ? "✅ klaar" : p.analysis === "bezig" ? `🔍 ${p.analysisPct === null ? "bezig" : `${Math.floor(p.analysisPct)}%`}` : p.analysis === "mislukt" ? "❌ mislukt" : "⏳ wacht";
  return (
    <li className="rounded-xl border border-slate-200 bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>🎮</span>
        <span className="font-semibold">{p.label}</span>
        <span className="text-xs text-slate-500">Analyse: {analysis}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">{p.total ? `${p.pct}% klaar` : "nog geen video's"}</span>
      </div>
      {p.analysis === "bezig" && <div className="mt-2"><Bar pct={p.analysisPct} slim /></div>}
      {p.total > 0 && (
        <>
          <div className="mt-2"><Bar pct={p.pct} slim /></div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {cell(p.scripting, "script", "text-slate-700")}
            {cell(p.montage, "montage", "text-[#7c3aed]")}
            {cell(p.review, "keuren", "text-amber-700")}
            {cell(p.ready, "klaar", "text-emerald-700")}
            {cell(p.live, "YouTube", "text-cyan-700")}
          </div>
        </>
      )}
    </li>
  );
}

export function ProductionOverview({ studioId, workerOnline, titleOf, recordings, videos }: Props) {
  const { active, today, now } = useProductionJobs(studioId);
  if (active === null) return <p className="text-sm text-slate-500">Productie laden…</p>;
  const recLabel = new Map(recordings.map((r) => [r.id, r.label]));
  const titleFor = (j: { video_id: string | null; recording_id: string | null }) => (j.video_id ? titleOf(j.video_id) : null) ?? (j.recording_id ? `Opname: ${recLabel.get(j.recording_id) ?? "onbekend"}` : "Studio");
  const state = workerState({ jobs: [...active, ...today], workerOnline, nowMs: now });
  const running = active.filter((j) => j.status === "running").map((j) => ({ j, r: runningView(j, now) })).sort((a, b) => stepView(a.j.step).order - stepView(b.j.step).order);
  const queue = queueByStep(active);
  // The order in which the worker takes them: uploads first, then the rest by age.
  const next = active.filter((j) => j.status === "queued").sort((a, b) => stepView(a.step).order - stepView(b.step).order || Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 8);
  const pipes = pipelines(recordings, videos, [...active, ...today], now);
  const done = today.filter((j) => j.status === "done");
  const failed = today.filter((j) => j.status === "failed");
  const perStepDone = queueByStep(done.map((j) => ({ ...j, status: "queued" as const }))).map((s) => `${s.icon} ${s.queued}`).join("  ");

  return (
    <section className="space-y-4" aria-label="Productie-overzicht">
      <div className={`flex items-start gap-3 rounded-xl border p-3 ${TONE[state.tone]}`} role="status">
        <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[state.tone]}`} aria-hidden />
        <div>
          <p className="text-base font-semibold">{state.title}</p>
          <p className="text-sm opacity-90">{state.note}</p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Nu bezig</h3>
        {running.length ? <ul className="grid gap-2 lg:grid-cols-2">{running.map(({ j, r }) => <RunningCard key={j.id} r={r} title={titleFor(j)} />)}</ul> : <p className="text-sm text-slate-500">Er loopt nu niets.</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">In de rij {queue.length ? `(${queue.reduce((s, q) => s + q.queued, 0)})` : ""}</h3>
        {queue.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {queue.map((q) => (
                <span key={q.step} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-surface px-3 py-1 text-sm">
                  <span aria-hidden>{q.icon}</span> {q.label}: <b className="tabular-nums">{q.queued}</b> wachten{q.running ? `, ${q.running} bezig` : ""}
                </span>
              ))}
            </div>
            {next.length > 0 && (
              <ol className="mt-2 space-y-1 text-sm">
                {next.map((j, i) => (
                  <li key={j.id} className="flex items-center gap-2 text-slate-600">
                    <span className="w-5 text-right tabular-nums text-slate-400">{i + 1}.</span>
                    <span aria-hidden>{stepView(j.step).icon}</span>
                    <span className="line-clamp-1">{titleFor(j)}</span>
                    {j.attempts > 0 && <span className="shrink-0 text-xs text-amber-700">opnieuw</span>}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">De rij is leeg.</p>
        )}
      </div>

      {pipes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Van analyse tot montage, per opname</h3>
          <ul className="grid gap-2 lg:grid-cols-2">{pipes.map((p) => <PipelineRow key={p.recordingId} p={p} />)}</ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-surface p-3 text-sm">
        <p>
          <b>Laatste 24 uur:</b> {done.length} klaar{perStepDone ? ` (${perStepDone})` : ""} · <span className={failed.length ? "font-semibold text-red-700" : ""}>{failed.length} mislukt</span>
        </p>
        {failed.slice(0, 3).map((j) => (
          <p key={j.id} className="mt-1 text-xs text-red-700 [overflow-wrap:anywhere]">
            {stepView(j.step).icon} {titleFor(j)}: {j.error ?? "onbekende fout"}
          </p>
        ))}
      </div>
    </section>
  );
}

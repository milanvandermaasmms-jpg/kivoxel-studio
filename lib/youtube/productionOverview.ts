// Productie-overzicht (Milan, 18-11-2026): "makkelijk en precies zien wat er gebeurt, ook als iets stil staat, met %".
// Pure functions: from the queue (yt_jobs) and the board to what the overview shows. No database, no React.
import type { LiveJob } from "./production";

export const STEP_VIEW: Record<string, { icon: string; label: string; order: number }> = {
  upload: { icon: "🚀", label: "Upload naar YouTube", order: 0 },
  publish: { icon: "🌐", label: "Zichtbaarheid op YouTube", order: 1 },
  intake: { icon: "📥", label: "Opname inlezen", order: 2 },
  analyse: { icon: "🔍", label: "Analyse", order: 3 },
  script: { icon: "✍️", label: "Script", order: 4 },
  render: { icon: "🎬", label: "Montage", order: 5 },
  suggest: { icon: "💡", label: "AI-suggesties", order: 6 },
  viral: { icon: "📈", label: "Viral-check", order: 7 },
  reference: { icon: "🔎", label: "Referentievideo's", order: 8 },
  assistant: { icon: "🤖", label: "Ivar", order: 9 },
  insight: { icon: "🧠", label: "Inzichten", order: 10 },
};
export const stepView = (step: string) => STEP_VIEW[step] ?? { icon: "⚙️", label: step, order: 99 };

/** No sign of life for this long while a step runs: it looks stuck. The worker writes a heartbeat every 10 seconds. */
export const STALL_MS = 2 * 60_000;
/** Nothing runs while steps wait for this long: the worker stands still (between two steps there are only seconds). */
export const IDLE_MS = 90_000;

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

export type RunningView = {
  id: string;
  step: string;
  icon: string;
  label: string;
  phase: string | null;
  /** 0-100, or null when the step does not report a percentage (yet). */
  pct: number | null;
  elapsedMs: number | null;
  etaMs: number | null;
  heartbeatAgoMs: number | null;
  stalled: boolean;
  attempt: string;
  videoId: string | null;
  recordingId: string | null;
};

export function runningView(j: LiveJob, nowMs: number): RunningView {
  const v = stepView(j.step);
  const p = num(j.progress);
  const pct = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round((p > 1 ? p : p * 100) * 10) / 10)) : null;
  const eta = num(j.metrics?.eta_ms);
  const beat = ms(j.heartbeat_at);
  const started = ms(j.started_at);
  const heartbeatAgoMs = Number.isFinite(beat) ? Math.max(0, nowMs - beat) : Number.isFinite(started) ? Math.max(0, nowMs - started) : null;
  return {
    id: j.id,
    step: j.step,
    icon: v.icon,
    label: v.label,
    phase: j.phase?.trim() || null,
    pct,
    elapsedMs: Number.isFinite(started) ? Math.max(0, nowMs - started) : null,
    etaMs: Number.isFinite(eta) && eta > 0 ? eta : null,
    heartbeatAgoMs,
    stalled: heartbeatAgoMs !== null && heartbeatAgoMs > STALL_MS,
    attempt: j.max_attempts && j.attempts > 1 ? `poging ${j.attempts} van ${j.max_attempts}` : "",
    videoId: j.video_id,
    recordingId: j.recording_id,
  };
}

export type WorkerState = { tone: "ok" | "wait" | "warn" | "error" | "idle"; title: string; note: string };

/**
 * One line at the top: is the worker doing what it should? Working, waiting for uploads first (Milan's rule),
 * standing still while work waits, offline, or simply nothing to do.
 */
export function workerState(input: { jobs: LiveJob[]; workerOnline: boolean; nowMs: number }): WorkerState {
  const running = input.jobs.filter((j) => j.status === "running");
  const queued = input.jobs.filter((j) => j.status === "queued");
  if (!input.workerOnline) return queued.length || running.length ? { tone: "error", title: "Werker staat uit", note: `${queued.length + running.length} stappen wachten. Start worker\\start-werker.cmd op de pc.` } : { tone: "idle", title: "Werker staat uit", note: "Er wacht ook niets." };
  const views = running.map((j) => runningView(j, input.nowMs));
  const stuck = views.filter((v) => v.stalled);
  if (stuck.length) return { tone: "error", title: "Er staat iets stil", note: `${stuck.map((s) => s.label).join(", ")}: al ${minutes(Math.max(...stuck.map((s) => s.heartbeatAgoMs ?? 0)))} geen teken van leven van de werker.` };
  const uploads = [...running, ...queued].filter((j) => j.step === "upload" || j.step === "publish");
  const mainWaiting = queued.filter((j) => ["intake", "analyse", "script", "render"].includes(j.step)).length;
  if (uploads.length && mainWaiting && !running.some((j) => ["intake", "analyse", "script", "render"].includes(j.step)))
    return { tone: "wait", title: "Eerst de uploads", note: `${uploads.length} upload${uploads.length === 1 ? "" : "s"} naar YouTube; daarna gaan ${mainWaiting} andere stappen verder.` };
  if (running.length) return { tone: "ok", title: "De werker is bezig", note: `${running.length} stap${running.length === 1 ? "" : "pen"} bezig, ${queued.length} in de rij.` };
  if (queued.length) {
    const lastSign = Math.max(...input.jobs.map((j) => Math.max(ms(j.finished_at), ms(j.heartbeat_at), ms(j.started_at))).filter(Number.isFinite), 0);
    const quiet = lastSign ? input.nowMs - lastSign : Infinity;
    return quiet > IDLE_MS ? { tone: "warn", title: "De werker staat stil", note: `${queued.length} stappen wachten, maar er is al ${minutes(quiet)} niets gestart. Herstart de werker als dit zo blijft.` } : { tone: "ok", title: "De werker pakt de volgende stap", note: `${queued.length} in de rij.` };
  }
  return { tone: "idle", title: "Alles is klaar", note: "Er wacht niets in de productie." };
}

export function minutes(msValue: number): string {
  if (!Number.isFinite(msValue)) return "lang";
  const s = Math.round(msValue / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} u ${m % 60} min`;
}

/** The queue per step, in the order the worker handles them (uploads first). */
export function queueByStep(jobs: LiveJob[]): { step: string; icon: string; label: string; running: number; queued: number }[] {
  const by = new Map<string, { running: number; queued: number }>();
  for (const j of jobs) {
    if (j.status !== "queued" && j.status !== "running") continue;
    const c = by.get(j.step) ?? { running: 0, queued: 0 };
    if (j.status === "running") c.running++;
    else c.queued++;
    by.set(j.step, c);
  }
  return [...by.entries()].map(([step, c]) => ({ step, ...stepView(step), ...c })).sort((a, b) => stepView(a.step).order - stepView(b.step).order);
}

type BoardVideoLite = { id: string; recording_id: string | null; format: string; status: string; is_test?: boolean };
type RecordingLite = { id: string; label: string; is_test?: boolean; created_at?: string };

export type RecordingPipeline = {
  recordingId: string;
  label: string;
  analysis: "wacht" | "bezig" | "klaar" | "mislukt";
  analysisPct: number | null;
  /** Videos per stage. */
  scripting: number;
  montage: number;
  review: number;
  ready: number;
  live: number;
  total: number;
  /** Share of the videos that left production (review, ready or live), 0-100. */
  pct: number;
};

/** "Van analyse tot montage" per recording that still has work in progress. Finished recordings are left out. */
export function pipelines(recordings: RecordingLite[], videos: BoardVideoLite[], jobs: LiveJob[], nowMs: number): RecordingPipeline[] {
  const out: RecordingPipeline[] = [];
  for (const r of recordings) {
    if (r.is_test) continue;
    const vids = videos.filter((v) => v.recording_id === r.id && v.status !== "archived" && !v.is_test);
    const an = jobs.filter((j) => j.recording_id === r.id && j.step === "analyse").sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
    const analysis: RecordingPipeline["analysis"] = an ? (an.status === "running" ? "bezig" : an.status === "queued" ? "wacht" : an.status === "failed" ? "mislukt" : "klaar") : vids.length ? "klaar" : "wacht";
    const scripting = vids.filter((v) => v.status === "idea" || v.status === "scripted").length;
    const montage = vids.filter((v) => v.status === "rendering").length;
    const review = vids.filter((v) => v.status === "review").length;
    const ready = vids.filter((v) => v.status === "approved").length;
    const live = vids.filter((v) => v.status === "scheduled" || v.status === "published").length;
    const busy = analysis === "bezig" || analysis === "wacht" || scripting + montage > 0;
    if (!busy) continue;
    const total = vids.length;
    out.push({
      recordingId: r.id,
      label: r.label,
      analysis,
      analysisPct: an?.status === "running" ? runningView(an, nowMs).pct : null,
      scripting,
      montage,
      review,
      ready,
      live,
      total,
      pct: total ? Math.round(((review + ready + live) / total) * 100) : 0,
    });
  }
  return out;
}

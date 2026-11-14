// Task cards in the chat: the real status of a step in yt_jobs (KIVOXEL) or dn_render_jobs (Dreamnest).
// No invented percentages: progress only when the worker reported it. Pure, tested.

export type TaskStatus = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";

export type JobRow = {
  id: string;
  step: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  attempts?: number;
  max_attempts?: number;
  phase?: string | null;
  /** yt_jobs: 0..1; dn_render_jobs: 0..100. */
  progress?: number | string | null;
  cancel_requested?: boolean | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  video_id?: string | null;
  recording_id?: string | null;
  episode_id?: string | null;
  result?: unknown;
};

export type TaskView = {
  id: string;
  queue: "yt" | "dn";
  name: string;
  status: TaskStatus;
  statusLabel: string;
  step: string;
  /** 0..100, only when the worker measured it. */
  percent: number | null;
  startedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  canCancel: boolean;
  canRetry: boolean;
  next: string | null;
};

export const TASK_NAME: Record<string, string> = {
  intake: "Opname controleren",
  analyse: "Media analyseren",
  script: "Script schrijven",
  voiceover: "Voice-over maken",
  render: "Montage renderen",
  upload: "Uploaden naar YouTube (privé)",
  publish: "Publiceren",
  suggest: "Tags en titels voorstellen",
  viral: "Kwaliteit controleren",
  reference: "Referentievideo's ophalen",
  assistant: "Antwoord van Ivar",
  dn_concept: "Concept maken",
  dn_storyboard: "Storyboard",
  dn_keyframes: "Sleutelbeelden",
  dn_animate: "Animeren",
  dn_music: "Muziek",
  dn_timeline: "Tijdlijn",
  dn_preview: "Preview",
  dn_render: "Eindversie renderen",
  dn_qc: "Kwaliteitscontrole",
  dn_package: "Verpakking",
  dn_publish: "Publiceren",
  dn_ping: "Testping",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Wacht op de pc",
  running: "Bezig",
  needs_input: "Wacht op jou",
  succeeded: "Klaar",
  failed: "Mislukt",
  cancelled: "Geannuleerd",
};

const NEXT: Record<string, string> = {
  analyse: "Bekijk de gevonden momenten en scripts bij Actie nodig.",
  script: "Keur het script goed bij Actie nodig; daarna kan de montage.",
  render: "Bekijk de preview en keur hem goed of stuur hem terug.",
  viral: "Bekijk de scorekaart bij de video.",
  upload: "De video staat privé op YouTube; publiceren blijft jouw klik.",
};

/** The running phase as text: the worker's own phase, else a plain sentence (never a made-up percentage). */
function runningLabel(job: JobRow): string {
  if (job.cancel_requested) return "Wordt geannuleerd";
  if (job.phase) return job.phase;
  if (job.step === "render" || job.step === "dn_render") return "Bezig met renderen";
  return "Bezig";
}

export function taskView(job: JobRow, queue: "yt" | "dn"): TaskView {
  const status: TaskStatus = job.status === "done" ? "succeeded" : job.status;
  const raw = job.progress == null ? null : Number(job.progress);
  const percent = raw == null || !Number.isFinite(raw) || status !== "running" ? null : Math.max(0, Math.min(100, Math.round(queue === "yt" ? raw * 100 : raw)));
  return {
    id: job.id,
    queue,
    name: TASK_NAME[job.step] ?? job.step,
    status,
    statusLabel: status === "running" ? runningLabel(job) : TASK_STATUS_LABEL[status],
    step: job.step,
    percent,
    startedAt: job.started_at ?? null,
    createdAt: job.created_at,
    finishedAt: job.finished_at ?? null,
    error: status === "failed" || status === "cancelled" ? job.error : null,
    canCancel: (status === "queued" || status === "running") && !job.cancel_requested,
    canRetry: queue === "yt" && (status === "failed" || status === "cancelled") && job.step !== "assistant" && job.step !== "upload" && job.step !== "publish",
    next: status === "succeeded" ? (NEXT[job.step] ?? null) : null,
  };
}

/** "3 min 12 s" since start (or since queued). */
export function elapsed(fromIso: string | null, now: number, toIso?: string | null): string {
  if (!fromIso) return "";
  const end = toIso ? Date.parse(toIso) : now;
  const s = Math.max(0, Math.round((end - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} u ${m % 60} min`;
}

/** The launcher's quiet signal: something runs, a result is ready (unseen), or something needs attention. */
export type LauncherSignal = "idle" | "busy" | "ready" | "attention";
export function launcherSignal(tasks: Pick<TaskView, "status" | "finishedAt">[], replies: { status: string; updated_at: string }[], seenAt: number): LauncherSignal {
  const fresh = (iso: string | null) => !!iso && Date.parse(iso) > seenAt;
  if (tasks.some((t) => t.status === "failed" && fresh(t.finishedAt)) || replies.some((r) => r.status === "error" && fresh(r.updated_at))) return "attention";
  if (tasks.some((t) => t.status === "queued" || t.status === "running") || replies.some((r) => r.status === "pending" || r.status === "running")) return "busy";
  if (tasks.some((t) => t.status === "succeeded" && fresh(t.finishedAt)) || replies.some((r) => r.status === "done" && fresh(r.updated_at))) return "ready";
  return "idle";
}

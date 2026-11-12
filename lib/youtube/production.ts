// Live Production Center (fase B2): one production = one video, from analysis to review. Built only from real job
// rows and video status in the database; nothing is simulated. Pure functions, tested without a database.

export type LiveJob = {
  id: string;
  step: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  recording_id: string | null;
  video_id: string | null;
  attempts: number;
  max_attempts?: number;
  error: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  // Migration 033; absent before.
  progress?: number | string | null;
  phase?: string | null;
  metrics?: Record<string, number | null> | null;
  heartbeat_at?: string | null;
  cancel_requested?: boolean;
  payload?: { script_id?: string } | null;
};

/** The statuses from the assignment (2.2, chapter 3B), with a Dutch label. */
export type ActivityStatus = "WAITING" | "ANALYZING" | "GENERATING" | "RENDERING" | "UPLOADING" | "REVIEW" | "COMPLETED" | "FAILED";
export const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  WAITING: "Wacht",
  ANALYZING: "Analyseren",
  GENERATING: "Genereren",
  RENDERING: "Renderen",
  UPLOADING: "Uploaden",
  REVIEW: "Controle",
  COMPLETED: "Klaar",
  FAILED: "Mislukt",
};

export type Activity = {
  key: "analyse" | "script" | "render" | "review" | "upload";
  label: string;
  status: ActivityStatus;
  job: LiveJob | null;
  /** 0-1 only when the worker measured it; otherwise null. */
  progress: number | null;
};

const RUNNING_STATUS: Record<string, ActivityStatus> = { analyse: "ANALYZING", intake: "ANALYZING", script: "GENERATING", render: "RENDERING", upload: "UPLOADING", publish: "UPLOADING" };

/** Newest job of a step, as the worker sees it (ignores cancelled attempts when a newer one exists). */
function latest(jobs: LiveJob[], step: string, match: (j: LiveJob) => boolean): LiveJob | null {
  return jobs.filter((j) => j.step === step && match(j)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function fromJob(key: Activity["key"], label: string, job: LiveJob | null): Activity {
  if (!job) return { key, label, status: "WAITING", job: null, progress: null };
  const progress = job.progress === null || job.progress === undefined ? null : Number(job.progress);
  const status: ActivityStatus =
    job.status === "done" ? "COMPLETED" : job.status === "failed" || job.status === "cancelled" ? "FAILED" : job.status === "running" ? (RUNNING_STATUS[job.step] ?? "GENERATING") : "WAITING";
  return { key, label, status, job, progress: job.status === "done" ? 1 : Number.isFinite(progress) ? progress : null };
}

/** The four activities of one video, from analysis to the review by Milan. */
export function productionSteps(video: { id: string; recording_id: string | null; status: string }, jobs: LiveJob[]): Activity[] {
  const analyse = video.recording_id ? latest(jobs, "analyse", (j) => j.recording_id === video.recording_id) : null;
  const script = latest(jobs, "script", (j) => j.video_id === video.id);
  const render = latest(jobs, "render", (j) => j.video_id === video.id);
  const reviewDone = video.status === "approved" || video.status === "scheduled" || video.status === "published";
  const review: Activity = {
    key: "review",
    label: "Controle en goedkeuring",
    status: reviewDone ? "COMPLETED" : video.status === "review" ? "REVIEW" : "WAITING",
    job: null,
    progress: reviewDone ? 1 : null,
  };
  const steps = [fromJob("analyse", "Gameplay analyseren", analyse), fromJob("script", "Script schrijven", script), fromJob("render", "Voice-over en montage", render), review];
  // Fase D3: once Milan asked for a private upload, that step is shown too.
  const upload = latest(jobs, "upload", (j) => j.video_id === video.id);
  const publish = latest(jobs, "publish", (j) => j.video_id === video.id);
  // Fase D4: the newest of the upload and the visibility change counts.
  const last = publish && (!upload || publish.created_at > upload.created_at) ? publish : upload;
  if (!last) return steps;
  return [...steps, fromJob("upload", last.step === "publish" ? "Zichtbaarheid bij YouTube" : "Uploaden naar YouTube", last)];
}

/** Share of the production that is done: finished steps plus the measured part of the current step. */
export function overallProgress(steps: Activity[]): { done: number; total: number; share: number } {
  const done = steps.filter((s) => s.status === "COMPLETED").length;
  const current = steps.find((s) => s.status !== "COMPLETED" && s.progress !== null && s.status !== "FAILED");
  const share = (done + (current?.progress ?? 0)) / steps.length;
  return { done, total: steps.length, share: Math.min(1, share) };
}

/** Which video to show first: one that is rendering now, otherwise the newest montage step. */
export function pickProduction(jobs: LiveJob[]): string | null {
  const byTime = [...jobs].filter((j) => j.video_id && (j.step === "render" || j.step === "upload" || j.step === "publish")).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (byTime.find((j) => j.status === "running") ?? byTime.find((j) => j.status === "queued") ?? byTime[0])?.video_id ?? null;
}

/** The worker counts as alive when its heartbeat is less than 30 s old (it beats every 10 s). */
export function heartbeatAge(job: LiveJob, now = Date.now()): number | null {
  return job.heartbeat_at ? Math.max(0, now - Date.parse(job.heartbeat_at)) : null;
}

/** "12 s", "3 min", "1 u 5 min". */
export function shortDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 && m < 10 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} u ${m % 60} min`;
}

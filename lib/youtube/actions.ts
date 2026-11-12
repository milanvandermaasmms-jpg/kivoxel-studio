// Fase 1.6: the daily overview of YouTube Studio. What is ready, what is in progress and which exceptions
// need Milan ("Mijn acties"). Test data is left out: it is never published, so it never needs action.
import type { DbScript, DbSettings, DbVideo } from "./analysisData";
import type { DbJob } from "./studio";

export type StudioAction = { key: string; text: string; tone: "warn" | "error"; tab: "pipeline" | "settings" };
export type StudioOverview = {
  ready: number;
  review: number;
  scriptsToApprove: number;
  rendering: number;
  actions: StudioAction[];
};

export type OverviewInput = {
  videos: Pick<DbVideo, "id" | "status" | "is_test" | "format">[];
  scripts: Pick<DbScript, "video_id" | "status" | "version" | "top_line">[];
  /** Newest first, as loadStudio returns them. */
  jobs: Pick<DbJob, "id" | "step" | "status" | "error" | "recording_id" | "video_id">[];
  settings: Pick<DbSettings, "monthly_cap_cents" | "warn_at_percent"> | null;
  spentCents: number;
  /** false when the worker on the pc is not reachable; undefined while checking. */
  workerOnline: boolean | undefined;
  stepLabel: (step: string) => string;
};

const name = (video: { id: string; format: string }, scripts: OverviewInput["scripts"]) => {
  const top = scripts.find((s) => s.video_id === video.id && s.top_line)?.top_line;
  return top ? `"${top}" (format ${video.format})` : `een video van format ${video.format}`;
};

export function studioOverview(input: OverviewInput): StudioOverview {
  const videos = input.videos.filter((v) => !v.is_test);
  const scriptsOf = (id: string) => input.scripts.filter((s) => s.video_id === id).sort((a, b) => b.version - a.version);
  const waitingScript = videos.filter((v) => {
    const own = scriptsOf(v.id);
    return own.length > 0 && own[0].status === "draft" && !own.some((s) => s.status === "approved");
  });
  const review = videos.filter((v) => v.status === "review");
  const actions: StudioAction[] = [];

  const queued = input.jobs.filter((j) => j.status === "queued").length;
  if (input.workerOnline === false && queued > 0) actions.push({ key: "worker", text: `${queued} ${queued === 1 ? "opdracht wacht" : "opdrachten wachten"} op de pc. Start de werker.`, tone: "warn", tab: "settings" });

  // A failed step that was followed by a new attempt for the same recording or video no longer needs action.
  const superseded = (i: number) => input.jobs.slice(0, i).some((n) => n.step === input.jobs[i].step && n.recording_id === input.jobs[i].recording_id && n.video_id === input.jobs[i].video_id && n.status !== "failed" && n.status !== "cancelled");
  for (const j of input.jobs.filter((j, i) => j.status === "failed" && !superseded(i)))
    actions.push({ key: `job:${j.id}`, text: `${input.stepLabel(j.step)} is mislukt${j.error ? `: ${j.error}` : ""}. Kies Opnieuw in de wachtrij.`, tone: "error", tab: "pipeline" });

  for (const v of review) actions.push({ key: `review:${v.id}`, text: `Bekijk de montage van ${name(v, input.scripts)} en keur hem goed of af.`, tone: "warn", tab: "pipeline" });
  for (const v of waitingScript) actions.push({ key: `script:${v.id}`, text: `Het script van ${name(v, input.scripts)} wacht op goedkeuring.`, tone: "warn", tab: "pipeline" });

  const s = input.settings;
  if (s && s.monthly_cap_cents > 0) {
    // Rounded down: 79.8% is not yet the 80% warning.
    const used = Math.floor((input.spentCents / s.monthly_cap_cents) * 100);
    if (used >= s.warn_at_percent) actions.push({ key: "budget", text: `${used}% van het maandplafond voor de analyse is gebruikt.`, tone: used >= 100 ? "error" : "warn", tab: "settings" });
  }

  return {
    ready: videos.filter((v) => v.status === "approved").length,
    review: review.length,
    scriptsToApprove: waitingScript.length,
    rendering: videos.filter((v) => v.status === "rendering").length,
    actions,
  };
}

// Pipeline board (multi-channel Studio, fase A): every source (a recording, or a video without one) is a project card
// in the column of the step it is in. Pure functions, so the rules are tested without a database.
import type { Format, PrivacyFlag } from "./analysis";

export type Stage = "new" | "analyse" | "concept" | "keur1" | "production" | "keur2" | "scheduled" | "live";

export const STAGES: { key: Stage; label: string; note: string }[] = [
  { key: "new", label: "Nieuw", note: "Opname binnen, de werker leest hem in." },
  { key: "analyse", label: "Analyse", note: "De beste momenten worden gezocht." },
  { key: "concept", label: "Concept", note: "Het script wordt geschreven." },
  { key: "keur1", label: "Keuren: concept", note: "Jij keurt het script vóór de montage." },
  { key: "production", label: "Productie", note: "De montage wordt gemaakt." },
  { key: "keur2", label: "Klaar om te keuren", note: "Jij bekijkt de eindversie." },
  { key: "scheduled", label: "Goedgekeurd / ingepland", note: "Wacht op jouw klik om te publiceren, of staat ingepland." },
  { key: "live", label: "Live", note: "Staat op YouTube." },
];
const RANK: Record<Stage, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<Stage, number>;

export type BoardRecording = { id: string; label: string; status: string; error?: string | null; is_test: boolean; channel_id: string; created_at: string };
export type BoardVideo = { id: string; recording_id: string | null; format: Format; status: string; is_test: boolean; channel_id: string; created_at: string; promise?: string | null; review_note?: string | null; yt_video_moments?: { moment_id: string }[] };
export type BoardScript = { id: string; video_id: string; version: number; status: "draft" | "approved" | "rejected" };
export type BoardJob = { id: string; recording_id: string | null; video_id: string | null; step: string; status: string; error: string | null; created_at: string };
export type BoardCost = { video_id: string | null; job_id: string | null; amount_cents: number };
export type BoardMoment = { id: string; privacy_flags: PrivacyFlag[] };

export type BoardInput = { recordings: BoardRecording[]; videos: BoardVideo[]; scripts: BoardScript[]; jobs: BoardJob[]; costs: BoardCost[]; moments: BoardMoment[] };

export type Project = {
  key: string;
  title: string;
  channelId: string;
  stage: Stage;
  isTest: boolean;
  createdAt: string;
  longCount: number;
  shortCount: number;
  costCents: number;
  /** How many of its videos wait for Milan (concept or final version). */
  toReview: number;
  /** Why it is stuck; shown as a red badge. Empty when nothing blocks. */
  blocked: string[];
  /** Last reason Milan gave when sending something back. */
  sentBack: string | null;
  videoIds: string[];
};

export type ReviewItem = { kind: "concept"; videoId: string; scriptId: string } | { kind: "final"; videoId: string };

const STEP_NAME: Record<string, string> = { intake: "Intake", analyse: "Analyse", script: "Script", voiceover: "Stem", render: "Montage", upload: "Upload", publish: "Publiceren" };

/** The newest script version of a video and whether one is approved. */
function scriptState(videoId: string, scripts: BoardScript[]): { approved: BoardScript | null; latest: BoardScript | null } {
  const own = scripts.filter((s) => s.video_id === videoId).sort((a, b) => b.version - a.version);
  return { approved: own.find((s) => s.status === "approved") ?? null, latest: own[0] ?? null };
}

/** Where one video is in the pipeline, from its status and its scripts. */
export function videoStage(video: Pick<BoardVideo, "id" | "status">, scripts: BoardScript[]): Stage {
  if (video.status === "published") return "live";
  if (video.status === "approved" || video.status === "scheduled") return "scheduled";
  if (video.status === "review") return "keur2";
  if (video.status === "rendering") return "production";
  const { approved, latest } = scriptState(video.id, scripts);
  // A newer draft than the approved version (Milan asked for a new script) waits for Milan first.
  if (latest?.status === "draft" && (!approved || latest.version > approved.version)) return "keur1";
  if (approved) return "production";
  return "concept";
}

/** Newest job per step and target; a failed one is a reason the project is stuck. */
function failedJobs(jobs: BoardJob[]): string[] {
  const newest = new Map<string, BoardJob>();
  for (const j of jobs) {
    const key = `${j.step}:${j.video_id ?? j.recording_id ?? ""}`;
    const seen = newest.get(key);
    if (!seen || seen.created_at <= j.created_at) newest.set(key, j);
  }
  return [...newest.values()].filter((j) => j.status === "failed").map((j) => `${STEP_NAME[j.step] ?? j.step} mislukt${j.error ? `: ${j.error}` : ""}`);
}

export function buildProjects(input: BoardInput): Project[] {
  const flagsOf = new Map(input.moments.map((m) => [m.id, m.privacy_flags]));
  const groups = new Map<string, { recording: BoardRecording | null; videos: BoardVideo[] }>();
  for (const r of input.recordings) groups.set(`r:${r.id}`, { recording: r, videos: [] });
  for (const v of input.videos) {
    const key = v.recording_id && groups.has(`r:${v.recording_id}`) ? `r:${v.recording_id}` : `v:${v.id}`;
    if (!groups.has(key)) groups.set(key, { recording: null, videos: [] });
    groups.get(key)!.videos.push(v);
  }

  const projects: Project[] = [];
  for (const [key, { recording, videos }] of groups) {
    const videoIds = new Set(videos.map((v) => v.id));
    const jobs = input.jobs.filter((j) => (j.video_id && videoIds.has(j.video_id)) || (recording && j.recording_id === recording.id && !j.video_id));
    const jobIds = new Set(jobs.map((j) => j.id));
    const blocked = failedJobs(jobs);
    if (recording?.status === "failed") blocked.unshift(`Opname mislukt${recording.error ? `: ${recording.error}` : ""}`);

    let stage: Stage;
    if (videos.length > 0) {
      const active = videos.filter((v) => v.status !== "failed");
      const pool = active.length ? active : videos;
      stage = pool.map((v) => videoStage(v, input.scripts)).reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
      for (const v of videos) if (v.status === "failed") blocked.push(`${v.format === "C" ? "Lange video" : "Short"} mislukt`);
      const flags = new Set(videos.flatMap((v) => (v.yt_video_moments ?? []).flatMap((m) => flagsOf.get(m.moment_id) ?? [])));
      if (flags.has("face")) blocked.push("Er is een gezicht in beeld: deze video kan niet online.");
      if (flags.has("real_name")) blocked.push("Er is een echte naam te zien of te horen: eerst controleren.");
    } else if (!recording || recording.status === "uploading" || recording.status === "received" || recording.status === "failed") {
      stage = "new";
    } else {
      const analyse = jobs.filter((j) => j.step === "analyse").sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
      stage = analyse ? "analyse" : "new";
      if (analyse?.status === "done") blocked.push("De analyse vond geen bruikbaar moment.");
    }

    const reviewable = videos.filter((v) => v.status !== "failed").map((v) => videoStage(v, input.scripts));
    const first = videos[0];
    projects.push({
      key,
      title: recording?.label ?? first?.promise ?? "Video zonder opname",
      channelId: recording?.channel_id ?? first.channel_id,
      stage,
      isTest: recording ? recording.is_test : videos.every((v) => v.is_test),
      createdAt: recording?.created_at ?? first.created_at,
      longCount: videos.filter((v) => v.format === "C").length,
      shortCount: videos.filter((v) => v.format !== "C").length,
      costCents: input.costs.filter((c) => (c.video_id && videoIds.has(c.video_id)) || (c.job_id && jobIds.has(c.job_id))).reduce((sum, c) => sum + c.amount_cents, 0),
      toReview: reviewable.filter((s) => s === "keur1" || s === "keur2").length,
      blocked,
      sentBack: stage === "live" ? null : (videos.map((v) => v.review_note).find((n) => !!n) ?? null),
      videoIds: [...videoIds],
    });
  }
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Everything that waits for Milan, oldest first: concepts (Keur 1) and final versions (Keur 2). */
export function reviewQueue(videos: BoardVideo[], scripts: BoardScript[], channelId: string | null = null): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const v of [...videos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (v.status === "failed" || (channelId && v.channel_id !== channelId)) continue;
    const stage = videoStage(v, scripts);
    if (stage === "keur2") items.push({ kind: "final", videoId: v.id });
    else if (stage === "keur1") items.push({ kind: "concept", videoId: v.id, scriptId: scriptState(v.id, scripts).latest!.id });
  }
  return items;
}

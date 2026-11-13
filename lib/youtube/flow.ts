// ONE video = ONE status = ONE place (opschonen 13-11-2026). Every part of the Studio asks this file where a video
// belongs; no part keeps its own list. Order of the life of a video:
//   in productie (script -> voice-over -> montage) -> review -> klaar voor YouTube -> (bezig met uploaden) ->
//   ingepland -> live, plus the end states mislukt (with the reason) and gearchiveerd (concept afgewezen).
// As soon as a video is on YouTube it is "live" (or "ingepland") and shows up nowhere else. Pure functions, tested.
import { videoStage, type BoardJob, type BoardScript, type BoardVideo } from "./board";

export type Flow = "production" | "review" | "ready" | "uploading" | "scheduled" | "live" | "failed" | "archived";
export type Sub = "script" | "voiceover" | "montage";

export const FLOW: { key: Flow; label: string; icon: string; tone: string; dot: string }[] = [
  { key: "production", label: "In productie", icon: "⚙️", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  { key: "review", label: "Te keuren", icon: "👀", tone: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  { key: "ready", label: "Klaar voor YouTube", icon: "🚀", tone: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  { key: "uploading", label: "Bezig met uploaden", icon: "⏫", tone: "bg-cyan-50 text-cyan-900", dot: "bg-cyan-500" },
  { key: "scheduled", label: "Ingepland", icon: "🗓️", tone: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  { key: "live", label: "Live", icon: "✅", tone: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  { key: "failed", label: "Mislukt", icon: "❌", tone: "bg-red-100 text-red-800", dot: "bg-red-500" },
  { key: "archived", label: "Gearchiveerd", icon: "🗄️", tone: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
];
export const FLOW_OF: Record<Flow, (typeof FLOW)[number]> = Object.fromEntries(FLOW.map((f) => [f.key, f])) as Record<Flow, (typeof FLOW)[number]>;
export const SUB_LABEL: Record<Sub, string> = { script: "Script", voiceover: "Voice-over", montage: "Montage" };
export const SUBS: Sub[] = ["script", "voiceover", "montage"];

export type FlowPublication = {
  video_id: string;
  status: string;
  visibility: "private" | "unlisted" | "public";
  publish_at: string | null;
  youtube_video_id: string | null;
  title: string;
  error: string | null;
  updated_at?: string;
};
export type FlowVideo = BoardVideo & { youtube_video_id?: string | null; published_at?: string | null; scheduled_at?: string | null };
export type FlowJob = BoardJob & { phase?: string | null; progress?: number | string | null };

const UPLOADING = ["queued", "uploading", "processing"];
const MAIN_STEPS = ["intake", "analyse", "script", "render", "upload", "publish"];
const open = (j: { status: string }) => j.status === "queued" || j.status === "running";
const newest = <T extends { created_at: string }>(xs: T[]) => [...xs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

export type Place = { flow: Flow; sub: Sub | null; reviewKind: "concept" | "final" | null; reason: string | null; job: FlowJob | null };

/** Where one video belongs, from its status, scripts, publication and jobs. The single source of truth. */
export function placeOf(video: FlowVideo, scripts: BoardScript[], pub: FlowPublication | null, jobs: FlowJob[]): Place {
  const base = { sub: null, reviewKind: null, reason: null, job: null };
  if (video.status === "archived") return { ...base, flow: "archived" };
  // On YouTube (or on its way there) wins over everything else.
  if (pub && UPLOADING.includes(pub.status)) return { ...base, flow: "uploading" };
  if (pub?.status === "scheduled" || (video.status === "scheduled" && video.youtube_video_id)) return { ...base, flow: "scheduled" };
  if (video.youtube_video_id || pub?.youtube_video_id || video.status === "published" || pub?.status === "uploaded" || pub?.status === "published") return { ...base, flow: "live" };
  if (video.status === "failed") return { ...base, flow: "failed", reason: "De video is mislukt." };

  const stage = videoStage(video, scripts);
  if (stage === "scheduled") return { ...base, flow: "ready", reason: pub?.status === "failed" ? pub.error : null };
  if (stage === "keur2") return { ...base, flow: "review", reviewKind: "final" };
  if (stage === "keur1") return { ...base, flow: "review", reviewKind: "concept" };

  const own = jobs.filter((j) => j.video_id === video.id);
  const scriptJob = newest(own.filter((j) => j.step === "script"));
  const renderJob = newest(own.filter((j) => j.step === "render"));
  const ownScripts = scripts.filter((s) => s.video_id === video.id).sort((a, b) => b.version - a.version);
  const approved = ownScripts.find((s) => s.status === "approved") ?? null;
  // A concept Milan turned down without asking for a new one leads nowhere: archived, out of sight.
  if (!approved && ownScripts[0]?.status === "rejected" && !(scriptJob && open(scriptJob))) return { ...base, flow: "archived", reason: "Concept afgewezen" };

  if (!approved) {
    if (scriptJob?.status === "failed") return { ...base, flow: "failed", sub: "script", reason: `Script mislukt${scriptJob.error ? `: ${scriptJob.error}` : ""}`, job: scriptJob };
    return { ...base, flow: "production", sub: "script", job: scriptJob && open(scriptJob) ? scriptJob : null };
  }
  if (renderJob?.status === "failed" || renderJob?.status === "cancelled") return { ...base, flow: "failed", sub: "montage", reason: `Montage ${renderJob.status === "cancelled" ? "geannuleerd" : "mislukt"}${renderJob.error ? `: ${renderJob.error}` : ""}`, job: renderJob };
  const busy = renderJob && open(renderJob) ? renderJob : null;
  const voice = !!busy?.phase && /voice|stem/i.test(busy.phase);
  return { ...base, flow: "production", sub: voice ? "voiceover" : "montage", job: busy };
}

/** What YouTube shows (or will show) to viewers; Privé until Milan chose otherwise. */
export type Privacy = "private" | "unlisted" | "public" | "scheduled";
export const PRIVACY: Record<Privacy, { label: string; icon: string; tone: string }> = {
  private: { label: "Privé", icon: "🔒", tone: "bg-slate-100 text-slate-700" },
  unlisted: { label: "Niet vermeld", icon: "🔗", tone: "bg-orange-100 text-orange-800" },
  public: { label: "Openbaar", icon: "🌍", tone: "bg-emerald-100 text-emerald-800" },
  scheduled: { label: "Ingepland", icon: "🗓️", tone: "bg-sky-100 text-sky-800" },
};

export function privacyOf(p: Pick<FlowPublication, "status" | "visibility" | "publish_at"> | null): Privacy {
  if (!p) return "private";
  if (p.status === "scheduled" || (p.visibility === "private" && p.publish_at && p.status !== "published")) return "scheduled";
  return p.visibility;
}

export type FlowItem = {
  videoId: string;
  channelId: string;
  title: string;
  kind: "short" | "long";
  flow: Flow;
  sub: Sub | null;
  reviewKind: "concept" | "final" | null;
  reason: string | null;
  /** Progress 0-1 of the current step when the worker measured it. */
  progress: number | null;
  phase: string | null;
  /** 1 = the worker is on it now; 2 = next; null = not waiting. */
  queuePos: number | null;
  privacy: Privacy;
  publishAt: string | null;
  /** When it went (or goes) public, for sorting and grouping the live list. */
  liveAt: string | null;
  youtubeId: string | null;
  isTest: boolean;
  createdAt: string;
  error: string | null;
};

/** The worker's main lane in order: running first, then the oldest queued step. */
function queueOrder(jobs: FlowJob[]): string[] {
  const main = jobs.filter((j) => MAIN_STEPS.includes(j.step) && open(j));
  return [...main.filter((j) => j.status === "running"), ...main.filter((j) => j.status === "queued").sort((a, b) => a.created_at.localeCompare(b.created_at))].map((j) => j.id);
}

/** One item per video, newest first; the order depends only on when the video was made, never on its status. */
export function buildFlow(videos: FlowVideo[], scripts: BoardScript[], publications: FlowPublication[], titleOf: (v: BoardVideo) => string, jobs: FlowJob[] = []): FlowItem[] {
  const pubOf = new Map(publications.map((p) => [p.video_id, p]));
  const order = queueOrder(jobs);
  return videos
    .map((v) => {
      const p = pubOf.get(v.id) ?? null;
      const place = placeOf(v, scripts, p, jobs);
      const pos = place.job ? order.indexOf(place.job.id) : -1;
      const progress = place.job?.progress == null ? null : Number(place.job.progress);
      return {
        videoId: v.id,
        channelId: v.channel_id,
        title: p?.title || titleOf(v),
        kind: v.format === "C" ? ("long" as const) : ("short" as const),
        flow: place.flow,
        sub: place.sub,
        reviewKind: place.reviewKind,
        reason: place.reason,
        progress: Number.isFinite(progress) ? progress : null,
        phase: place.job?.status === "running" ? (place.job.phase ?? null) : null,
        queuePos: pos >= 0 ? pos + 1 : null,
        privacy: privacyOf(p),
        publishAt: p?.publish_at ?? v.scheduled_at ?? null,
        liveAt: p?.publish_at && place.flow === "scheduled" ? p.publish_at : (v.published_at ?? p?.updated_at ?? null),
        youtubeId: p?.youtube_video_id ?? v.youtube_video_id ?? null,
        isTest: v.is_test,
        createdAt: v.created_at,
        error: place.flow === "ready" ? place.reason : null,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.videoId.localeCompare(b.videoId));
}

export function countFlow(items: FlowItem[]): Record<Flow, number> {
  const out = Object.fromEntries(FLOW.map((f) => [f.key, 0])) as Record<Flow, number>;
  for (const i of items) out[i.flow]++;
  return out;
}

/** Everything that waits for Milan himself: to review, to send to YouTube, or failed. */
export const needsAction = (i: Pick<FlowItem, "flow">) => i.flow === "review" || i.flow === "ready" || i.flow === "failed";

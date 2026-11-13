// The five statuses Milan sees on every video card (fase 1.2): In productie -> Review nodig -> Klaar voor YouTube ->
// Bezig met uploaden -> Live. Built from the video, its scripts and its publication. Pure functions, tested.
import { videoStage, type BoardScript, type BoardVideo } from "./board";

export type Flow = "production" | "review" | "ready" | "uploading" | "live";

export const FLOW: { key: Flow; label: string; icon: string; tone: string; dot: string }[] = [
  { key: "production", label: "In productie", icon: "⚙️", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  { key: "review", label: "Review nodig", icon: "👀", tone: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  { key: "ready", label: "Klaar voor YouTube", icon: "🚀", tone: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  { key: "uploading", label: "Bezig met uploaden", icon: "⏫", tone: "bg-cyan-50 text-cyan-900", dot: "bg-cyan-500" },
  { key: "live", label: "Live", icon: "✅", tone: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
];
export const FLOW_OF: Record<Flow, (typeof FLOW)[number]> = Object.fromEntries(FLOW.map((f) => [f.key, f])) as Record<Flow, (typeof FLOW)[number]>;

export type FlowPublication = {
  video_id: string;
  status: string;
  visibility: "private" | "unlisted" | "public";
  publish_at: string | null;
  youtube_video_id: string | null;
  title: string;
  error: string | null;
};

const UPLOADING = ["queued", "uploading", "processing"];
const ON_YOUTUBE = ["uploaded", "scheduled", "published"];

export function flowOf(video: Pick<BoardVideo, "id" | "status">, scripts: BoardScript[], publication: FlowPublication | null): Flow {
  if (publication && UPLOADING.includes(publication.status)) return "uploading";
  if (publication && (ON_YOUTUBE.includes(publication.status) || (publication.status === "failed" && publication.youtube_video_id))) return "live";
  if (video.status === "published") return "live";
  const stage = videoStage(video, scripts);
  if (stage === "scheduled") return "ready";
  if (stage === "keur1" || stage === "keur2") return "review";
  return "production";
}

/** What YouTube shows (or will show) to viewers; null while nothing is on YouTube and nothing is chosen. */
export type Privacy = "private" | "unlisted" | "public" | "scheduled";
export const PRIVACY: Record<Privacy, { label: string; icon: string; tone: string }> = {
  private: { label: "Privé", icon: "🔒", tone: "bg-slate-100 text-slate-700" },
  unlisted: { label: "Niet vermeld", icon: "🔗", tone: "bg-orange-100 text-orange-800" },
  public: { label: "Openbaar", icon: "🌍", tone: "bg-emerald-100 text-emerald-800" },
  scheduled: { label: "Ingepland", icon: "🗓️", tone: "bg-sky-100 text-sky-800" },
};

export function privacyOf(p: Pick<FlowPublication, "status" | "visibility" | "publish_at"> | null): Privacy {
  if (!p) return "private";
  if (p.status === "scheduled" || (p.visibility === "private" && p.publish_at)) return "scheduled";
  return p.visibility;
}

export type FlowItem = {
  videoId: string;
  channelId: string;
  title: string;
  kind: "short" | "long";
  flow: Flow;
  privacy: Privacy;
  publishAt: string | null;
  youtubeId: string | null;
  isTest: boolean;
  createdAt: string;
  error: string | null;
};

/** One item per video, newest first; the order depends only on when the video was made, never on its status. */
export function buildFlow(videos: BoardVideo[], scripts: BoardScript[], publications: FlowPublication[], titleOf: (v: BoardVideo) => string): FlowItem[] {
  const pubOf = new Map(publications.map((p) => [p.video_id, p]));
  return videos
    .filter((v) => v.status !== "failed")
    .map((v) => {
      const p = pubOf.get(v.id) ?? null;
      return {
        videoId: v.id,
        channelId: v.channel_id,
        title: p?.title || titleOf(v),
        kind: v.format === "C" ? ("long" as const) : ("short" as const),
        flow: flowOf(v, scripts, p),
        privacy: privacyOf(p),
        publishAt: p?.publish_at ?? null,
        youtubeId: p?.youtube_video_id ?? null,
        isTest: v.is_test,
        createdAt: v.created_at,
        error: p?.status === "failed" ? p.error : null,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.videoId.localeCompare(b.videoId));
}

export function countFlow(items: FlowItem[]): Record<Flow, number> {
  const out = { production: 0, review: 0, ready: 0, uploading: 0, live: 0 } as Record<Flow, number>;
  for (const i of items) out[i.flow]++;
  return out;
}

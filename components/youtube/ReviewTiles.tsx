"use client";

import { CheckCircle2, FileText, Gauge } from "lucide-react";
import { Button } from "@/components/ui/Dialog";
import type { FlowState } from "@/lib/youtube/flowData";
import type { FlowItem } from "@/lib/youtube/flow";
import { formatTimecode } from "@/lib/youtube/analysis";
import { WORKER_URL } from "@/lib/youtube/protocol";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
const scoreTone = (n: number) => (n >= 8 ? "bg-emerald-100 text-emerald-800" : n >= 6 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800");

/**
 * Te keuren as tiles (opschonen 13-11-2026): one tile per video that waits for Milan, newest first. Picture, title,
 * Short or long, concept (script) or final version, the Viral-score, and two buttons: Keuren opens the review mode
 * at this video, Details opens everything (preview, score, script, montage) in a window.
 */
export function ReviewTiles({ state, channel, workerOnline, onReview, onDetails }: { state: Ready; channel: string | null; workerOnline: boolean; onReview: (videoId: string) => void; onDetails: (videoId: string) => void }) {
  const items = state.items.filter((i) => i.flow === "review" && (!channel || i.channelId === channel));
  if (!items.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((i) => (
        <Tile key={i.videoId} item={i} state={state} workerOnline={workerOnline} onReview={() => onReview(i.videoId)} onDetails={() => onDetails(i.videoId)} />
      ))}
    </ul>
  );
}

function Tile({ item, state, workerOnline, onReview, onDetails }: { item: FlowItem; state: Ready; workerOnline: boolean; onReview: () => void; onDetails: () => void }) {
  const video = state.board.input.videos.find((v) => v.id === item.videoId);
  const recording = state.board.input.recordings.find((r) => r.id === video?.recording_id);
  const render = item.reviewKind === "final" ? (state.board.renders.find((r) => r.video_id === item.videoId) ?? null) : null;
  const thumb = (render as { thumbnails?: { file: string }[] } | null)?.thumbnails?.[0]?.file ?? null;
  const score = state.scores[item.videoId];
  const script = state.board.scripts.find((s) => s.video_id === item.videoId && s.status !== "rejected");
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-[var(--shadow-card)]">
      {/* Fixed 16:9 picture: every tile has the same height before images arrive. Only a JPG, never a video. */}
      <div className="relative aspect-video w-full bg-[#0b1120]">
        {item.reviewKind === "concept" ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-xs text-slate-300">
            <FileText className="h-6 w-6" aria-hidden />
            <span className="line-clamp-3">{script?.hook ?? "Nieuw script"}</span>
          </span>
        ) : workerOnline && thumb ? (
          <img src={`${WORKER_URL}/renders/${encodeURIComponent(thumb)}`} crossOrigin="anonymous" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">{render ? (workerOnline ? "Geen thumbnail" : "Start de werker voor het beeld") : "Nog geen montage"}</span>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {item.kind === "short" ? "Short" : "Lang"}
          {render ? ` · ${formatTimecode(render.duration_ms)}` : ""}
        </span>
        {score !== undefined && item.reviewKind === "final" && (
          <span className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${scoreTone(score)}`} title="Viral-score: een voorspelling, geen garantie">
            <Gauge className="h-3.5 w-3.5" aria-hidden /> {score.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.reviewKind === "concept" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>{item.reviewKind === "concept" ? "📝 Script keuren" : "🎬 Eindversie keuren"}</span>
        <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold">{item.title}</p>
        <p className="truncate text-xs text-slate-500">
          {recording?.label ?? "Zonder opname"}
          {item.isTest ? " · test" : ""}
        </p>
        <div className="mt-auto flex gap-2">
          <Button onClick={onReview} className="min-h-10 flex-1 justify-center">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Keuren
          </Button>
          <Button variant="secondary" onClick={onDetails} className="min-h-10">
            Details
          </Button>
        </div>
      </div>
    </li>
  );
}

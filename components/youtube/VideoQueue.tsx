"use client";

import { ChevronDown, ExternalLink, Rocket } from "lucide-react";
import { useState } from "react";
import { FlowBadge, PrivacyBadge } from "@/components/youtube/FlowBadges";
import { PublishPanel } from "@/components/youtube/PublishPanel";
import { formatTimecode } from "@/lib/youtube/analysis";
import type { FlowState } from "@/lib/youtube/flowData";
import type { Flow, FlowItem } from "@/lib/youtube/flow";
import { WORKER_URL } from "@/lib/youtube/protocol";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * One card per video for "Klaar voor YouTube" and "Live" (fase 1.1): thumbnail, title, channel, status and privacy,
 * and the big "Naar YouTube sturen" button. The details (the publication form) open only after a click.
 * Cards keep their place: the order is the creation time of the video, never its status.
 */
export function VideoQueue({ state, flows, channel, workerOnline, studioId, empty, onOpenProduction, startOpen = false }: { state: Ready; flows: Flow[]; channel: string | null; workerOnline: boolean; studioId: string; empty: string; onOpenProduction: () => void; startOpen?: boolean }) {
  const [open, setOpen] = useState<string | null>(startOpen ? (state.items[0]?.videoId ?? null) : null);
  const items = state.items.filter((i) => flows.includes(i.flow) && (!channel || i.channelId === channel));
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <VideoCard key={item.videoId} item={item} state={state} open={open === item.videoId} onToggle={() => setOpen(open === item.videoId ? null : item.videoId)} workerOnline={workerOnline} studioId={studioId} onOpenProduction={onOpenProduction} />
      ))}
    </ul>
  );
}

function VideoCard({ item, state, open, onToggle, workerOnline, studioId, onOpenProduction }: { item: FlowItem; state: Ready; open: boolean; onToggle: () => void; workerOnline: boolean; studioId: string; onOpenProduction: () => void }) {
  const board = state.board;
  const channel = board.channels.find((c) => c.id === item.channelId);
  const video = board.input.videos.find((v) => v.id === item.videoId) as (typeof board.input.videos)[number] & { language?: "en" | "nl" };
  const render = board.renders.find((r) => r.video_id === item.videoId) ?? null;
  const approved = board.scripts.find((s) => s.video_id === item.videoId && s.status === "approved") ?? null;
  const thumb = (render as { thumbnails?: { file: string }[] } | null)?.thumbnails?.[0]?.file ?? null;
  const panelId = `publish-${item.videoId}`;
  return (
    <li className="overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-[var(--shadow-card)]" style={{ borderLeft: `4px solid ${channel?.brand_color ?? "#cbd5e1"}` }}>
      <div className="grid gap-3 p-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {/* Fixed 16:9 box: the card has its final height before the image arrives. */}
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-[#0b1120]">
          {workerOnline && thumb ? (
            <img src={`${WORKER_URL}/renders/${encodeURIComponent(thumb)}`} crossOrigin="anonymous" alt="" className="absolute inset-0 h-full w-full object-contain" />
          ) : workerOnline && render ? (
            <video src={`${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}#t=0.5`} crossOrigin="anonymous" muted playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-slate-400">{render ? "Start de werker voor het beeld" : "Nog geen montage"}</span>
          )}
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{item.kind === "short" ? "Short" : "Lang"}{render ? ` · ${formatTimecode(render.duration_ms)}` : ""}</span>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <FlowBadge flow={item.flow} />
            <PrivacyBadge privacy={item.privacy} />
            {item.isTest && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">testvideo</span>}
          </div>
          <p className="line-clamp-2 font-semibold">{item.title}</p>
          <p className="text-xs text-slate-500">
            {channel?.name ?? "Kanaal onbekend"}
            {item.privacy === "scheduled" && item.publishAt ? ` · openbaar op ${when(item.publishAt)}` : ""}
          </p>
          {item.error && <p className="text-xs text-red-700 [overflow-wrap:anywhere]">Laatste fout: {item.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {item.flow === "ready" ? (
              <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm hover:bg-amber-400">
                <Rocket className="h-4 w-4" aria-hidden /> {open ? "Sluiten" : "Naar YouTube sturen"}
              </button>
            ) : (
              <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                {item.flow === "uploading" ? "Voortgang" : "Zichtbaarheid en details"} <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
            )}
            {item.youtubeId && (
              <a href={`https://youtu.be/${item.youtubeId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-cyan-700 underline underline-offset-2">
                Bekijk op YouTube <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
      </div>
      {open && video && (
        <div id={panelId} className="border-t border-slate-200 px-3 pb-3">
          <PublishPanel
            studioId={studioId}
            videoId={item.videoId}
            kind={item.kind}
            language={video.language ?? channel?.language ?? "en"}
            hook={approved?.hooks?.[approved.chosen_hook ?? -1] ?? null}
            renderId={render?.id ?? null}
            renderFile={render?.file_name ?? null}
            renderMs={render?.duration_ms ?? null}
            workerOnline={workerOnline}
            onWatch={onOpenProduction}
            renderLabel={render ? `${new Date(render.created_at).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Amsterdam" })}, ${formatTimecode(render.duration_ms)}, ${render.width}×${render.height}` : null}
          />
        </div>
      )}
    </li>
  );
}

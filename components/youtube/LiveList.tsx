"use client";

import { ChevronDown, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PrivacyBadge } from "@/components/youtube/FlowBadges";
import { VideoQueue } from "@/components/youtube/VideoQueue";
import { TIKTOK_LABEL, useTikTok } from "@/components/youtube/useTikTok";
import type { FlowState } from "@/lib/youtube/flowData";
import { WORKER_URL } from "@/lib/youtube/protocol";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
const PAGE = 10;
const monthOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", month: "long", year: "numeric" }) : "Onbekend");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short" }) : "–");

/**
 * Live op YouTube (opschonen 13-11-2026): compact and in order. Filter per channel (top bar) and type, a search
 * field, grouped per month (newest first, foldable), the newest 10 first with "Meer laden". One row per video with
 * thumbnail, title, date, views and the link; "Details" opens the visibility settings.
 */
export function LiveList({ state, channel, workerOnline, studioId, onOpenProduction }: { state: Ready; channel: string | null; workerOnline: boolean; studioId: string; onOpenProduction: () => void }) {
  const [kind, setKind] = useState<"all" | "short" | "long">("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // 24-11-2026: Shorts that were already live before TikTok was connected go to the TikTok inbox with one click.
  const tiktok = useTikTok(workerOnline);
  const [ttBusy, setTtBusy] = useState<string | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const toTikTok = async (videoId: string) => {
    setTtBusy(videoId);
    setTtError(null);
    try {
      await tiktok.send(videoId);
    } catch (e) {
      setTtError(e instanceof Error ? e.message : String(e));
    } finally {
      setTtBusy(null);
    }
  };
  const items = useMemo(
    () =>
      state.items
        .filter((i) => i.flow === "live" && (!channel || i.channelId === channel) && (kind === "all" || i.kind === kind) && (!query.trim() || i.title.toLowerCase().includes(query.trim().toLowerCase())))
        .sort((a, b) => (b.liveAt ?? b.createdAt).localeCompare(a.liveAt ?? a.createdAt)),
    [state.items, channel, kind, query],
  );
  const page = items.slice(0, shown);
  const months = [...new Set(page.map((i) => monthOf(i.liveAt)))];
  const thumbOf = (videoId: string) => {
    const r = state.board.renders.find((x) => x.video_id === videoId) as { thumbnails?: { file: string }[] } | undefined;
    return r?.thumbnails?.[0]?.file ?? null;
  };
  const total = state.items.filter((i) => i.flow === "live" && (!channel || i.channelId === channel)).length;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">✅ Live op YouTube ({total})</h2>
        <div role="group" aria-label="Soort video" className="flex overflow-hidden rounded-md border border-slate-300 text-xs">
          {(["all", "short", "long"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => (setKind(k), setShown(PAGE))} className={`px-2.5 py-1 ${kind === k ? "bg-cyan-50 font-semibold text-cyan-900" : "hover:bg-slate-50"}`}>
              {k === "all" ? "Alles" : k === "short" ? "Shorts" : "Lang"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-xs">
          <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <input value={query} onChange={(e) => (setQuery(e.target.value), setShown(PAGE))} placeholder="Zoeken op titel" aria-label="Zoeken op titel" className="w-32 bg-transparent outline-none sm:w-44" />
        </label>
      </div>
      {ttError && <p className="text-sm text-red-700">TikTok: {ttError}</p>}
      {tiktok.connected && kind !== "long" && <p className="text-xs text-slate-500">&quot;Naar TikTok&quot; zet een Short als concept in je TikTok-inbox; publiceren doe je zelf in de TikTok-app. TikTok neemt er per dag maar een paar aan: de rest wacht en gaat later vanzelf.</p>}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{total ? "Niets gevonden met dit filter." : "Nog niets op YouTube."}</p>
      ) : (
        <div className="space-y-3">
          {months.map((m) => {
            const rows = page.filter((i) => monthOf(i.liveAt) === m);
            const folded = closed.has(m);
            return (
              <div key={m}>
                <button type="button" onClick={() => setClosed((s) => (s.has(m) ? new Set([...s].filter((x) => x !== m)) : new Set([...s, m])))} aria-expanded={!folded} className="flex w-full items-center gap-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${folded ? "-rotate-90" : ""}`} aria-hidden /> {m} <span className="font-normal normal-case">({rows.length})</span>
                </button>
                {!folded && (
                  <ul className="divide-y divide-slate-100">
                    {rows.map((i) => {
                      const thumb = thumbOf(i.videoId);
                      const views = i.youtubeId ? state.views[i.youtubeId] : undefined;
                      return (
                        <li key={i.videoId} className="py-2">
                          <div className="flex items-center gap-3">
                            {/* Fixed 16:9 thumbnail box. */}
                            <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-[#0b1120]">
                              {workerOnline && thumb && <img src={`${WORKER_URL}/renders/${encodeURIComponent(thumb)}`} crossOrigin="anonymous" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-1 text-sm font-medium">{i.title}</p>
                              <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                <span>{day(i.liveAt)}</span>
                                <span>{i.kind === "short" ? "Short" : "Lang"}</span>
                                <span className="tabular-nums">{views !== undefined ? `${views.toLocaleString("nl-NL")} views` : "views volgen"}</span>
                                <PrivacyBadge privacy={i.privacy} />
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
                              {i.youtubeId && (
                                <a href={`https://youtu.be/${i.youtubeId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-cyan-700 underline underline-offset-2">
                                  YouTube <ExternalLink className="h-3 w-3" aria-hidden />
                                </a>
                              )}
                              {tiktok.connected && i.kind === "short" &&
                                (tiktok.sent[i.videoId] && tiktok.sent[i.videoId] !== "mislukt" ? (
                                  <span className="text-emerald-700">{TIKTOK_LABEL[tiktok.sent[i.videoId]] ?? tiktok.sent[i.videoId]}</span>
                                ) : (
                                  <button type="button" disabled={ttBusy === i.videoId} onClick={() => void toTikTok(i.videoId)} className="rounded-md bg-ink px-2 py-1 font-medium text-ink-fg disabled:opacity-50">
                                    {ttBusy === i.videoId ? "Bezig…" : tiktok.sent[i.videoId] === "mislukt" ? "Opnieuw naar TikTok" : "Naar TikTok"}
                                  </button>
                                ))}
                              <button type="button" onClick={() => setOpen(open === i.videoId ? null : i.videoId)} aria-expanded={open === i.videoId} className="text-slate-600 underline underline-offset-2">
                                {open === i.videoId ? "Sluiten" : "Details"}
                              </button>
                            </div>
                          </div>
                          {open === i.videoId && (
                            <div className="mt-2">
                              <VideoQueue state={{ ...state, items: state.items.filter((x) => x.videoId === i.videoId) }} flows={["live"]} channel={null} workerOnline={workerOnline} studioId={studioId} onOpenProduction={onOpenProduction} empty="" startOpen />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {items.length > shown && (
            <button type="button" onClick={() => setShown(shown + PAGE)} className="w-full rounded-md border border-slate-300 py-2 text-sm hover:bg-slate-50">
              Meer laden ({items.length - shown} over)
            </button>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { Archive, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Dialog";
import { FlowBadge } from "@/components/youtube/FlowBadges";
import { archiveVideo, restoreVideo } from "@/lib/youtube/analysisData";
import type { FlowState } from "@/lib/youtube/flowData";
import { SUB_LABEL, SUBS, type FlowItem } from "@/lib/youtube/flow";
import { retryJob } from "@/lib/youtube/studio";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
type Act = (a: () => Promise<unknown>) => Promise<void>;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * In productie (opschonen 13-11-2026): this IS the pipeline. One card per video with a bar through the sub steps
 * script -> voice-over -> montage, the current step and its place in the worker's queue. The old board and the
 * separate render queue are gone: a montage is a sub step here.
 */
export function ProductionList({ state, channel, onOpenAction }: { state: Ready; channel: string | null; onOpenAction: () => void }) {
  const items = state.items.filter((i) => i.flow === "production" && (!channel || i.channelId === channel));
  // Recordings the worker is still reading or analysing: they do not have videos yet.
  const analysing = state.board.input.recordings.filter((r) => (!channel || r.channel_id === channel) && !state.board.input.videos.some((v) => v.recording_id === r.id) && (r.status === "uploading" || r.status === "received" || state.board.jobs.some((j) => j.recording_id === r.id && j.step === "analyse" && (j.status === "queued" || j.status === "running"))));
  if (!items.length && !analysing.length)
    return (
      <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
        Er wordt nu niets gemaakt. Upload een opname om te beginnen; wat op jou wacht staat bij{" "}
        <button type="button" onClick={onOpenAction} className="underline underline-offset-2">
          Actie nodig
        </button>
        .
      </p>
    );
  return (
    <ul className="space-y-2">
      {analysing.map((r) => {
        const j = state.board.jobs.find((x) => x.recording_id === r.id && x.step === "analyse" && (x.status === "queued" || x.status === "running"));
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-surface p-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{r.label}</span>
              <span className="block text-xs text-slate-500">Opname · {j?.status === "running" ? (j.phase ?? "wordt geanalyseerd") : j ? "wacht op analyse" : "wordt ingelezen"}</span>
            </span>
            {j?.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-cyan-600" aria-hidden />}
          </li>
        );
      })}
      {items.map((i) => (
        <ProductionCard key={i.videoId} item={i} channelName={state.board.channels.find((c) => c.id === i.channelId)?.name ?? ""} />
      ))}
    </ul>
  );
}

function ProductionCard({ item, channelName }: { item: FlowItem; channelName: string }) {
  const at = item.sub ? SUBS.indexOf(item.sub) : 0;
  const running = item.queuePos === 1;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-surface p-3 text-sm shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-1 font-medium">{item.title}</p>
          <p className="text-xs text-slate-500">
            {item.kind === "short" ? "Short" : "Lange video"} · {channelName}
            {item.isTest ? " · test" : ""}
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${running ? "bg-cyan-50 text-cyan-900" : item.queuePos ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-900"}`}>
          {running ? "Bezig" : item.queuePos ? `Nr. ${item.queuePos} in de rij` : item.sub === "script" ? "Wacht op script" : "Wacht op montage"}
        </span>
      </div>
      {/* Three sub steps; the current one fills with the measured progress. Fixed height: nothing jumps. */}
      <ol className="grid grid-cols-3 gap-1" aria-label="Voortgang">
        {SUBS.map((s, k) => (
          <li key={s} className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded bg-slate-200">
              <div className={`h-full ${k < at ? "bg-emerald-500" : k === at ? "bg-cyan-500" : ""}`} style={{ width: k < at ? "100%" : k === at ? (running && item.progress !== null ? pct(item.progress) : running ? "35%" : "0%") : "0%" }} />
            </div>
            <p className={`text-[11px] ${k === at ? "font-semibold text-slate-800" : "text-slate-500"}`}>{SUB_LABEL[s]}</p>
          </li>
        ))}
      </ol>
      <p className="h-4 text-xs text-slate-600">{running ? `${item.phase ?? "Bezig"}${item.progress !== null ? ` · ${pct(item.progress)}` : ""}` : item.queuePos ? "Wacht tot de werker klaar is met de vorige stap." : "Nog niet gestart."}</p>
    </li>
  );
}

/** Mislukt: one row per video with the reason, "Opnieuw proberen" for the failed step and "Archiveren". */
export function FailedList({ state, channel, act }: { state: Ready; channel: string | null; act: Act }) {
  const items = state.items.filter((i) => i.flow === "failed" && (!channel || i.channelId === channel));
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const job = [...state.board.jobs].reverse().find((j) => j.video_id === i.videoId && (j.status === "failed" || j.status === "cancelled"));
        return (
          <li key={i.videoId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                <FlowBadge flow="failed" /> {i.title}
              </span>
              <span className="mt-0.5 block text-xs text-red-800 [overflow-wrap:anywhere]">{i.reason}</span>
            </span>
            <span className="flex gap-2">
              {job && (
                <Button variant="secondary" onClick={() => void act(() => retryJob(job.id))}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Opnieuw proberen
                </Button>
              )}
              <Button variant="ghost" onClick={() => void act(() => archiveVideo(i.videoId))}>
                <Archive className="h-4 w-4" aria-hidden /> Archiveren
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Instellingen: archived videos, out of every list but never deleted; "Terugzetten" brings one back. */
export function ArchivedList({ state, act }: { state: Ready; act: Act }) {
  const items = state.items.filter((i) => i.flow === "archived");
  return (
    <details className="rounded-xl border border-slate-200 bg-surface p-4 shadow-[var(--shadow-card)]">
      <summary className="cursor-pointer text-sm font-semibold">🗄️ Gearchiveerd ({items.length})</summary>
      <p className="mt-1 text-xs text-slate-500">Afgewezen concepten en video&apos;s die je archiveerde. Ze staan nergens anders meer, maar zijn niet verwijderd.</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Niets gearchiveerd.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {items.map((i) => (
            <li key={i.videoId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0">
                {i.title}
                <span className="ml-2 text-xs text-slate-500">
                  {i.kind === "short" ? "Short" : "Lang"}
                  {i.reason ? ` · ${i.reason}` : ""}
                </span>
              </span>
              <Button variant="ghost" onClick={() => void act(() => restoreVideo(i.videoId))}>
                Terugzetten
              </Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

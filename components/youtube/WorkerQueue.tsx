"use client";

import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Dialog";
import type { FlowState } from "@/lib/youtube/flowData";
import { retryJob } from "@/lib/youtube/studio";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
type Act = (a: () => Promise<unknown>) => Promise<void>;
type Job = {
  id: string; step: string; status: string; video_id: string | null; recording_id: string | null; created_at: string;
  started_at?: string | null; finished_at?: string | null; heartbeat_at?: string | null; phase?: string | null; progress?: number | string | null;
  attempts?: number; max_attempts?: number; error?: string | null; payload?: { script_id?: string; version?: number; mode?: string; auto_retry?: number; qc_retry?: number } | null;
};

const STEP: Record<string, string> = { intake: "Inlezen", analyse: "Analyse", script: "Script", render: "Montage", upload: "Upload", publish: "Publiceren", suggest: "Suggesties", viral: "Viral-check", reference: "Referenties", insight: "Inzichten", assistant: "Ivar" };
/** Without a sign of life for this long, a running step needs attention (the worker marks it failed after 2 hours). */
const QUIET_MS = 5 * 60_000;
const ago = (iso: string | null | undefined, now: number) => {
  if (!iso) return "–";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} uur`;
};

/**
 * Wachtrij van de werker (23-11-2026): per step the channel, project (recording), video, version, the step and its
 * phase, how long it runs or waits, the last real sign of life and the error. A percentage only when the worker measured
 * one. "Opnieuw proberen" only when it is safe: the step failed or was cancelled and nothing else runs for that video.
 */
export function WorkerQueue({ state, channel, act }: { state: Ready; channel: string | null; act: Act }) {
  const b = state.board;
  const now = Date.now();
  const jobs = b.jobs as unknown as Job[];
  const videoOf = (j: Job) => (j.video_id ? b.input.videos.find((v) => v.id === j.video_id) : undefined);
  const recOf = (j: Job) => b.input.recordings.find((r) => r.id === (j.recording_id ?? videoOf(j)?.recording_id));
  const channelOf = (j: Job) => videoOf(j)?.channel_id ?? recOf(j)?.channel_id ?? null;
  const name = (id: string | null) => b.channels.find((c) => c.id === id)?.name ?? "–";
  const title = (j: Job) => (j.video_id ? (state.items.find((i) => i.videoId === j.video_id)?.title ?? "Video") : (recOf(j)?.label ?? "Opname"));
  const version = (j: Job) => (j.payload?.version ? `v${j.payload.version}` : j.payload?.script_id ? `v${b.scripts.find((s) => s.id === j.payload!.script_id)?.version ?? "?"}` : "");
  const mine = (j: Job) => !channel || channelOf(j) === channel;

  const open = jobs.filter((j) => (j.status === "running" || j.status === "queued") && j.step !== "assistant" && mine(j));
  const running = open.filter((j) => j.status === "running");
  const queued = open.filter((j) => j.status === "queued").sort((x, y) => x.created_at.localeCompare(y.created_at));
  // One worker for all channels: the real place counts the steps of every channel (oldest first).
  const all = jobs.filter((j) => j.status === "queued" && j.step !== "assistant").sort((x, y) => x.created_at.localeCompare(y.created_at));
  const placeOf = (j: Job) => all.findIndex((x) => x.id === j.id) + 1;
  const others = queued.length ? placeOf(queued[0]) - 1 : 0;
  const since = now - 24 * 3_600_000;
  const failed = jobs
    .filter((j) => (j.status === "failed" || j.status === "cancelled") && j.step !== "assistant" && mine(j) && Date.parse(j.finished_at ?? j.created_at) > since)
    .filter((j) => !jobs.some((o) => o.id !== j.id && o.video_id === j.video_id && o.step === j.step && (o.status === "queued" || o.status === "running" || (o.status === "done" && o.created_at > j.created_at))))
    .sort((x, y) => (y.finished_at ?? "").localeCompare(x.finished_at ?? ""));

  const head = (j: Job) => (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">
        {STEP[j.step] ?? j.step} · {title(j)} {version(j) && <span className="font-normal text-slate-500">{version(j)}</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {name(channelOf(j))} · project: {recOf(j)?.label ?? "–"}
        {j.payload?.mode ? ` · ${j.payload.mode === "gericht" ? "gerichte correctie" : "volledig opnieuw"}` : j.payload?.auto_retry ? " · vanzelf opnieuw gestart" : j.payload?.qc_retry ? " · tweede poging na kwaliteitscontrole" : ""}
      </span>
    </span>
  );

  return (
    <div className="space-y-3 text-sm">
      {running.map((j) => {
        const quiet = now - Date.parse(j.heartbeat_at ?? j.started_at ?? j.created_at) > QUIET_MS;
        const pct = j.progress == null ? null : Number(j.progress);
        return (
          <div key={j.id} className={`rounded-lg border p-3 ${quiet ? "border-amber-300 bg-amber-50" : "border-cyan-200 bg-cyan-50"}`}>
            <div className="flex items-start gap-2">
              {quiet ? <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" aria-hidden /> : <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-cyan-700" aria-hidden />}
              {head(j)}
            </div>
            <p className="mt-1 text-xs text-slate-700">
              Nu: {j.phase ?? "bezig"} · loopt {ago(j.started_at ?? j.created_at, now)} · laatste teken van leven {ago(j.heartbeat_at ?? j.started_at, now)} geleden
              {pct !== null && Number.isFinite(pct) && pct > 0 ? ` · ${Math.round(pct * 100)}% (gemeten door de werker)` : ""}
              {j.attempts && j.max_attempts ? ` · poging ${j.attempts} van ${j.max_attempts}` : ""}
            </p>
            <p className="mt-1 text-xs font-medium">{quiet ? "Heeft je aandacht nodig: al een tijd geen voortgang. Na 2 uur zonder teken van leven zet de werker hem zelf op mislukt." : "De werker is hier nu mee bezig."}</p>
          </div>
        );
      })}
      {queued.length > 0 && channel && others > 0 && <p className="text-xs text-slate-600">Eerst nog {others} {others === 1 ? "stap" : "stappen"} van andere kanalen: de werker doet alle kanalen in één rij, oudste eerst.</p>}
      {queued.length > 0 && (
        <ol className="divide-y divide-slate-200">
          {queued.map((j) => (
            <li key={j.id} className="flex items-center gap-2 py-2">
              <span className="w-10 shrink-0 text-center tabular-nums text-slate-600" title={`Plek ${placeOf(j)} in de rij van de werker`}>{placeOf(j)}.</span>
              {head(j)}
              <span className="shrink-0 text-xs text-slate-500">wacht {ago(j.created_at, now)}</span>
            </li>
          ))}
        </ol>
      )}
      {!running.length && !queued.length && <p className="text-slate-500">Er wacht niets: de werker heeft niets te doen.</p>}
      {failed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-red-800">Mislukt of geannuleerd (laatste 24 uur)</p>
          <ul className="divide-y divide-slate-200">
            {failed.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
                {head(j)}
                <span className="w-full text-xs text-red-800 sm:w-auto sm:flex-1">{j.error ?? (j.status === "cancelled" ? "Geannuleerd" : "Mislukt")}</span>
                <Button variant="secondary" onClick={() => void act(() => retryJob(j.id))}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Opnieuw proberen
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

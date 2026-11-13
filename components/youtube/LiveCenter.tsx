"use client";

import { CheckCircle2, Circle, CircleAlert, Loader2, Maximize2, RotateCcw, Square, ListTree } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { formatTimecode } from "@/lib/youtube/analysis";
import { queueRender, type AnalysisState } from "@/lib/youtube/analysisData";
import { cancelLiveJob, loadEvents, useLiveJobs, type JobEvent } from "@/lib/youtube/liveData";
import { ACTIVITY_LABEL, heartbeatAge, overallProgress, pickProduction, productionSteps, shortDuration, type Activity, type LiveJob } from "@/lib/youtube/production";
import { formatEta } from "@/lib/youtube/progress";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { FORMATS, retryJob } from "@/lib/youtube/studio";

type Ready = Extract<AnalysisState, { ready: true }>;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
const mb = (bytes: number) => (bytes / 1048576).toLocaleString("nl-NL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const TONE: Record<Activity["status"], string> = {
  WAITING: "text-slate-500",
  ANALYZING: "text-cyan-600",
  GENERATING: "text-cyan-600",
  RENDERING: "text-cyan-600",
  UPLOADING: "text-cyan-600",
  REVIEW: "text-violet-600",
  COMPLETED: "text-emerald-600",
  FAILED: "text-red-600",
};

/**
 * Live Production Center (Kivoxel Studio 2.2, chapter 3 and 4): preview, activities, progress, controls, timeline,
 * notes and the render queue of one production. Everything comes from the database; nothing is simulated.
 */
export function LiveCenter({ studioId, analysis, workerOnline, act, onOpenPipeline }: { studioId: string; analysis: Ready | null; workerOnline: boolean | undefined; act: (a: () => Promise<unknown>) => Promise<void>; onOpenPipeline: () => void }) {
  const { jobs, error, connection } = useLiveJobs(studioId, true);
  const [chosen, setChosen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const videos = analysis?.videos.filter((v) => v.yt_video_moments.length > 0) ?? [];
  const titleOf = (videoId: string) => {
    const v = videos.find((x) => x.id === videoId);
    const top = analysis?.scripts.find((s) => s.video_id === videoId && s.top_line)?.top_line;
    const f = FORMATS.find((x) => x.key === v?.format);
    return `${top ?? f?.name ?? "Video"}${v ? ` · format ${v.format}` : ""}${v?.is_test ? " · testdata" : ""}`;
  };
  // Fase 1.4: the first pick follows the worker, after that the view stays on that production until Milan picks another
  // one. Before, a new step elsewhere switched the whole view to another video while he was looking.
  const autoId = (jobs ? pickProduction(jobs) : null) ?? videos[videos.length - 1]?.id ?? null;
  useEffect(() => {
    if (!chosen && autoId && jobs) setChosen(autoId);
  }, [chosen, autoId, jobs]);
  const selectedId = chosen ?? autoId;
  const video = videos.find((v) => v.id === selectedId) ?? null;
  const steps = video && jobs ? productionSteps(video, jobs) : [];
  const overall = overallProgress(steps.length ? steps : [{ key: "analyse", label: "", status: "WAITING", job: null, progress: null }]);
  const liveColumns = !!jobs?.some((j) => "progress" in j);
  const queued = jobs?.filter((j) => j.status === "queued").length ?? 0;
  const running = jobs?.find((j) => j.status === "running") ?? null;
  const beat = running ? heartbeatAge(running, now) : null;

  if (!analysis) return <Section title="Live Production Center"><p className="text-sm text-slate-500">Laden…</p></Section>;

  return (
    <div className="space-y-4">
      <SystemBar connection={connection} workerOnline={workerOnline} queued={queued} running={running} beat={beat} liveColumns={liveColumns} />
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!video ? (
        <Section title="Live Production Center">
          <p className="text-sm text-slate-600">Er is nog geen productie. Upload gameplay en laat hem analyseren; daarna verschijnt hier elke video die gemaakt wordt.</p>
          <Button className="mt-3" variant="secondary" onClick={onOpenPipeline}>
            Naar de pijplijn
          </Button>
        </Section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="text-slate-500">Productie</span>
              <select value={video.id} onChange={(e) => setChosen(e.target.value)} className="min-w-0 flex-1 truncate rounded-md border border-slate-300 bg-transparent px-2 py-1">
                {[...videos].reverse().map((v) => (
                  <option key={v.id} value={v.id}>
                    {titleOf(v.id)}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm tabular-nums text-slate-600">
              Totaal {Math.round(overall.share * 100)}% · {overall.done} van {overall.total} stappen klaar
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100" aria-label={`Totale voortgang ${Math.round(overall.share * 100)}%`}>
            <div className="h-full bg-cyan-500 transition-[width] duration-700" style={{ width: `${overall.share * 100}%` }} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <PreviewZone analysis={analysis} videoId={video.id} workerOnline={workerOnline} renderStep={steps.find((s) => s.key === "render") ?? null} />
            <ActivitiesZone steps={steps} now={now} analysis={analysis} studioId={studioId} videoId={video.id} act={act} onOpenPipeline={onOpenPipeline} />
          </div>
          <Timeline steps={steps} />
          <NotesZone steps={steps} liveColumns={liveColumns} />
        </>
      )}
      <RenderQueue jobs={jobs ?? []} titleOf={titleOf} onPick={setChosen} now={now} />
    </div>
  );
}

function SystemBar({ connection, workerOnline, queued, running, beat, liveColumns }: { connection: string; workerOnline: boolean | undefined; queued: number; running: LiveJob | null; beat: number | null; liveColumns: boolean }) {
  const dot = (ok: boolean | undefined) => <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${ok === undefined ? "bg-slate-300" : ok ? "bg-emerald-500" : "bg-amber-500"}`} />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
      {/* Fixed widths: a changed word ("Verbinden…" -> "Live verbonden") does not push the rest aside. */}
      <span className="flex items-center gap-1.5 sm:min-w-[19rem]">
        {dot(workerOnline)} Werker {workerOnline === undefined ? "controleren…" : workerOnline ? "bereikbaar" : "niet bereikbaar (pc uit of werker gestopt)"}
      </span>
      <span className="flex items-center gap-1.5 sm:min-w-[19rem]">
        {dot(connection === "live")} {connection === "live" ? "Live verbonden" : connection === "connecting" ? "Verbinden…" : "Geen live verbinding: elke 5 s opnieuw geladen"}
      </span>
      <span className="sm:min-w-[9rem] tabular-nums">Wachtrij: {queued} wachtend{running ? ", 1 bezig" : ""}</span>
      {running && beat !== null && <span className={beat > 30_000 ? "text-amber-700" : ""}>Hartslag werker: {shortDuration(beat)} geleden</span>}
      {!liveColumns && <span className="text-amber-700">Voortgang in procenten komt er met migratie 033</span>}
    </div>
  );
}

function PreviewZone({ analysis, videoId, workerOnline, renderStep }: { analysis: Ready; videoId: string; workerOnline: boolean | undefined; renderStep: Activity | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const render = analysis.montage?.renders.find((r) => r.video_id === videoId) ?? null;
  const rendering = renderStep?.status === "RENDERING" || (renderStep?.status === "WAITING" && renderStep.job);
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Preview</h2>
        {render && workerOnline && broken !== render.id && (
          <Button variant="ghost" onClick={() => void ref.current?.requestFullscreen?.()}>
            <Maximize2 className="h-4 w-4" aria-hidden /> Volledig scherm
          </Button>
        )}
      </div>
      {!render ? (
        <p className="py-10 text-center text-sm text-slate-500">Nog geen preview. Die verschijnt hier zodra de eerste montage klaar is.</p>
      ) : !workerOnline ? (
        <p className="py-10 text-center text-sm text-slate-500">De preview staat op de pc. Start de werker om hem hier te bekijken.</p>
      ) : broken === render.id ? (
        <p className="py-10 text-center text-sm text-amber-800">Deze preview staat niet (meer) op deze pc.</p>
      ) : (
        <video
          ref={ref}
          key={render.id}
          src={`${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}`}
          crossOrigin="anonymous"
          controls
          preload="metadata"
          playsInline
          onError={() => setBroken(render.id)}
          style={{ aspectRatio: `${render.width} / ${render.height}` }}
          className={`mx-auto rounded-md bg-black ${render.height > render.width ? "h-[min(60vh,36rem)] w-auto max-w-full" : "w-full"}`}
        />
      )}
      {render && (
        <p className="text-xs text-slate-600">
          {rendering ? <span className="font-medium text-cyan-700">Nieuwe montage bezig. </span> : null}
          Laatst beschikbare preview, gemaakt {when(render.created_at)} · {formatTimecode(render.duration_ms)} · {render.width}×{render.height}
          {render.privacy_blur ? " · hoeken vervaagd" : ""}
        </p>
      )}
      <p className="text-xs text-slate-500">
        De ondertitels zitten in het beeld gebrand en kunnen hier niet uit. Vergelijken met de ruwe gameplay komt in fase C (de editor).
      </p>
    </section>
  );
}

function ActivitiesZone({ steps, now, analysis, studioId, videoId, act, onOpenPipeline }: { steps: Activity[]; now: number; analysis: Ready; studioId: string; videoId: string; act: (a: () => Promise<unknown>) => Promise<void>; onOpenPipeline: () => void }) {
  const approved = analysis.scripts.find((s) => s.video_id === videoId && s.status === "approved") ?? null;
  const renderJobs = approved ? (analysis.montage?.jobs ?? []).filter((j) => j.script_id === approved.id) : [];
  const renderStep = steps.find((s) => s.key === "render");
  const renderBusy = renderStep?.job && (renderStep.job.status === "queued" || renderStep.job.status === "running");
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-surface p-3 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold">Productiestappen</h2>
      <ol className="space-y-3">
        {steps.map((s) => (
          <ActivityRow key={s.key} step={s} now={now} act={act} />
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
        {approved && !renderBusy && (
          <Button variant="secondary" onClick={() => void act(() => queueRender(studioId, approved, renderJobs.length + 1))}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Render opnieuw starten
          </Button>
        )}
        <Button variant="ghost" onClick={onOpenPipeline}>
          Naar resultaten
        </Button>
      </div>
      <p className="text-xs text-slate-500">Pauzeren kan niet: FFmpeg is op Windows niet betrouwbaar te pauzeren. Annuleren stopt de montage echt.</p>
    </section>
  );
}

function ActivityRow({ step, now, act }: { step: Activity; now: number; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const j = step.job;
  const [showLog, setShowLog] = useState(false);
  const started = j?.started_at ? Date.parse(j.started_at) : null;
  const ended = j?.finished_at ? Date.parse(j.finished_at) : null;
  const m = j?.metrics ?? null;
  const Icon = step.status === "COMPLETED" ? CheckCircle2 : step.status === "FAILED" ? CircleAlert : step.status === "WAITING" || step.status === "REVIEW" ? Circle : Loader2;
  const running = j?.status === "running";
  return (
    <li className="text-sm">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[step.status]} ${running ? "animate-spin" : ""}`} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-medium">{step.label}</span>
            <span className={`text-xs font-semibold tracking-wide ${TONE[step.status]}`} title={step.status}>
              {ACTIVITY_LABEL[step.status]}
            </span>
          </div>
          {j && (
            <p className="text-xs text-slate-500">
              {j.status === "queued" ? `Wacht sinds ${shortDuration(now - Date.parse(j.created_at))}` : `Start ${when(j.started_at)}`}
              {ended ? ` · einde ${when(j.finished_at)} · duur ${shortDuration(ended - (started ?? ended))}` : started && running ? ` · bezig ${shortDuration(now - started)}` : ""}
              {j.attempts > 1 ? ` · poging ${j.attempts}` : ""}
            </p>
          )}
          {running && j?.phase && <p className="text-xs text-cyan-700">{j.phase}</p>}
          {running && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100">
                {step.progress !== null ? <div className="h-full bg-cyan-500 transition-[width] duration-700" style={{ width: `${step.progress * 100}%` }} /> : <div className="h-full w-1/3 animate-pulse bg-cyan-200" />}
              </div>
              <p className="text-xs tabular-nums text-slate-600">
                {step.progress !== null ? `${Math.round(step.progress * 100)}%` : "Voortgang van deze stap is niet te meten"}
                {m?.frame != null ? ` · ${m.frame.toLocaleString("nl-NL")} frames` : ""}
                {m?.speed != null ? ` · ${m.speed.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}× realtime` : ""}
                {j?.step === "render" ? ` · nog ${m?.eta_ms != null ? formatEta(m.eta_ms) : m?.out_ms ? "berekenen…" : formatEta(null).toLowerCase()}` : ""}
                {j?.step === "analyse" && m?.eta_ms != null ? ` · nog ${formatEta(m.eta_ms)}${m.estimate ? " (schatting)" : ""}` : ""}
                {j?.step === "upload" && m?.total_bytes ? ` · ${mb(m.sent_bytes ?? 0)} van ${mb(m.total_bytes)} MB${m.bytes_per_s ? ` · ${mb(m.bytes_per_s)} MB/s` : ""}${m.eta_ms != null ? ` · nog ${formatEta(m.eta_ms)}` : ""}` : ""}
              </p>
            </>
          )}
          {j?.cancel_requested && running && <p className="text-xs text-amber-700">Annuleren gevraagd; de werker stopt…</p>}
          {j?.error && j.status !== "done" && <p className="text-xs text-red-700 [overflow-wrap:anywhere]">{j.error}</p>}
          {j && (
            <div className="flex flex-wrap gap-1">
              {(j.status === "queued" || (running && !j.cancel_requested)) && (
                <Button variant="ghost" onClick={() => void act(() => cancelLiveJob(j.id))}>
                  <Square className="h-3.5 w-3.5" aria-hidden /> Annuleren
                </Button>
              )}
              {(j.status === "failed" || j.status === "cancelled") && (
                <Button variant="ghost" onClick={() => void act(() => retryJob(j.id))}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Opnieuw proberen
                </Button>
              )}
              <Button variant="ghost" onClick={() => setShowLog(!showLog)}>
                <ListTree className="h-3.5 w-3.5" aria-hidden /> {showLog ? "Logboek verbergen" : "Logboek"}
              </Button>
            </div>
          )}
          {showLog && j && <JobLog jobId={j.id} version={`${j.status}:${j.progress}:${j.finished_at}`} />}
        </div>
      </div>
    </li>
  );
}

function JobLog({ jobId, version }: { jobId: string; version: string }) {
  const [events, setEvents] = useState<JobEvent[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadEvents([jobId])
      .then((e) => alive && setEvents(e))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [jobId, version]);
  if (events === undefined) return <p className="text-xs text-slate-500">Laden…</p>;
  if (events === null) return <p className="text-xs text-slate-500">Het logboek komt er met migratie 033.</p>;
  if (!events.length) return <p className="text-xs text-slate-500">Nog geen regels in het logboek.</p>;
  return (
    <ol className="max-h-48 space-y-0.5 overflow-y-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-4 text-slate-700">
      {events.map((e) => (
        <li key={e.id} className={e.kind === "error" ? "text-red-700" : e.kind === "milestone" ? "text-emerald-700" : ""}>
          {new Date(e.at).toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam" })} {e.message}
        </li>
      ))}
    </ol>
  );
}

function Timeline({ steps }: { steps: Activity[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Tijdlijn van de productie">
      {steps.map((s) => (
        <li key={s.key} className="space-y-1">
          <div className={`h-1.5 rounded ${s.status === "COMPLETED" ? "bg-emerald-500" : s.status === "FAILED" ? "bg-red-500" : s.status === "WAITING" ? "bg-slate-200" : s.status === "REVIEW" ? "bg-violet-400" : "bg-cyan-500"}`} />
          <p className="truncate text-[11px] text-slate-600">{s.label}</p>
        </li>
      ))}
    </ol>
  );
}

/** Milestones and AI notes of this production; a new milestone shows a short message. */
function NotesZone({ steps, liveColumns }: { steps: Activity[]; liveColumns: boolean }) {
  const ids = steps.map((s) => s.job?.id).filter((x): x is string => !!x);
  const key = steps.map((s) => `${s.job?.id}:${s.job?.status}:${s.job?.finished_at}`).join("|");
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const idsKey = ids.join(",");
  useEffect(() => {
    seen.current = null;
  }, [idsKey]);
  useEffect(() => {
    if (!liveColumns) return;
    let alive = true;
    void loadEvents(idsKey ? idsKey.split(",") : [])
      .then((e) => {
        if (!alive || !e) return;
        setEvents(e);
        const fresh = e.filter((x) => x.kind === "milestone" && seen.current && !seen.current.has(x.id));
        if (fresh.length) setToast(fresh[fresh.length - 1].message);
        seen.current = new Set(e.map((x) => x.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [idsKey, key, liveColumns]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const notes = useMemo(() => events.filter((e) => e.kind === "note" || e.kind === "milestone"), [events]);
  return (
    <>
      {toast && (
        <div role="status" className="fixed bottom-20 right-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg md:bottom-6">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-400" aria-hidden />
          {toast}
        </div>
      )}
      <Section title="AI-notities en mijlpalen" intro="Wat de AI en de werker echt hebben gedaan, uit de uitkomst van elke stap.">
        {!liveColumns ? (
          <p className="text-sm text-slate-500">Komt er met migratie 033.</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-500">Nog niets: notities verschijnen zodra een stap klaar is.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {notes.map((e) => (
              <li key={e.id} className={e.kind === "milestone" ? "font-medium text-emerald-700" : "text-slate-700"}>
                {e.kind === "milestone" ? "✓ " : "· "}
                {e.message} <span className="text-xs font-normal text-slate-400">{new Date(e.at).toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function RenderQueue({ jobs, titleOf, onPick, now }: { jobs: LiveJob[]; titleOf: (id: string) => string; onPick: (id: string) => void; now: number }) {
  // One line per video: its newest montage step (jobs come newest first). Fase 1.4: the order is the time the step was
  // made and never the status, so a line does not jump to another place when its montage starts or finishes.
  const sorted = jobs.filter((j, i) => j.step === "render" && j.video_id && jobs.findIndex((x) => x.step === "render" && x.video_id === j.video_id) === i).slice(0, 10);
  const label: Record<string, string> = { running: "Bezig", queued: "Wacht", done: "Klaar", failed: "Mislukt", cancelled: "Geannuleerd" };
  return (
    <Section title="Renderwachtrij" intro="De laatste montages, nieuwste bovenaan. De werker maakt één montage tegelijk.">
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-500">Nog geen montages.</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {sorted.map((j) => (
            <li key={j.video_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <button type="button" onClick={() => onPick(j.video_id!)} className="min-w-0 flex-1 truncate text-left hover:underline">
                {titleOf(j.video_id!)}
              </button>
              <span className={`text-xs ${j.status === "failed" ? "text-red-700" : j.status === "running" ? "text-cyan-700" : "text-slate-600"}`}>
                {label[j.status]}
                {j.status === "running" && j.progress != null ? ` · ${Math.round(Number(j.progress) * 100)}%` : ""}
                {j.status === "queued" ? ` · ${shortDuration(now - Date.parse(j.created_at))}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

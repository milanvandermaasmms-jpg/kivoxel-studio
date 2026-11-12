"use client";

import { useEffect, useMemo, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { FOOTAGE_NEEDED, missingFormats, type Format } from "@/lib/youtube/analysis";
import { queueAnalysis, queueRender, regenerateScript, setScriptStatus, VOICES, type AnalysisState } from "@/lib/youtube/analysisData";
import { makerRecordings, makerStep, makerVideos } from "@/lib/youtube/maker";
import { loadAnalyseProgress, type AnalyseProgress } from "@/lib/youtube/makerData";
import { formatEta } from "@/lib/youtube/progress";
import { FORMATS, formatDuration } from "@/lib/youtube/studio";

type Ready = Extract<AnalysisState, { ready: true }>;
type Act = (action: () => Promise<unknown>) => Promise<void>;
const FORMAT_NAME: Record<string, string> = Object.fromEntries(FORMATS.map((f) => [f.key, `${f.name} · ${f.kind}`]));
const STATUS: Record<string, string> = { idea: "nieuw", scripted: "script klaar", rendering: "montage bezig", review: "in controle", approved: "goedgekeurd", scheduled: "ingepland", published: "gepubliceerd", failed: "mislukt" };

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * AI Video Maker (2.2 chapter 2): gameplay -> format -> settings -> start. A guided route through the same steps as the
 * Productiestudio; approving the script and the video and publishing stay Milan's own clicks.
 */
export function VideoMaker({ state, studioId, act, refresh, onOpen }: { state: AnalysisState | null; studioId: string; act: Act; refresh: () => Promise<void>; onOpen: (tab: "library" | "pipeline" | "live" | "settings") => void }) {
  const ready = state?.ready ? (state as Ready) : null;
  const recordings = useMemo(() => (ready ? makerRecordings(ready) : []), [ready]);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const rec = recordingId ?? recordings[0]?.id ?? null;
  const step = ready && rec ? makerStep(ready, rec, videoId) : null;

  // While something runs in the background, look again every 4 seconds.
  const busy = waiting || step?.kind === "analysing" || step?.kind === "rendering";
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);
  // The analysis reports its stage and progress (FFmpeg measured, Gemini estimated); look along every 3 seconds.
  const [analyseProgress, setAnalyseProgress] = useState<AnalyseProgress | null>(null);
  const analysing = step?.kind === "analysing";
  useEffect(() => {
    if (!analysing || !rec) return setAnalyseProgress(null);
    let live = true;
    const load = () => void loadAnalyseProgress(studioId, rec).then((p) => live && setAnalyseProgress(p));
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [analysing, rec, studioId]);
  // A new script arrived: stop waiting.
  const scriptCount = ready?.scripts.filter((s) => s.video_id === videoId).length ?? 0;
  useEffect(() => setWaiting(false), [scriptCount]);

  if (!state) return <p className="text-sm text-slate-500">Laden…</p>;
  if (!ready) return <Section title="AI Video Maker"><p className="text-sm text-slate-600">De AI Video Maker werkt zodra de analyse beschikbaar is (migratie 009).</p></Section>;

  const videos = rec ? makerVideos(ready, rec) : [];
  const recording = ready.recordings.find((r) => r.id === rec);
  const voice = ready.montage?.voice;
  const voiceLabel = VOICES.find((v) => v.name === voice?.voice_name)?.label ?? voice?.voice_name ?? "–";
  const paidOff = !ready.settings?.paid_processing_enabled;

  return (
    <div className="space-y-4">
      <Section title="AI Video Maker" intro="Van gameplay naar een montage in vier stappen. De AI analyseert, schrijft en monteert; het script goedkeuren, de video goedkeuren en publiceren doe je zelf.">
        <p className="text-xs text-slate-500">Elke stap is ook te zien en aan te passen in de Productiestudio; dit is dezelfde productie, alleen stap voor stap.</p>
      </Section>

      <Step n={1} title="Gameplay kiezen" done={!!rec}>
        {recordings.length === 0 ? (
          <p className="text-sm text-slate-500">Nog geen opnames.</p>
        ) : (
          <ul className="space-y-1">
            {recordings.map((r) => (
              <li key={r.id}>
                <label className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${r.id === rec ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}>
                  <input type="radio" name="maker-recording" checked={r.id === rec} onChange={() => (setRecordingId(r.id), setVideoId(null))} />
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs text-slate-500">
                    {formatDuration(r.duration_ms)} · {r.status === "ready" ? "klaar" : r.status}
                  </span>
                  {r.is_test && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">testdata</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <Button variant="secondary" onClick={() => onOpen("library")}>
            Nieuwe opname uploaden
          </Button>
        </div>
      </Step>

      <Step n={2} title="Format kiezen" done={!!videoId}>
        {videos.length === 0 ? (
          <p className="text-sm text-slate-500">De formats verschijnen na de analyse (stap 4 start die).</p>
        ) : (
          <ul className="space-y-1">
            {videos.map((v) => (
              <li key={v.id}>
                <label className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${v.id === videoId ? "border-cyan-500 bg-cyan-50" : "border-slate-200"}`}>
                  <input type="radio" name="maker-video" checked={v.id === videoId} onChange={() => setVideoId(v.id)} />
                  <span className="font-medium">Format {v.format}: {FORMAT_NAME[v.format]}</span>
                  <span className="text-xs text-slate-500">
                    {v.yt_video_moments.length} {v.yt_video_moments.length === 1 ? "moment" : "momenten"} · {STATUS[v.status] ?? v.status}
                  </span>
                  {v.promise && <span className="basis-full text-xs text-slate-600">{v.promise}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {videos.length > 0 &&
          missingFormats(videos.map((v) => v.format as Format)).map((f) => (
            <p key={f} className="mt-1 text-xs text-slate-500">
              Format {f} kan nog niet met deze opname: {FOOTAGE_NEEDED[f]}
            </p>
          ))}
      </Step>

      <Step n={3} title="Instellingen" done>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">Stem</dt>
          <dd>{recording?.is_test ? "geen (testdata krijgt nooit een stem)" : voiceLabel}</dd>
          <dt className="text-slate-500">Tempo en gamegeluid</dt>
          <dd>{voice ? `${voice.speaking_rate.toLocaleString("nl-NL")}× · gamegeluid ${Math.round(voice.game_volume * 100)}%` : "–"}</dd>
          <dt className="text-slate-500">Analyse</dt>
          <dd>{paidOff ? "betaalde analyse staat uit (alleen testdata)" : `aan, binnen het maandplafond`}</dd>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Stem, vervagen en het plafond pas je aan bij{" "}
          <button type="button" onClick={() => onOpen("settings")} className="underline underline-offset-2">
            Instellingen
          </button>
          ; de hook kies je na het script in de Productiestudio.
        </p>
      </Step>

      <Step n={4} title="Starten">
        {!step ? (
          <p className="text-sm text-slate-500">Kies eerst een opname.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>{waiting ? "De AI schrijft het script; dat duurt meestal een paar seconden." : step.text}</p>
            {step.kind === "analysing" && (
              <div className="space-y-1" aria-live="polite">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                  <span>{analyseProgress?.phase ?? "Wacht op de werker…"}</span>
                  <span className="tabular-nums">
                    {analyseProgress?.progress != null ? `${Math.round(analyseProgress.progress * 100)}%` : ""}
                    {analyseProgress?.etaMs != null ? ` · nog ${formatEta(analyseProgress.etaMs)}${analyseProgress.estimate ? " (schatting)" : ""}` : ""}
                  </span>
                </div>
                <div role="progressbar" aria-label="Voortgang van de analyse" aria-valuemin={0} aria-valuemax={100} aria-valuenow={analyseProgress?.progress != null ? Math.round(analyseProgress.progress * 100) : undefined} className="h-2 overflow-hidden rounded-full bg-slate-100">
                  {analyseProgress?.progress != null ? <div className="h-full rounded-full bg-cyan-500 transition-[width] duration-700" style={{ width: `${analyseProgress.progress * 100}%` }} /> : <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-200" />}
                </div>
                <p className="text-xs text-slate-500">Het maken van de analysekopie wordt gemeten; hoe lang Gemini nadenkt is een schatting op basis van de lengte van de opname.</p>
                <Button variant="secondary" onClick={() => onOpen("live")}>
                  Volg het in Live
                </Button>
              </div>
            )}
            {step.kind === "analyse" && (
              <>
                {!step.test && paidOff && <p className="text-amber-800">Zet eerst de betaalde analyse aan bij Instellingen (met je maandplafond).</p>}
                <Button disabled={!step.test && paidOff} onClick={() => void act(() => queueAnalysis(studioId, rec!))}>
                  Analyse starten
                </Button>
              </>
            )}
            {step.kind === "script" && !waiting && (
              <Button onClick={() => void act(async () => (setWaiting(true), regenerateScript(studioId, step.videoId, step.version)))}>
                Script laten schrijven
              </Button>
            )}
            {step.kind === "approve-script" && (
              <div className="space-y-2 rounded-md border border-slate-200 p-3">
                {step.script.top_line && <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{step.script.top_line}</p>}
                <p className="font-medium">{step.script.hook}</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-slate-600">
                  {step.script.lines.slice(0, 8).map((l, i) => (
                    <li key={i}>{l.text}</li>
                  ))}
                </ol>
                <p className="text-xs text-slate-500">Versie {step.script.version} · lengte {formatDuration(step.script.target_ms)}. Hooks kiezen, aanpassen of opnieuw laten schrijven kan in de Productiestudio.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void act(() => setScriptStatus(step.script, "approved"))}>Script goedkeuren</Button>
                  <Button variant="secondary" onClick={() => onOpen("pipeline")}>
                    Lezen en aanpassen in de Productiestudio
                  </Button>
                </div>
              </div>
            )}
            {step.kind === "render" && (
              <Button onClick={() => void act(() => queueRender(studioId, step.script, step.attempt)).then(() => onOpen("live"))}>
                Montage starten
              </Button>
            )}
            {step.kind === "rendering" && (
              <Button variant="secondary" onClick={() => onOpen("live")}>
                Volg het in Live
              </Button>
            )}
            {(step.kind === "review" || step.kind === "publish" || step.kind === "done" || step.kind === "intake") && (
              <Button variant="secondary" onClick={() => onOpen("pipeline")}>
                Naar de Productiestudio
              </Button>
            )}
          </div>
        )}
      </Step>
    </div>
  );
}

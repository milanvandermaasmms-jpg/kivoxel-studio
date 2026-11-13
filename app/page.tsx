"use client";

import { CheckCircle2, Loader2, RefreshCw, Settings, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Fold, Notice, Section } from "@/components/settings/Section";
import { StatusBadge } from "@/components/shell/StatusBadge";
import { Button } from "@/components/ui/Dialog";
import { AnalysisSection, AnalysisSettings, useAnalysis } from "@/components/youtube/AnalysisSection";
import { LiveCenter } from "@/components/youtube/LiveCenter";
import { ChannelCard } from "@/components/youtube/ChannelCard";
import { StatsCenter } from "@/components/youtube/StatsCenter";
import { Notices } from "@/components/youtube/Notices";
import { VideoMaker } from "@/components/youtube/VideoMaker";
import { ContentCalendar, PublicationsOverview } from "@/components/youtube/PublicationsBoard";
import { overviewFrom, TodayOverview } from "@/components/youtube/TodayOverview";
import { PrivateTermsSettings } from "@/components/youtube/GateList";
import { PipelineBoard } from "@/components/youtube/PipelineBoard";
import { InboxCard } from "@/components/youtube/InboxCard";
import { UploadCard } from "@/components/youtube/UploadCard";
import { ReviewMode } from "@/components/youtube/ReviewMode";
import { StudioTopBar } from "@/components/youtube/StudioTopBar";
import { VideoQueue } from "@/components/youtube/VideoQueue";
import { reviewQueue } from "@/lib/youtube/board";
import type { Flow } from "@/lib/youtube/flow";
import { useFlow } from "@/lib/youtube/flowData";
import { useStudio } from "@/lib/studio";
import type { LocalRecording, WorkerHealth } from "@/lib/youtube/protocol";
import {
  cancelJob,
  FORMATS,
  formatBytes,
  formatDuration,
  isKnownRecording,
  JOB_STATUS_LABEL,
  loadStudio,
  registerRecording,
  retryJob,
  STEP_LABEL,
  type DbState,
} from "@/lib/youtube/studio";
import { pipelineSteps, type StepState } from "@/lib/youtube/review";
import { listLocalRecordings, workerHealth, type UploadOutcome } from "@/lib/youtube/workerClient";

// Navigation (superprompt opschonen, fase 1.3): six steps in the order a video goes through, plus Instellingen.
// Every tab shows only what belongs to that step. Old addresses (#pijplijn, #bord, #cijfers, ...) keep working.
const TABS = [
  { key: "upload", label: "Uploaden", icon: "📤", hash: "uploaden" },
  { key: "production", label: "In productie", icon: "⚙️", hash: "productie" },
  { key: "review", label: "Review", icon: "👀", hash: "review" },
  { key: "ready", label: "Klaar voor YouTube", icon: "🚀", hash: "klaar" },
  { key: "live", label: "Live", icon: "✅", hash: "live" },
  { key: "insights", label: "Inzichten", icon: "📈", hash: "inzichten" },
  { key: "settings", label: "Instellingen", icon: "⚙", hash: "instellingen" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const OLD_HASH: Record<string, Tab> = { bord: "production", overzicht: "insights", pijplijn: "review", gameplay: "upload", maker: "upload", kalender: "live", youtube: "live", cijfers: "insights" };
/** Buttons inside older parts still name their old tab; this is where those parts live now. */
const OLD_TAB: Record<string, Tab> = { library: "upload", maker: "upload", pipeline: "review", live: "production", stats: "insights", settings: "settings", board: "production", overview: "insights", calendar: "live", youtube: "live" };
const FLOW_TAB: Record<Flow, Tab> = { production: "production", review: "review", ready: "ready", uploading: "ready", live: "live" };

const STEP_TONE: Record<StepState, { mark: string; tone: string }> = {
  works: { mark: "✓", tone: "text-emerald-700" },
  connect: { mark: "!", tone: "text-amber-800" },
  offline: { mark: "–", tone: "text-slate-500" },
  later: { mark: "·", tone: "text-slate-400" },
};

const RECORDING_STATUS: Record<string, string> = { uploading: "Uploaden", received: "Wacht op intake", ready: "Klaar", failed: "Mislukt" };

export default function YouTubeStudioPage() {
  const { studio, isAdmin } = useStudio();
  const [health, setHealth] = useState<WorkerHealth | null | undefined>(undefined);
  const [local, setLocal] = useState<LocalRecording[] | null>(null);
  const [db, setDb] = useState<DbState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ready");
  const [channel, setChannel] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const analysis = useAnalysis(studio.id, isAdmin);
  const flow = useFlow(studio.id, isAdmin);

  // The chosen tab is kept in the address (#klaar), so a refresh or a link opens the same tab.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      const found = TABS.find((t) => t.hash === hash)?.key ?? OLD_HASH[hash];
      if (found) setTab(found);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const chooseTab = (key: Tab | string) => {
    const next = (TABS.some((t) => t.key === key) ? key : OLD_TAB[key]) as Tab | undefined;
    if (!next) return;
    setTab(next);
    history.replaceState(null, "", `#${TABS.find((t) => t.key === next)!.hash}`);
    window.scrollTo({ top: 0 });
  };
  // On a phone the navigation scrolls sideways: keep the chosen part in view.
  useEffect(() => {
    document.querySelector(".studio-nav [aria-selected=\"true\"]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);

  // While migration 007 has not run, the database is only asked again on "Vernieuwen", not every 5 seconds.
  // A poll that brings nothing new does not change the state, so nothing re-renders or jumps.
  const dbMissing = useRef(false);
  const lastDb = useRef("");
  const lastLocal = useRef("");
  const refresh = useCallback(
    async (full = true) => {
      const [h, state] = await Promise.all([workerHealth(), full || !dbMissing.current ? loadStudio(studio.id) : null]);
      setHealth((old) => (JSON.stringify(old) === JSON.stringify(h) ? old : h));
      if (state) {
        dbMissing.current = !state.ready && state.reason === "migration";
        const key = JSON.stringify(state);
        if (key !== lastDb.current) {
          lastDb.current = key;
          setDb(state);
        }
      }
      const list = h ? await listLocalRecordings().catch(() => null) : null;
      const key = JSON.stringify(list);
      if (key !== lastLocal.current) {
        lastLocal.current = key;
        setLocal(list);
      }
    },
    [studio.id],
  );

  useEffect(() => {
    if (!isAdmin) return;
    void refresh();
    const timer = setInterval(() => void refresh(false), 5000);
    return () => clearInterval(timer);
  }, [refresh, isAdmin]);

  if (!isAdmin) return <p className="py-16 text-center text-sm text-slate-500">YouTube Studio is alleen voor beheerders.</p>;

  const dbReady = db?.ready === true;
  const dbRecordings = db?.ready ? db.recordings : [];
  const workerOnline = health === undefined ? undefined : !!health;
  const flowReady = flow.state && "board" in flow.state ? flow.state : null;
  const queue = flowReady ? reviewQueue(flowReady.board.input.videos, flowReady.board.input.scripts, channel) : [];

  const onReceived = async (outcome: UploadOutcome): Promise<string | null> => {
    let note: string | null = null;
    // Also for a duplicate: the file may already be on the pc but not in this studio's database. Registering is safe to repeat.
    if (dbReady) {
      try {
        await registerRecording(studio.id, outcome.recording);
        if (outcome.kind === "done") note = "De intake staat in de wachtrij.";
      } catch (e) {
        setError(`De opname staat op de pc, maar kon niet in de database worden gezet: ${e instanceof Error ? e.message : e}`);
      }
    }
    await refresh();
    return note;
  };

  const a = analysis.state?.ready ? analysis.state : null;
  const steps = pipelineSteps({
    worker: health === undefined ? undefined : health ? { ffmpeg: health.ffmpeg, analysis: health.analysis ?? null, voice: !!health.voice, youtube: !!health.youtube } : null,
    paidEnabled: !!a?.settings?.paid_processing_enabled,
    montageReady: !!a?.montage,
    privacyReady: !!a?.montage?.privacy,
  });

  const act = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      await Promise.all([refresh(), analysis.refresh(), flow.refresh()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dat lukte niet.");
    }
  };

  const loading = (
    <p className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Laden…
    </p>
  );
  const flowError = flow.state && "error" in flow.state ? <Notice tone="error">{flow.state.error}</Notice> : null;

  return (
    <div className="studio mx-auto max-w-6xl space-y-4">
      <div className="studio-header flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            KIVOXEL Studio <span className="text-sm font-normal text-violet-700">{flowReady?.board.channels.find((c) => c.id === channel)?.name ?? "alle kanalen"}</span>
          </h1>
          <p className="text-sm text-slate-500">Er gaat niets online zonder jouw klik. Geen gezicht, naam, stem of gamertag van Maes in beeld.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => chooseTab("upload")}>
            <Upload className="h-4 w-4" aria-hidden /> Nieuwe opname
          </Button>
          <Button variant="secondary" onClick={() => void Promise.all([refresh(), analysis.refresh(), flow.refresh()])} aria-label="Vernieuwen">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <StudioTopBar items={flowReady?.items ?? null} channels={flowReady?.board.channels ?? []} channel={channel} onChannel={setChannel} onOpen={(f) => chooseTab(FLOW_TAB[f])} />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="gap-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Stappen van de Studio" className="studio-nav -mx-4 mb-4 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:overflow-visible lg:px-0">
          <ul role="tablist" className="flex gap-1 lg:sticky lg:top-24 lg:flex-col">
            {TABS.map((t) => {
              const active = tab === t.key;
              const count = flowReady && t.key !== "upload" && t.key !== "insights" && t.key !== "settings" ? flowReady.items.filter((i) => (!channel || i.channelId === channel) && FLOW_TAB[i.flow] === t.key).length : null;
              return (
                <li key={t.key} className={t.key === "settings" ? "lg:mt-4 lg:border-t lg:border-slate-200 lg:pt-4" : ""}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => chooseTab(t.key)}
                    className={`flex min-h-11 w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors ${active ? "bg-cyan-50 font-medium text-cyan-900 shadow-[inset_3px_0_0_var(--color-cyan-500)]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                  >
                    {t.key === "settings" ? <Settings className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : <span aria-hidden>{t.icon}</span>}
                    <span className="flex-1">{t.label}</span>
                    {count !== null && count > 0 && <span className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${t.key === "ready" ? "bg-amber-500 text-slate-950" : "bg-slate-100 text-slate-700"}`}>{count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          {tab === "upload" && (
            <>
              <UploadCard workerOnline={!!health} isKnown={(fp) => (dbReady ? isKnownRecording(studio.id, fp) : Promise.resolve(false))} onReceived={onReceived} />
              <InboxCard health={health} />
              <Fold title="Opnames op de pc" intro={local ? `${local.length} opnames · wat FFmpeg erover uitlas` : "De ruwe opnames staan alleen op de pc."}>
                {!health ? (
                  <p className="text-sm text-slate-500">Zichtbaar zodra de werker bereikbaar is.</p>
                ) : local === null ? (
                  <p className="text-sm text-slate-500">Laden…</p>
                ) : local.length === 0 ? (
                  <p className="text-sm text-slate-500">Nog geen opnames.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {local.map((r) => {
                      const row = dbRecordings.find((d) => d.fingerprint === r.fingerprint);
                      const status = row ? RECORDING_STATUS[row.status] : r.intakeError ? "Mislukt" : r.probe ? "Klaar" : "Intake bezig";
                      return (
                        <li key={r.fingerprint} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {r.label} {r.isTest && <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">testdata</span>}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatBytes(r.size)} · {formatDuration(r.probe?.durationMs ?? null)}
                              {r.probe?.width && r.probe.height ? ` · ${r.probe.width}×${r.probe.height}` : ""}
                              {r.probe?.fps ? ` · ${r.probe.fps.toLocaleString("nl-NL")} fps` : ""}
                              {r.probe?.videoCodec ? ` · ${r.probe.videoCodec}` : ""} · vingerafdruk {r.fingerprint.slice(0, 10)}…
                            </p>
                            {(row?.error ?? r.intakeError) && <p className="text-xs text-red-700 [overflow-wrap:anywhere]">{row?.error ?? r.intakeError}</p>}
                          </div>
                          <span className="flex items-center gap-2 text-xs text-slate-600">
                            {status}
                            {/* On the pc but not (yet) in this studio's database, e.g. after moving to a new Supabase project. */}
                            {!row && dbReady && r.probe && !r.intakeError && (
                              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void act(() => registerRecording(studio.id, r))}>
                                Aanmelden
                              </Button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Fold>
              <Fold title="AI Video Maker" intro="Stap voor stap van gameplay naar een video, met dezelfde stappen als de rest van de Studio.">
                <VideoMaker state={analysis.state} studioId={studio.id} act={act} refresh={analysis.refresh} onOpen={chooseTab} />
              </Fold>
            </>
          )}

          {tab === "production" && (
            <>
              <PipelineBoard studioId={studio.id} workerOnline={!!health} onOpenStudio={() => chooseTab("review")} />
              <Fold title="Live voortgang" intro="Wat de werker nu doet: preview, stappen, logboek en de renderwachtrij." defaultOpen>
                <LiveCenter studioId={studio.id} analysis={analysis.state?.ready ? analysis.state : null} workerOnline={workerOnline} act={act} onOpenPipeline={() => chooseTab("review")} />
              </Fold>
              <Fold title="Wachtrij van de werker" intro={db?.ready ? `${db.jobs.filter((j) => j.status === "queued" || j.status === "running").length} wachtend of bezig` : undefined}>
                {db === null ? (
                  <p className="text-sm text-slate-500">Laden…</p>
                ) : !db.ready ? (
                  db.reason === "migration" ? <p className="text-sm text-slate-600">De tabellen in Supabase komen er met migratie 007 (nog niet uitgevoerd).</p> : <Notice tone="error">{db.message}</Notice>
                ) : db.jobs.length === 0 ? (
                  <p className="text-sm text-slate-500">De wachtrij is leeg.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {db.jobs.map((j) => (
                      <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <div className="min-w-0">
                          <p>{STEP_LABEL[j.step] ?? j.step}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(j.created_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" })} · poging {j.attempts}
                            {j.error ? ` · ${j.error}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${j.status === "failed" ? "text-red-700" : j.status === "done" ? "text-emerald-700" : "text-slate-600"}`}>{JOB_STATUS_LABEL[j.status]}</span>
                          {j.status === "queued" && (
                            <Button variant="ghost" onClick={() => void act(() => cancelJob(j.id))}>
                              Annuleren
                            </Button>
                          )}
                          {(j.status === "failed" || j.status === "cancelled") && (
                            <Button variant="secondary" onClick={() => void act(() => retryJob(j.id))}>
                              Opnieuw
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>
            </>
          )}

          {tab === "review" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-violet-200 bg-violet-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-violet-900">{queue.length === 0 ? "Niets te keuren" : `👀 ${queue.length} ${queue.length === 1 ? "video wacht" : "video's wachten"} op jou`}</p>
                  <p className="text-sm text-violet-800">Keur scripts en eindversies één voor één, met grote knoppen. Swipen of pijltjestoetsen gaat ook.</p>
                </div>
                <Button disabled={queue.length === 0 || !flowReady} onClick={() => setReviewing(true)} className="min-h-11">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Start met keuren
                </Button>
              </div>
              <AnalysisSection state={analysis.state} studioId={studio.id} act={act} analysisService={health ? (health.analysis ?? null) : undefined} onWatch={() => chooseTab("production")} />
              {reviewing && flowReady && (
                <ReviewMode
                  studioId={studio.id}
                  board={flowReady.board}
                  items={queue}
                  workerOnline={!!health}
                  onClose={() => setReviewing(false)}
                  onEdit={() => setReviewing(false)}
                  onChanged={async () => {
                    await Promise.all([flow.refresh(), analysis.refresh()]);
                  }}
                />
              )}
            </>
          )}

          {tab === "ready" &&
            (flowError ??
              (!flowReady ? (
                loading
              ) : (
                <VideoQueue state={flowReady} flows={["ready", "uploading"]} channel={channel} workerOnline={!!health} studioId={studio.id} onOpenProduction={() => chooseTab("production")} empty="Er staat nu niets klaar voor YouTube. Een video komt hier zodra je de eindversie hebt goedgekeurd." />
              )))}

          {tab === "live" && (
            <>
              {flowError ?? (!flowReady ? loading : <VideoQueue state={flowReady} flows={["live"]} channel={channel} workerOnline={!!health} studioId={studio.id} onOpenProduction={() => chooseTab("production")} empty="Nog niets op YouTube." />)}
              <Fold title="Contentkalender" intro="Wat wanneer online gaat.">
                <ContentCalendar studioId={studio.id} onOpen={() => chooseTab("ready")} />
              </Fold>
              <Fold title="Alle publicaties" intro="Overzicht van alles wat naar YouTube is gegaan of gaat.">
                <PublicationsOverview studioId={studio.id} onOpen={() => chooseTab("ready")} />
              </Fold>
            </>
          )}

          {tab === "insights" && (
            <>
              <Notices studioId={studio.id} onOpen={chooseTab} />
              <StatsCenter studioId={studio.id} workerOnline={workerOnline} />
              <Fold title="Vandaag in de Studio">
                <TodayOverview overview={overviewFrom(db, analysis.state, workerOnline)} onOpen={chooseTab} />
              </Fold>
              <Fold title="Stand van de productielijn" intro="Per stap: werkt, nog te verbinden of later.">
                <ol className="divide-y divide-slate-100">
                  {steps.map((s) => (
                    <li key={s.key} className="flex items-start gap-3 py-2 text-sm">
                      <span aria-hidden className={`w-4 text-center font-semibold ${STEP_TONE[s.state].tone}`}>
                        {STEP_TONE[s.state].mark}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{s.label}</p>
                        <p className="text-xs text-slate-500">{s.note}</p>
                      </div>
                      {s.state === "works" ? <span className="text-xs text-emerald-700">werkt</span> : s.state === "offline" ? <span className="whitespace-nowrap text-xs text-slate-500">werker uit</span> : <StatusBadge status={s.state} />}
                    </li>
                  ))}
                </ol>
              </Fold>
              <Fold title="Formats om te testen">
                <ul className="grid gap-2 sm:grid-cols-3">
                  {FORMATS.map((f) => (
                    <li key={f.key} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <p className="font-medium">
                        {f.key}. {f.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {f.kind} · {f.length} · {f.rhythm}
                      </p>
                    </li>
                  ))}
                </ul>
              </Fold>
            </>
          )}
      {tab === "settings" && (
        <>
          <ChannelCard studioId={studio.id} onError={setError} />
          <PrivateTermsSettings studioId={studio.id} onError={setError} />
          <Section title="Werker op de pc" intro="De werker doet het zware werk op de pc van Milan: bestanden ontvangen, FFmpeg en later montage en uploaden. Hij werkt alleen als de pc aanstaat.">
            {health === undefined ? (
              <p className="text-sm text-slate-500">Controleren…</p>
            ) : health ? (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-emerald-700">Bereikbaar (versie {health.version})</dd>
                <dt className="text-slate-500">FFmpeg</dt>
                <dd>{health.ffmpeg ? `Geïnstalleerd (${health.ffmpeg})` : <span className="text-red-700">Niet gevonden</span>}</dd>
                <dt className="text-slate-500">Wachtrij</dt>
                <dd>{health.queue === "supabase" ? "Supabase: de werker pakt opdrachten uit de database op" : "Alleen lokaal: de werker verwerkt nieuwe opnames meteen zelf"}</dd>
                <dt className="text-slate-500">Analysedienst</dt>
                <dd>{health.analysis ? `${health.analysis} (betaalde laag)` : "Niet verbonden: zet GEMINI_API_KEY in worker\\.env.local en start de werker opnieuw"}</dd>
                <dt className="text-slate-500">Opslagmap</dt>
                <dd className="break-all font-mono text-xs leading-5">{health.dataDir}</dd>
              </dl>
            ) : (
              <div className="space-y-1 text-sm text-slate-700">
                <p className="font-medium text-amber-800">Niet bereikbaar.</p>
                <p>
                  Start de werker op de pc: dubbelklik <code className="rounded bg-slate-100 px-1">worker\start-werker.cmd</code> in de projectmap, of typ <code className="rounded bg-slate-100 px-1">npm run worker</code>. Laat dat venster open.
                </p>
                <p className="text-slate-500">Op een telefoon is de werker niet bereikbaar; uploaden gaat op de pc zelf.</p>
              </div>
            )}
          </Section>
          <AnalysisSettings state={analysis.state} studioId={studio.id} act={act} analysisService={health ? (health.analysis ?? null) : undefined} voiceConnected={health ? !!health.voice : undefined} />
        </>
      )}
      </div>
      </div>
    </div>
  );
}

"use client";

import { BarChart3, CalendarDays, Clapperboard, Film, FlaskConical, LayoutDashboard, Radio, RefreshCw, Settings, Upload, Wallet, Wand2, MonitorPlay } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Section } from "@/components/settings/Section";
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
import { InboxCard } from "@/components/youtube/InboxCard";
import { UploadCard } from "@/components/youtube/UploadCard";
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

// Navigation of the studio (2.2 chapter 2): the 11 parts, in this order. Parts not built yet are shown as "later"
// (not clickable, so no dead buttons). Old addresses (#pijplijn, #cijfers) keep working.
const TABS = [
  { key: "overview", label: "Dashboard" },
  { key: "pipeline", label: "Productiestudio" },
  { key: "library", label: "Gameplaybibliotheek" },
  { key: "maker", label: "AI Video Maker" },
  { key: "live", label: "Live Production Center" },
  { key: "calendar", label: "Contentkalender" },
  { key: "youtube", label: "YouTube" },
  { key: "stats", label: "Analytics" },
  { key: "settings", label: "Instellingen" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const HASH: Record<Tab, string> = { overview: "overzicht", pipeline: "pijplijn", library: "gameplay", maker: "maker", live: "live", calendar: "kalender", youtube: "youtube", stats: "cijfers", settings: "instellingen" };
const ICON: Record<Tab, typeof LayoutDashboard> = { overview: LayoutDashboard, pipeline: Clapperboard, library: Film, maker: Wand2, live: Radio, calendar: CalendarDays, youtube: MonitorPlay, stats: BarChart3, settings: Settings };
/** Where each of the 11 parts sits in the order, with the parts that come later. */
const NAV: ({ tab: Tab } | { later: string; note: string; icon: typeof LayoutDashboard })[] = [
  { tab: "overview" },
  { tab: "pipeline" },
  { tab: "library" },
  { tab: "maker" },
  { tab: "live" },
  { tab: "calendar" },
  { tab: "youtube" },
  { tab: "stats" },
  { later: "Growth Lab", note: "Experimenten en winnaars komen later; de signaleringen staan bij Analytics.", icon: FlaskConical },
  { later: "Financieel", note: "Komt later; de kosten van de AI-analyse staan bij Instellingen.", icon: Wallet },
  { tab: "settings" },
];

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
  const [tab, setTab] = useState<Tab>("overview");
  const analysis = useAnalysis(studio.id, isAdmin);

  // The chosen tab is kept in the address (#pijplijn), so a refresh or a link opens the same tab.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      const found = TABS.find((t) => HASH[t.key] === hash);
      if (found) setTab(found.key);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const chooseTab = (key: Tab) => {
    setTab(key);
    history.replaceState(null, "", `#${HASH[key]}`);
  };
  // On a phone the navigation scrolls sideways: keep the chosen part in view.
  useEffect(() => {
    document.querySelector(".studio-nav [aria-selected=\"true\"]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);

  // While migration 007 has not run, the database is only asked again on "Vernieuwen", not every 5 seconds.
  const dbMissing = useRef(false);
  const refresh = useCallback(
    async (full = true) => {
      const [h, state] = await Promise.all([workerHealth(), full || !dbMissing.current ? loadStudio(studio.id) : null]);
      setHealth(h);
      if (state) {
        dbMissing.current = !state.ready && state.reason === "migration";
        setDb(state);
      }
      setLocal(h ? await listLocalRecordings().catch(() => null) : null);
    },
    [studio.id],
  );

  useEffect(() => {
    if (!isAdmin) return;
    void refresh();
    const timer = setInterval(() => void refresh(false), 5000);
    return () => clearInterval(timer);
  }, [refresh, isAdmin]);

  if (!isAdmin) return <p className="py-16 text-center text-sm text-slate-500">YouTube Studio is alleen voor gezinsbeheerders.</p>;

  const dbReady = db?.ready === true;
  const dbRecordings = db?.ready ? db.recordings : [];

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
      await Promise.all([refresh(), analysis.refresh()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dat lukte niet.");
    }
  };

  return (
    <div className="studio mx-auto max-w-6xl space-y-4">
      <div className="studio-header flex flex-wrap items-end justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            YouTube Studio <span className="text-sm font-normal text-violet-700">Kivoxel</span>
          </h1>
          <p className="text-sm text-slate-500">Faceless kanaal met Minecraft-gameplay (PS5). Geen gezicht, naam, stem of gamertag van Maes in beeld. Alleen voor beheerders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => chooseTab("library")}>
            <Upload className="h-4 w-4" aria-hidden /> Nieuwe opname uploaden
          </Button>
          <Button variant="secondary" onClick={() => void Promise.all([refresh(), analysis.refresh()])}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Vernieuwen
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}


      <div className="gap-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Onderdelen van YouTube Studio" className="studio-nav -mx-4 mb-4 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:overflow-visible lg:px-0">
        <ul role="tablist" className="flex gap-1 lg:sticky lg:top-4 lg:flex-col">
          {NAV.map((item) => {
            if ("later" in item) {
              const Icon = item.icon;
              return (
                <li key={item.later} title={item.note} className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-400 lg:flex">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="flex-1">{item.later}</span>
                  <StatusBadge status="later" />
                </li>
              );
            }
            const t = TABS.find((x) => x.key === item.tab)!;
            const Icon = ICON[t.key];
            const active = tab === t.key;
            return (
              <li key={t.key}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => chooseTab(t.key)}
                  className={`flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors ${active ? "bg-cyan-50 font-medium text-cyan-900 shadow-[inset_3px_0_0_var(--color-cyan-500)]" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-cyan-600" : "text-slate-400"}`} aria-hidden />
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 space-y-4">

      {tab === "overview" && (
        <>
          <TodayOverview overview={overviewFrom(db, analysis.state, health === undefined ? undefined : !!health)} onOpen={chooseTab} />
          <Notices studioId={studio.id} onOpen={chooseTab} />
          <Section title="Stand van de productielijn" intro="Per stap: werkt, nog te verbinden of later. Er gaat niets online zonder jouw goedkeuring.">
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
          </Section>
          <Section title="Formats om te testen" intro="Uit het onderzoek van pakket 50 (docs/youtube-onderzoek.md). Starttaal: Engels.">
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
          </Section>
        </>
      )}
      {tab === "library" && (
        <>
          <InboxCard health={health} />
          <UploadCard workerOnline={!!health} isKnown={(fp) => (dbReady ? isKnownRecording(studio.id, fp) : Promise.resolve(false))} onReceived={onReceived} />
          <Section title="Opnames op de pc" intro="De ruwe opnames staan alleen op de pc. Hier zie je wat FFmpeg erover heeft uitgelezen.">
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
          </Section>
        </>
      )}
      {tab === "pipeline" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="text-slate-600">Een nieuwe video begint met een opname. Een video bewerken doe je met Bewerken bij de video zelf.</span>
            <Button onClick={() => chooseTab("library")}>
              <Upload className="h-4 w-4" aria-hidden /> Nieuwe opname uploaden
            </Button>
          </div>
          <AnalysisSection state={analysis.state} studioId={studio.id} act={act} analysisService={health ? (health.analysis ?? null) : undefined} onWatch={() => chooseTab("live")} />
          <Section title="Wachtrij" intro="Opdrachten die het dashboard voor de werker klaarzet. De werker pakt ze één voor één op.">
            {db === null ? (
              <p className="text-sm text-slate-500">Laden…</p>
            ) : !db.ready ? (
              db.reason === "migration" ? (
                <p className="text-sm text-slate-600">De tabellen in Supabase komen er met migratie 007 (nog niet uitgevoerd). Tot die tijd verwerkt de werker nieuwe opnames meteen zelf.</p>
              ) : (
                <Notice tone="error">{db.message}</Notice>
              )
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
          </Section>
        </>
      )}
      {tab === "live" && <LiveCenter studioId={studio.id} analysis={analysis.state?.ready ? analysis.state : null} workerOnline={health === undefined ? undefined : !!health} act={act} onOpenPipeline={() => chooseTab("pipeline")} />}
      {tab === "stats" && <StatsCenter studioId={studio.id} workerOnline={health === undefined ? undefined : !!health} />}
      {tab === "maker" && <VideoMaker state={analysis.state} studioId={studio.id} act={act} refresh={analysis.refresh} onOpen={chooseTab} />}
      {tab === "calendar" && <ContentCalendar studioId={studio.id} onOpen={() => chooseTab("pipeline")} />}
      {tab === "youtube" && <PublicationsOverview studioId={studio.id} onOpen={() => chooseTab("pipeline")} />}
      {tab === "settings" && (
        <>
          <ChannelCard studioId={studio.id} onError={setError} />
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

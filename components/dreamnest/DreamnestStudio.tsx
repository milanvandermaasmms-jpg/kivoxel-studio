"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Notice, Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { YouTubeConnection } from "@/components/youtube/YouTubeConnection";
import { DURATIONS_MIN } from "@/lib/dreamnest/core";
import { archiveEpisode, cancelStep, createEpisode, loadEpisodes, loadJobs, queueStep, type DnJobRow, type Episode } from "@/lib/dreamnest/data";
import { euro, nextStep, stepViews, type FlowStep, type StepPayload } from "@/lib/dreamnest/steps";
import type { Channel } from "@/lib/youtube/channels";
import type { WorkerHealth } from "@/lib/youtube/protocol";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { pageVisible } from "@/lib/visible";

const STATE_LABEL = { todo: "Nog niet gedaan", queued: "In de wachtrij", running: "Bezig", done: "Klaar", failed: "Mislukt" } as const;
const STATE_TONE = { todo: "bg-slate-100 text-slate-600", queued: "bg-sky-50 text-sky-800", running: "bg-amber-50 text-amber-900", done: "bg-emerald-50 text-emerald-800", failed: "bg-red-50 text-red-800" } as const;
const media = (path: string) => `${WORKER_URL}/dreamnest/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Dreamnest in the Studio (fase 0.5, megaprompt §2.1): every production step from here, no terminal. Each step
 * waits for Goedkeuren; Opnieuw and Aanpassen redo one step. Paid steps say their maximum on the button.
 */
export function DreamnestStudio({ channel, channels, studioId, isAdmin, health, onChannelsChanged }: { channel: Channel; channels: Channel[]; studioId: string; isAdmin: boolean; health: WorkerHealth | null | undefined; onChannelsChanged: () => void }) {
  const [episodes, setEpisodes] = useState<Episode[] | null | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [jobs, setJobs] = useState<DnJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const eps = await loadEpisodes(studioId, channel.id);
      setEpisodes(eps);
      const id = selected && eps?.some((e) => e.id === selected) ? selected : (eps?.[0]?.id ?? null);
      setSelected(id);
      setJobs(id ? await loadJobs(id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden lukte niet.");
    }
  }, [studioId, channel.id, selected]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // While something runs: every 5 s (only when the page is visible), otherwise every 30 s.
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    const t = window.setInterval(() => pageVisible() && void refresh(), active ? 5000 : 30_000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dat lukte niet.");
    } finally {
      setBusy(false);
    }
  };

  const episode = episodes?.find((e) => e.id === selected) ?? null;
  const workerReady = !!health?.dreamnest;

  return (
    <div className="space-y-4">
      <div className="studio-header flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <span aria-hidden>🌙</span> <span className="dn-gold">Dreamnest</span> Studio
          </h1>
          <p className="text-sm dn-muted">Slaapvideo&apos;s van een uur en langer met Lumi. Er gaat niets online zonder jouw klik.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="dn-muted">Uploaden naar:</span>
          {channel.youtube_thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={channel.youtube_thumbnail_url} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span aria-hidden>🌙</span>
          )}
          <span className="font-medium">{channel.youtube_title ?? `${channel.name} (nog niet gekoppeld)`}</span>
          <Button variant="secondary" onClick={() => void refresh()} aria-label="Vernieuwen">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {health === null && <Notice tone="error">De werker is niet bereikbaar. Start hem op de pc; tot dan blijven stappen in de wachtrij staan.</Notice>}
      {health && !workerReady && <Notice tone="error">De werker draait zonder Dreamnest (versie {health.version}). Zet FEATURE_DREAMNEST=true in worker\.env.local; daarna is één herstart nodig.</Notice>}

      {episodes === undefined ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Laden…
        </p>
      ) : episodes === null ? (
        <Notice tone="error">Migratie 052 is nog niet uitgevoerd.</Notice>
      ) : (
        <div className="gap-4 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
          <EpisodeList episodes={episodes} selected={selected} onSelect={setSelected} canAdd={isAdmin} busy={busy} onAdd={(title, min) => act(async () => setSelected(await createEpisode(studioId, channel.id, title, min)))} />
          <div className="min-w-0 space-y-4">
            {episode ? (
              <EpisodeBoard episode={episode} jobs={jobs} busy={busy} isAdmin={isAdmin} act={act} studioId={studioId} />
            ) : (
              <p className="rounded-xl border border-slate-200 px-4 py-10 text-sm text-slate-500">Nog geen aflevering. Begin links met &quot;Nieuwe aflevering&quot;.</p>
            )}
          </div>
        </div>
      )}

      <Section title="Kanaal en YouTube" intro="Elk kanaal heeft een eigen YouTube-koppeling. Vóór elke upload controleert de werker of het YouTube-kanaal klopt.">
        <YouTubeConnection channel={channel} anotherLinked={channels.some((o) => o.id !== channel.id && !!o.youtube_connected_at)} onChanged={async () => onChannelsChanged()} />
      </Section>
    </div>
  );
}

function EpisodeList({ episodes, selected, onSelect, canAdd, busy, onAdd }: { episodes: Episode[]; selected: string | null; onSelect: (id: string) => void; canAdd: boolean; busy: boolean; onAdd: (title: string, minutes: number) => Promise<void> }) {
  const [title, setTitle] = useState("Lumi's Cozy Fireplace Night");
  const [minutes, setMinutes] = useState<number>(60);
  const [open, setOpen] = useState(false);
  return (
    <aside className="mb-4 space-y-2 lg:mb-0">
      <h2 className="text-sm font-semibold">Afleveringen</h2>
      <ul className="space-y-1">
        {episodes.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onSelect(e.id)} aria-current={e.id === selected} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${e.id === selected ? "bg-cyan-50 font-medium text-cyan-900" : "hover:bg-slate-100"}`}>
              {e.title}
              <span className="block text-xs text-slate-500">
                {e.duration_min} min · uitgegeven {euro(e.spent_cents)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {canAdd &&
        (open ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
            <label className="block">
              Titel
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 bg-transparent px-2 py-1" />
            </label>
            <label className="block">
              Lengte{" "}
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-md border border-slate-300 bg-transparent px-2 py-1">
                {DURATIONS_MIN.map((m) => (
                  <option key={m} value={m}>
                    {m >= 120 ? `${m / 60} uur` : `${m} min`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void onAdd(title, minutes).then(() => setOpen(false))}>
                Aanmaken
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Annuleren
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            + Nieuwe aflevering
          </Button>
        ))}
    </aside>
  );
}

function EpisodeBoard({ episode, jobs, busy, isAdmin, act, studioId }: { episode: Episode; jobs: DnJobRow[]; busy: boolean; isAdmin: boolean; act: (fn: () => Promise<unknown>) => Promise<void>; studioId: string }) {
  const views = stepViews(jobs);
  const next = nextStep(views);
  const anyActive = views.some((v) => v.state === "queued" || v.state === "running");
  const start = (f: FlowStep, payload: StepPayload = {}) => act(() => queueStep(studioId, episode.id, f.step, payload));
  return (
    <>
      <Section title={episode.title} intro={`${episode.duration_min} minuten · uitgegeven ${euro(episode.spent_cents)} · elke stap wacht op jouw Goedkeuren`}>
        <ol className="space-y-3">
          {views.map((v, i) => {
            const job = v.job as DnJobRow | null;
            const files = ((job?.result?.files as string[] | undefined) ?? []).slice(0, 24);
            const isNext = next?.step === v.flow.step;
            const later = views.slice(i + 1).some((w) => w.state !== "todo");
            return (
              <li key={v.flow.step} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {i + 1}. {v.flow.label} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${STATE_TONE[v.state]}`}>{STATE_LABEL[v.state]}{v.state === "running" && job?.progress ? ` ${Math.round(job.progress)}%` : ""}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {v.flow.about} {v.flow.maxCents > 0 ? `Hoogstens ${euro(v.flow.maxCents)}; wat al gemaakt is, komt uit de opslag (gratis).` : "Gratis, op de pc."}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex flex-wrap gap-2">
                      {isNext && !anyActive && (
                        <Button disabled={busy} onClick={() => void start(v.flow)}>
                          {i === 0 ? "Starten" : "Goedkeuren en starten"}
                          {v.flow.maxCents > 0 ? ` (max ${euro(v.flow.maxCents)})` : ""}
                        </Button>
                      )}
                      {v.state === "queued" && job && (
                        <Button variant="ghost" disabled={busy} onClick={() => void act(() => cancelStep(job.id))}>
                          Annuleren
                        </Button>
                      )}
                      {v.state === "done" && !anyActive && (
                        <>
                          <Button variant="secondary" disabled={busy} onClick={() => void start(v.flow, job?.payload ?? {})} title={later ? "Latere stappen moet je daarna opnieuw goedkeuren" : undefined}>
                            Opnieuw
                          </Button>
                          {v.flow.adjust && <Adjust flow={v.flow} files={files} busy={busy} onRun={(p) => void start(v.flow, p)} />}
                        </>
                      )}
                    </div>
                  )}
                </div>
                {v.state === "running" && typeof job?.result?.last === "string" && <p className="mt-2 truncate font-mono text-xs text-slate-500">{job.result.last}</p>}
                {v.state === "failed" && job?.error && <p className="mt-2 text-sm text-red-800">{job.error}</p>}
                {v.state === "done" && job?.result && <StepResult step={v.flow.step} result={job.result} files={files} />}
              </li>
            );
          })}
        </ol>
      </Section>
      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="ghost" disabled={busy || anyActive} onClick={() => void act(() => archiveEpisode(episode.id))}>
            Aflevering archiveren
          </Button>
        </div>
      )}
    </>
  );
}

function Adjust({ flow, files, busy, onRun }: { flow: FlowStep; files: string[]; busy: boolean; onRun: (p: StepPayload) => void }) {
  const [clip, setClip] = useState("");
  if (flow.adjust === "seed")
    return (
      <Button variant="secondary" disabled={busy} onClick={() => onRun({ seed: 1 + Math.floor(Math.random() * 9999) })} title="Een andere variant van dezelfde stap">
        Aanpassen: andere variant
      </Button>
    );
  const ids = files.map((f) => f.split("/").pop()!.replace(/\.mp4$/, ""));
  return (
    <span className="flex items-center gap-1">
      <select value={clip} onChange={(e) => setClip(e.target.value)} aria-label="Clip om opnieuw te maken" className="max-w-[12rem] rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm">
        <option value="">Eén clip opnieuw…</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <Button variant="secondary" disabled={busy || !clip} onClick={() => onRun({ only: clip })} title="Alleen deze clip; kost hoogstens één clip (± € 0,85)">
        Aanpassen
      </Button>
    </span>
  );
}

function StepResult({ step, result, files }: { step: string; result: Record<string, unknown>; files: string[] }) {
  const paid = typeof result.paid_cents === "number" && result.paid_cents > 0 ? <p className="text-xs text-slate-500">Kosten van deze stap: {euro(result.paid_cents)}</p> : null;
  if (step === "dn_concept")
    return (
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
        {((result.story as string[] | undefined) ?? []).map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    );
  const images = files.filter((f) => /\.(png|jpe?g)$/i.test(f));
  const videos = files.filter((f) => /\.mp4$/i.test(f));
  const audio = files.filter((f) => /\.m4a$/i.test(f));
  return (
    <div className="mt-2 space-y-2">
      {paid}
      {step === "dn_render" && (
        <p className={`text-sm ${result.qc_ok ? "text-emerald-800" : "text-red-800"}`}>
          {result.qc_ok ? "QC ✅: beeld en geluid in orde." : `QC ❌: ${((result.qc_problems as string[] | undefined) ?? []).join("; ")}`}
          {typeof result.video === "string" && <span className="block text-xs text-slate-500">Hele aflevering op de pc: dreamnest\{result.video.replaceAll("/", "\\")}</span>}
        </p>
      )}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f} src={media(f)} crossOrigin="anonymous" alt={f.split("/").pop()} loading="lazy" className="aspect-video w-full rounded bg-slate-100 object-cover" />
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className={`grid gap-2 ${videos.length > 1 ? "grid-cols-2 sm:grid-cols-4" : ""}`}>
          {videos.map((f) => (
            <video key={f} src={media(f)} crossOrigin="anonymous" controls muted={videos.length > 1} playsInline preload="metadata" className="w-full rounded bg-black" aria-label={f.split("/").pop()} />
          ))}
        </div>
      )}
      {audio.map((f) => (
        <audio key={f} src={media(f)} crossOrigin="anonymous" controls preload="none" className="w-full" />
      ))}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Section } from "@/components/settings/Section";
import { StatusBadge } from "@/components/shell/StatusBadge";
import { Button } from "@/components/ui/Dialog";
import { estimateAnalysisCents, FOOTAGE_NEEDED, FORMAT_FOR_KIND, formatTimecode, KIND_LABEL, missingFormats, PRIVACY_LABEL, TARGET, type Format, type PrivacyFlag } from "@/lib/youtube/analysis";
import { archiveVideo, createManualVideos, euros, loadAnalysis, markAsRealGameplay, queueAnalysis, queueRender, regenerateScript, savePrivacySettings, saveSettings, saveVoiceSettings, setChosenHook, setScriptStatus, setVideoReview, VOICES, type AnalysisState, type DbMoment, type DbRender, type DbScript, type DbVideo, type MontageState, type PrivacySettings, type VoiceSettings } from "@/lib/youtube/analysisData";
import { ViralCard } from "@/components/youtube/ViralCard";
import { pageVisible } from "@/lib/visible";
import { Editor } from "@/components/youtube/Editor";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { DEFAULT_BLUR_REGIONS, type Region } from "@/lib/youtube/render";
import { HOOK_TYPE_LABEL } from "@/lib/youtube/hooks";
import { repetitions, type Repetition, type ScriptText } from "@/lib/youtube/originality";
import { QC_LEVEL_LABEL, type QcItem } from "@/lib/youtube/qc";
import { reviewBlockers, reviewChecks } from "@/lib/youtube/review";
import { FORMATS, JOB_STATUS_LABEL, formatDuration } from "@/lib/youtube/studio";

const SCRIPT_STATUS: Record<DbScript["status"], string> = { draft: "Concept", approved: "Goedgekeurd", rejected: "Afgekeurd" };
const VIDEO_STATUS: Record<string, string> = { idea: "Wacht op script", scripted: "Script klaar", rendering: "Montage", review: "Controle", approved: "Goedgekeurd", scheduled: "Ingepland", published: "Gepubliceerd", failed: "Mislukt", archived: "Gearchiveerd" };
const PART_LABEL: Record<string, string> = { hook: "Hook", build: "Opbouw", payoff: "Afloop", teaser: "Teaser", search: "Zoeken", discovery: "Ontdekking", aftermath: "Daarna", cold_open: "Cold open", goals: "Doelen", chapter: "Hoofdstuk" };

const Check = ({ ok, label, note }: { ok: boolean; label: string; note: string | null }) => (
  <span className={ok ? "text-emerald-700" : "text-amber-800"}>
    {ok ? "✓" : "✗"} {label}
    {note ? `: ${note}` : ""}
  </span>
);
const TestBadge = () => <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">testdata</span>;

type Act = (action: () => Promise<unknown>) => Promise<void>;

/** Analysis, scripts and montage from Supabase, refreshed every 5 seconds (not while migration 009 is missing). */
export function useAnalysis(studioId: string, enabled: boolean) {
  const [state, setState] = useState<AnalysisState | null>(null);
  const missing = useRef(false);
  const last = useRef("");
  const refresh = useCallback(async () => {
    const s = await loadAnalysis(studioId);
    missing.current = !s.ready && s.reason === "migration";
    // Fase 1.4: only a real change re-renders the long list; a poll that brought nothing new changes nothing.
    const key = JSON.stringify(s);
    if (key === last.current) return;
    last.current = key;
    setState(s);
  }, [studioId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => pageVisible() && !missing.current && void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh, enabled]);

  return { state, refresh };
}

function NotReady({ state, title }: { state: AnalysisState | null; title: string }) {
  if (state === null)
    return (
      <Section title={title}>
        <p className="text-sm text-slate-500">Laden…</p>
      </Section>
    );
  if (state.ready) return null;
  return (
    <Section title={title}>
      {state.reason === "migration" ? <p className="text-sm text-slate-600">De tabellen voor momenten, scripts en het maandplafond komen er met migratie 009 (nog niet uitgevoerd).</p> : <Notice tone="error">{state.message}</Notice>}
    </Section>
  );
}

/** Settings tab: monthly cap for the paid analysis, and voice and sound for the montage. */
export function AnalysisSettings({ state, studioId, act, analysisService, voiceConnected }: { state: AnalysisState | null; studioId: string; act: Act; analysisService: string | null | undefined; voiceConnected?: boolean }) {
  if (!state?.ready) return <NotReady state={state} title="Analysedienst en maandplafond" />;
  const languages = new Set(state.videos.map((v) => v.language));
  return (
    <>
      <BudgetCard state={state} service={analysisService} onSave={(enabled, cap) => act(() => saveSettings(studioId, enabled, cap))} />
      {state.montage && <VoiceCard key={JSON.stringify(state.montage.voice)} voice={state.montage.voice} connected={voiceConnected} dutchScripts={languages.has("nl")} onSave={(v) => act(() => saveVoiceSettings(studioId, v))} />}
      {state.montage &&
        (state.montage.privacy ? (
          <PrivacyCard key={JSON.stringify(state.montage.privacy)} privacy={state.montage.privacy} onSave={(p) => act(() => savePrivacySettings(studioId, p))} />
        ) : (
          <Section title="Vervagen en dempen">
            <p className="text-sm text-slate-600">Komt er met migratie 031 (nog niet uitgevoerd). Tot die tijd kan een video met een privacyvlag niet worden goedgekeurd.</p>
          </Section>
        ))}
    </>
  );
}

/** analysisService: the model the worker uses, null when it has no key, undefined when the worker is not reachable. */
/**
 * Two ways to show the recordings (opschonen 13-11-2026):
 * - "recordings": per recording the analysis, the moments and "zelf samenstellen", WITHOUT the videos (those each have
 *   one place elsewhere).
 * - "review": only the videos that wait for Milan (the filter), compact: closed cards, no recording tools.
 */
export function AnalysisSection({ state, studioId, act, analysisService, onWatch, mode = "recordings", showVideo, expand = false }: { state: AnalysisState | null; studioId: string; act: Act; analysisService: string | null | undefined; onWatch?: (videoId: string) => void; mode?: "recordings" | "review"; showVideo?: (videoId: string) => boolean; expand?: boolean }) {
  if (!state?.ready) return <NotReady state={state} title={mode === "review" ? "Te keuren" : "Opnames en momenten"} />;
  const review = mode === "review";
  // Repetition check (fase C4): every real video against the other real videos, newest first.
  const texts: ScriptText[] = state.videos
    .filter((v) => !v.is_test)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .flatMap((v) => {
      const s = state.scripts.find((x) => x.video_id === v.id);
      return s ? [{ videoId: v.id, label: s.top_line ?? `format ${v.format}`, topLine: s.top_line, hook: s.hook, narration: s.lines.map((l) => l.text).join(" ") }] : [];
    });
  const repeatsFor = (id: string) => {
    const self = texts.find((t) => t.videoId === id);
    return self ? repetitions(self, texts) : [];
  };
  return (
    <>
      <Section title={review ? "Te keuren, in detail" : "Opnames en momenten"} intro={review ? "Klik een video open voor de preview, de Viral-score, het script en de knoppen." : "Per opname: de analyse, de gevonden momenten en zelf samenstellen. De video's zelf staan bij Actie nodig, In productie of Live."}>
        {state.recordings.filter((r) => r.status === "ready" && (!review || state.videos.some((v) => v.recording_id === r.id && showVideo?.(v.id)))).length === 0 ? (
          <p className="text-sm text-slate-500">{review ? "Niets te keuren." : "Nog geen opnames waarvan de intake klaar is."}</p>
        ) : (
          <ul className="space-y-4">
            {state.recordings
              .filter((r) => r.status === "ready" && (!review || state.videos.some((v) => v.recording_id === r.id && showVideo?.(v.id))))
              .map((r) => {
                const moments = state.moments.filter((m) => m.recording_id === r.id);
                const all = state.videos.filter((v) => v.recording_id === r.id && v.yt_video_moments.length > 0);
                const videos = review ? all.filter((v) => showVideo?.(v.id)) : [];
                const job = state.analyseJobs[r.id];
                return (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {r.label} {r.is_test && <TestBadge />} <span className="text-xs font-normal text-slate-500">· {formatDuration(r.duration_ms)}{!review ? ` · ${all.length} ${all.length === 1 ? "video" : "video's"}` : ` · ${videos.length} te keuren`}</span>
                      </p>
                      {review ? null : job ? (
                        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          Analyse: {JOB_STATUS_LABEL[job as keyof typeof JOB_STATUS_LABEL] ?? job}
                          {job === "failed" ? " (zie de wachtrij)" : ""}
                          {job === "done" && !r.is_test && state.settings?.paid_processing_enabled && analysisService && (
                            <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => void act(() => queueAnalysis(studioId, r.id, true))}>
                              Opnieuw analyseren (± {euros(estimateAnalysisCents(r.duration_ms ?? 0))})
                            </Button>
                          )}
                        </span>
                      ) : r.is_test || (state.settings?.paid_processing_enabled && analysisService) ? (
                        <Button variant="secondary" onClick={() => void act(() => queueAnalysis(studioId, r.id))}>
                          Analyseren
                        </Button>
                      ) : (
                        <StatusBadge status="connect" />
                      )}
                    </div>
                    {!review && !r.is_test && !job && !(state.settings?.paid_processing_enabled && analysisService) && (
                      <p className="mt-1 text-xs text-slate-500">
                        {state.settings?.paid_processing_enabled ? "Wacht op de werker met een Gemini-sleutel." : "Zet eerst betaalde verwerking aan, met een maandplafond."}
                      </p>
                    )}
                    {!review && r.is_test && (
                      <RealGameplayFix canAnalyse={!!(state.settings?.paid_processing_enabled && analysisService)} onConfirm={(label) => act(() => markAsRealGameplay(studioId, r.id, label))} />
                    )}
                    {!review && moments.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-600">Gevonden momenten ({moments.length})</summary>
                        <MomentList moments={moments} />
                        {job === "done" && <MissingFootage hasMoments={moments.length > 0} formats={missingFormats(all.map((v) => v.format))} />}
                      </details>
                    )}
                    {!review && moments.length > 0 && !r.is_test && <ManualMaker moments={moments.filter((m) => m.usable)} onMake={(chosen, long) => act(() => createManualVideos(studioId, r.id, chosen, long))} />}

                    {videos.map((v) => (
                      <VideoCard key={v.id} compact={review && !expand} video={v} moments={moments} scripts={state.scripts.filter((s) => s.video_id === v.id)} montage={state.montage} act={act} studioId={studioId} workerOnline={analysisService !== undefined} onWatch={onWatch} repeats={repeatsFor(v.id)} recordingMs={r.duration_ms} />
                    ))}
                  </li>
                );
              })}
          </ul>
        )}
      </Section>
    </>
  );
}

function BudgetCard({ state, service, onSave }: { state: Extract<AnalysisState, { ready: true }>; service: string | null | undefined; onSave: (enabled: boolean, capCents: number) => Promise<void> }) {
  const s = state.settings;
  const [cap, setCap] = useState(s ? String(s.monthly_cap_cents / 100).replace(".", ",") : "");
  const [agree, setAgree] = useState(s?.paid_processing_enabled ?? false);
  const capCents = Math.round(Number(cap.replace(",", ".")) * 100);
  const validCap = Number.isFinite(capCents) && capCents > 0 && capCents <= 100_000;
  const used = s && s.monthly_cap_cents > 0 ? Math.min(100, Math.floor((state.spentCents / s.monthly_cap_cents) * 100)) : 0;
  const warn = s ? used >= s.warn_at_percent : false;
  return (
    <Section title="Analysedienst en maandplafond" intro="Voor echte opnames is een betaalde AI-dienst nodig. Er wordt niets betaald zonder jouw akkoord en een maandplafond; de werker stopt vóór een stap die het plafond zou overschrijden.">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-slate-500">Dienst</dt>
        <dd>
          Gemini 3.5 Flash-Lite, betaalde laag (ongeveer € 0,10-0,35 per uur gameplay; gekozen op 11-11-2026){" "}
          {service ? <span className="text-xs text-emerald-700">verbonden</span> : service === null ? <StatusBadge status="connect" /> : <span className="text-xs text-slate-500">(werker niet bereikbaar)</span>}
        </dd>
        <dt className="text-slate-500">Betaalde verwerking</dt>
        <dd>{s?.paid_processing_enabled ? `Aan, akkoord op ${new Date(s.approved_at!).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" })}` : "Uit: alleen testdata wordt (gratis) verwerkt"}</dd>
        <dt className="text-slate-500">Deze maand gebruikt</dt>
        <dd>
          {euros(state.spentCents)}
          {s?.monthly_cap_cents ? ` van ${euros(s.monthly_cap_cents)}` : ""}
          {s?.monthly_cap_cents ? (
            <span className="mt-1 block h-1.5 w-full max-w-xs overflow-hidden rounded bg-slate-100">
              <span className={`block h-full ${warn ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${used}%` }} />
            </span>
          ) : null}
          {warn && <span className="block text-xs text-amber-800">Let op: {used}% van het plafond is gebruikt.</span>}
        </dd>
      </dl>
      <form
        className="mt-3 flex flex-wrap items-end gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (validCap || !agree) void onSave(agree, validCap ? capCents : 0);
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Maandplafond in euro</span>
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="bijv. 5" className="w-28 rounded-md border border-slate-300 bg-transparent px-2 py-1" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          Akkoord met betaalde verwerking tot dit plafond
        </label>
        <Button type="submit" disabled={agree && !validCap}>
          Opslaan
        </Button>
      </form>
      {agree && !validCap && <p className="mt-1 text-xs text-amber-800">Vul een plafond in tussen € 0,01 en € 1.000.</p>}
    </Section>
  );
}

/** For a recording uploaded as test data by mistake: rename it and run the real (paid) analysis instead. */
function RealGameplayFix({ canAnalyse, onConfirm }: { canAnalyse: boolean; onConfirm: (label: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const valid = label.trim().length > 0 && !/^testdata/i.test(label.trim());
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700">
        Is dit toch echte gameplay van Maes?
      </button>
    );
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-3 text-sm">
      <p className="text-xs text-slate-600">
        De opname krijgt een nieuwe naam, de gratis testanalyse en de testvideo&apos;s verdwijnen, en de werker analyseert hem opnieuw met Gemini (betaald, binnen het maandplafond).
      </p>
      <label className="grid gap-1">
        <span className="text-xs text-slate-500">Nieuwe naam (geen echte naam of gamertag)</span>
        <input value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="bijv. 11-11 grot met creepers" className="rounded-md border border-slate-300 bg-transparent px-2 py-1" />
      </label>
      {!canAnalyse && <p className="text-xs text-amber-800">Eerst betaalde verwerking aanzetten en de werker met een Gemini-sleutel starten.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!valid || !canAnalyse} onClick={() => void onConfirm(label).then(() => setOpen(false))}>
          Als echte gameplay analyseren
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Annuleren
        </Button>
      </div>
    </div>
  );
}

/** After the analysis: which formats this recording does not support, and what gameplay would make them possible. */
function MissingFootage({ hasMoments, formats }: { hasMoments: boolean; formats: Format[] }) {
  if (!formats.length) return null;
  const none = formats.length === 3;
  return (
    <div className="mt-2 rounded-md border border-amber-200 px-3 py-2 text-xs text-amber-800">
      <p className="font-medium">
        {none ? (hasMoments ? "Geen moment met zowel context als afloop: hier komt nog geen video uit." : "Geen bruikbare momenten gevonden in deze opname.") : "Met deze opname nog niet mogelijk:"}
      </p>
      <p className="mt-0.5">{none ? "Voor een volgende video is gameplay nodig met één van deze dingen:" : "Daarvoor is gameplay nodig met:"}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {formats.map((f) => (
          <li key={f}>
            <span className="font-medium">Format {f}</span>: {FOOTAGE_NEEDED[f]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MomentList({ moments }: { moments: DbMoment[] }) {
  return (
    <ul className="mt-2 divide-y divide-slate-100 text-sm">
      {moments.map((m) => (
        <li key={m.id} className="py-2">
          <p>
            <span className="font-mono text-xs">
              {formatTimecode(m.start_ms)}–{formatTimecode(m.end_ms)}
            </span>{" "}
            <span className="font-medium">{KIND_LABEL[m.kind]}</span> <span className="text-xs text-slate-500">· score {m.score} · past bij format {m.suggested_format ?? FORMAT_FOR_KIND[m.kind]}</span>
            {m.is_test && <TestBadge />}
          </p>
          <p className="text-slate-700">{m.reason}</p>
          <p className="flex flex-wrap gap-x-3 text-xs">
            <Check ok={m.has_context} label="Context" note={m.context_note} />
            <Check ok={m.has_payoff} label="Afloop" note={m.payoff_note} />
            {m.privacy_flags.length > 0 && <span className="text-red-700">Privacy: {m.privacy_flags.map((f) => PRIVACY_LABEL[f]).join(", ")} (vervagen of dempen)</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function VideoCard({ compact = false, video, moments, scripts, montage, act, studioId, workerOnline, onWatch, repeats, recordingMs }: { compact?: boolean; video: DbVideo; moments: DbMoment[]; scripts: DbScript[]; montage: MontageState; act: Act; studioId: string; workerOnline: boolean; onWatch?: (videoId: string) => void; repeats?: Repetition[]; recordingMs: number | null }) {
  const [editing, setEditing] = useState(false);
  const format = FORMATS.find((f) => f.key === video.format);
  // Always show the newest version, so a regenerated script can be read and approved; say which one is approved.
  const script = scripts[0];
  const approved = scripts.find((s) => s.status === "approved");
  const target = TARGET[video.format];
  const used = [...video.yt_video_moments].sort((a, b) => a.position - b.position).map((l) => moments.find((m) => m.id === l.moment_id)).filter((m): m is DbMoment => !!m);
  const nextVersion = (scripts[0]?.version ?? 0) + 1;
  const waits = video.status === "review" || script?.status === "draft";
  const [open, setOpen] = useState(waits && !compact);
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="group mt-3 rounded-md border border-slate-200 p-3 text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <p className="font-medium">
          <span aria-hidden className="mr-1 inline-block text-slate-400 transition-transform group-open:rotate-90">▸</span>
          {script?.top_line ?? `Format ${video.format}: ${format?.name}`} <span className="text-xs font-normal text-slate-500">· {format?.kind} · {VIDEO_STATUS[video.status] ?? video.status}</span>
          {video.is_test && <TestBadge />}
        </p>
        <p className="text-xs text-slate-500">
          {waits && <span className="mr-2 rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-800">👀 Wacht op jou</span>}
          Momenten: {used.map((m) => `${KIND_LABEL[m.kind]} ${formatTimecode(m.start_ms)}`).join(", ")}
        </p>
      </summary>
      {/* Closed cards load nothing: no previews that fill the connections to the worker. */}
      {open && (
        <>
      {video.promise && <p className="text-xs text-slate-600">Kijkersbelofte: {video.promise}</p>}
      {!script ? (
        <p className="mt-2 text-xs text-slate-500">Het script wordt gemaakt…</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-500">
            Versie {script.version} · {SCRIPT_STATUS[script.status]} · lengte {formatTimecode(script.target_ms)}
            {scripts.length > 1 ? ` · ${scripts.length} versies` : ""}
            {approved && approved.id !== script.id ? ` · versie ${approved.version} is goedgekeurd` : ""}
          </p>
          {(script.target_ms < target.minMs || script.target_ms > target.maxMs) && (
            <p className="text-xs text-amber-800">
              {script.target_ms < target.minMs ? "Korter" : "Langer"} dan de richtlengte ({formatTimecode(target.minMs)}–{formatTimecode(target.maxMs)}).
            </p>
          )}
          {script.top_line && (
            <p>
              <span className="text-xs text-slate-500">Tekst bovenin: </span>
              <span className="font-semibold">{script.top_line}</span>
            </p>
          )}
          {script.hooks && script.hooks.length > 0 ? (
            <HookChoice script={script} act={act} />
          ) : (
            <p>
              <span className="text-xs text-slate-500">Hook: </span>
              {script.hook}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-slate-600">Script en montageplan</summary>
            <ol className="mt-1 space-y-0.5">
              {script.lines.map((l, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{formatTimecode(l.at_ms)}</span> {l.text}
                </li>
              ))}
            </ol>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 font-normal">In video</th>
                    <th className="pr-2 font-normal">Deel</th>
                    <th className="pr-2 font-normal">Uit opname</th>
                    <th className="pr-2 font-normal">Tempo</th>
                    <th className="font-normal">Wat er gebeurt</th>
                  </tr>
                </thead>
                <tbody>
                  {script.edit_plan.map((s, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-1 pr-2 font-mono">{formatTimecode(s.out_start_ms)}</td>
                      <td className="pr-2">{PART_LABEL[s.part] ?? s.part}</td>
                      <td className="pr-2 font-mono">
                        {formatTimecode(s.src_start_ms)}–{formatTimecode(s.src_end_ms)}
                      </td>
                      <td className="pr-2">{s.speed === 1 ? "normaal" : `${s.speed.toLocaleString("nl-NL")}×`}</td>
                      <td>{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            {script.status !== "approved" && <Button onClick={() => void act(() => setScriptStatus(script, "approved"))}>Goedkeuren</Button>}
            {script.status !== "rejected" && (
              <Button variant="ghost" onClick={() => void act(() => setScriptStatus(script, "rejected"))}>
                Afkeuren
              </Button>
            )}
            <Button variant="secondary" onClick={() => void act(() => regenerateScript(studioId, video.id, nextVersion))}>
              Opnieuw genereren
            </Button>
            {!(video as DbVideo & { youtube_video_id?: string | null }).youtube_video_id && (
              <Button variant="ghost" onClick={() => void act(() => archiveVideo(video.id))}>
                Archiveren
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(!editing)}>
              {editing ? "Editor sluiten" : "Bewerken"}
            </Button>
          </div>
          {editing && (
            <Editor
              key={script.id}
              script={approved ?? script}
              nextVersion={nextVersion}
              recordingMs={recordingMs}
              peakMs={used[0] ? (used[0].peak_ms ?? Math.round((used[0].start_ms + used[0].end_ms) / 2)) : null}
              studioId={studioId}
              act={act}
              onClose={() => setEditing(false)}
            />
          )}
        </div>
      )}
      <MontageBlock video={video} approved={approved ?? null} scripts={scripts} montage={montage} act={act} studioId={studioId} workerOnline={workerOnline} privacyFlags={[...new Set(used.flatMap((m) => m.privacy_flags))]} onWatch={onWatch} repeats={repeats} />
        </>
      )}
    </details>
  );
}

/** After the preview: approve the montage for publication or send it back. Publishing itself comes in package 56. */
function ReviewBlock({ video, blockers, checks, act, qc, repeats, firstFrame }: { video: DbVideo; blockers: string[]; checks: string[]; act: Act; qc: QcItem[] | null; repeats: Repetition[]; firstFrame?: { file: string; firstLine: string } | null }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [redSeen, setRedSeen] = useState(false);
  const reds = (qc ?? []).filter((i) => i.level === "red");
  if (video.status === "scripted" && video.review_note) return <p className="mt-2 text-xs text-slate-600">Afgekeurd na de preview: {video.review_note}</p>;
  if (video.status === "approved")
    return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <span>Goedgekeurd voor publicatie. Vul hieronder de publicatie in; er gaat niets online zonder jouw klik.</span>
        <Button variant="ghost" onClick={() => void act(() => setVideoReview(video.id, "withdraw"))}>
          Goedkeuring intrekken
        </Button>
      </div>
    );
  if (video.status !== "review") return null;
  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 px-3 py-2 text-xs">
      <p className="font-medium text-slate-700">Controle: bekijk de preview en beslis</p>
      {blockers.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-800">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {blockers.length === 0 && checks.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-slate-700">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {firstFrame && <FirstFrame file={firstFrame.file} firstLine={firstFrame.firstLine} />}
      <QcList qc={qc} />
      {repeats.length > 0 && (
        <div className="rounded-md border border-amber-200 px-2 py-1.5 text-amber-800">
          <p className="font-medium">Lijkt te veel op eerdere video's (risico voor inkomsten bij herhaling)</p>
          <ul className="mt-0.5 list-disc pl-4">
            {repeats.slice(0, 5).map((r) => (
              <li key={r.videoId + r.field}>
                {r.field === "titel" ? "Tekst bovenin" : r.field === "hook" ? "Hook" : "Script"} lijkt {Math.round(r.share * 100)}% op "{r.label}"
              </li>
            ))}
          </ul>
        </div>
      )}
      {reds.length > 0 && blockers.length === 0 && !rejecting && (
        <label className="flex items-start gap-2 text-red-800">
          <input type="checkbox" checked={redSeen} onChange={(e) => setRedSeen(e.target.checked)} className="mt-0.5" />
          Ik heb de {reds.length === 1 ? "rode controle" : `${reds.length} rode controles`} bekeken en keur deze video bewust toch goed.
        </label>
      )}
      {rejecting ? (
        <div className="space-y-2">
          <label className="grid gap-1">
            <span className="text-slate-500">Waarom afkeuren? (optioneel)</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="bijv. hook te traag, gamertag nog zichtbaar" className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void act(() => setVideoReview(video.id, "reject", note)).then(() => setRejecting(false))}>Afkeuren</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Annuleren
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={blockers.length > 0 || (reds.length > 0 && !redSeen)} onClick={() => void act(() => setVideoReview(video.id, "approve"))}>
            Video goedkeuren
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(true)}>
            Afkeuren
          </Button>
        </div>
      )}
      <p className="text-slate-500">Afkeuren zet de video terug: pas het script aan (Opnieuw genereren) of maak de montage opnieuw.</p>
    </div>
  );
}

/** Montage of the approved script: the button queues it for the worker; the preview plays straight from the pc. */
/** The first thumbnail of a montage (fase C) as poster, so the video itself only loads when Milan presses play. */
const posterOf = (r: DbRender): string | undefined => {
  const file = (r as DbRender & { thumbnails?: { file: string }[] }).thumbnails?.[0]?.file;
  return file ? `${WORKER_URL}/renders/${encodeURIComponent(file)}` : undefined;
};

function MontageBlock({ video, approved, scripts, montage, act, studioId, workerOnline, privacyFlags, onWatch, repeats }: { video: DbVideo; approved: DbScript | null; scripts: DbScript[]; montage: MontageState; act: Act; studioId: string; workerOnline: boolean; privacyFlags: PrivacyFlag[]; onWatch?: (videoId: string) => void; repeats?: Repetition[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  if (montage === null) return <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">Montage komt er met migratie 030 (nog niet uitgevoerd).</p>;
  const renders = montage.renders.filter((r) => r.video_id === video.id);
  const shown = renders.find((r) => r.id === chosen) ?? renders[0];
  const jobs = approved ? montage.jobs.filter((j) => j.script_id === approved.id) : [];
  const latest = jobs[0];
  const busy = latest && (latest.status === "queued" || latest.status === "running");
  return (
    <div className="mt-3 space-y-1 border-t border-slate-200 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-700">Montage</p>
        {approved && !busy && (
          <Button variant="secondary" onClick={() => void act(() => queueRender(studioId, approved, jobs.length + 1)).then(() => onWatch?.(video.id))}>
            {renders.some((r) => r.script_id === approved.id) ? "Opnieuw monteren" : "Montage maken"}
          </Button>
        )}
      </div>
      {!approved && <p className="text-xs text-slate-500">Keur eerst een script goed; daarna kan de werker de montage maken.</p>}
      {latest && (
        <p className={`text-xs ${latest.status === "failed" ? "text-red-700" : "text-slate-600"}`}>
          Laatste montage (versie {approved?.version}): {JOB_STATUS_LABEL[latest.status as keyof typeof JOB_STATUS_LABEL] ?? latest.status}
          {latest.status === "failed" && latest.error ? `: ${latest.error}` : ""}
        </p>
      )}
      {shown &&
        (!workerOnline ? (
          <p className="text-xs text-slate-500">De preview staat op de pc. Start de werker om hem hier te bekijken.</p>
        ) : broken === shown.id ? (
          <p className="text-xs text-amber-800">Deze preview staat niet (meer) op deze pc. Maak de montage opnieuw.</p>
        ) : (
          <video
            key={shown.id}
            src={`${WORKER_URL}/renders/${encodeURIComponent(shown.file_name)}`}
            crossOrigin="anonymous"
            controls
            poster={posterOf(shown)}
            preload={posterOf(shown) ? "none" : "metadata"}
            playsInline
            onError={() => setBroken(shown.id)}
            style={{ aspectRatio: `${shown.width} / ${shown.height}` }}
            className={`rounded-md bg-black ${shown.height > shown.width ? "h-[min(70vh,40rem)] w-auto max-w-full" : "w-full"}`}
          />
        ))}
      {renders.length > 0 && (
        <ul className="space-y-0.5 text-xs text-slate-600">
          {renders.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setChosen(r.id)} className={`text-left underline-offset-2 hover:underline ${r.id === shown?.id ? "font-medium text-slate-900" : ""}`}>
                {new Date(r.created_at).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Amsterdam" })} · {formatTimecode(r.duration_ms)} · {r.width}×{r.height} · {r.voice_name ? `stem ${r.voice_name.replace(/^.*-HD-/, "")}` : "zonder stem"}
              </button>
              {r.is_test && <TestBadge />}
            </li>
          ))}
        </ul>
      )}
      {renders.length > 0 && <ViralCard studioId={studioId} videoId={video.id} scripts={scripts} approved={approved} act={act} />}
      <ReviewBlock video={video} blockers={reviewBlockers({ approvedScriptId: approved?.id ?? null, latestRender: renders[0] ?? null, renderBusy: !!busy, privacyFlags })} checks={reviewChecks(privacyFlags)} act={act} qc={renders[0]?.qc?.items ?? null} repeats={repeats ?? []} firstFrame={renders[0] && workerOnline ? { file: renders[0].file_name, firstLine: approved?.hooks?.[approved.chosen_hook ?? -1]?.first_line ?? approved?.hook ?? "" } : null} />
      {["approved", "scheduled", "published"].includes(video.status) && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Goedgekeurd. Publiceren gaat via{" "}
          <a href="#klaar" className="font-semibold underline underline-offset-2">
            🚀 Klaar voor YouTube
          </a>
          .
        </p>
      )}
    </div>
  );
}

/** Narrator for the next montage: voice, tempo and how loud the game sound stays under it. */
function VoiceCard({ voice, connected, dutchScripts, onSave }: { voice: VoiceSettings; connected: boolean | undefined; dutchScripts: boolean; onSave: (v: VoiceSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(voice);
  const changed = JSON.stringify(draft) !== JSON.stringify(voice);
  // Scripts are written in English for now; a Dutch voice would read English text aloud.
  const voices = dutchScripts ? VOICES : VOICES.filter((v) => !v.name.startsWith("nl-"));
  const known = voices.some((v) => v.name === draft.voice_name);
  return (
    <Section title="Stem en geluid" intro="Voor de volgende montage. De stem komt van Google (Chirp 3 HD), alleen binnen het gratis deel: de werker stopt zelf bij 900.000 tekens per maand.">
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          Stemdienst:{" "}
          {connected ? <span className="text-emerald-700">verbonden op de pc</span> : connected === false ? <StatusBadge status="connect" /> : <span>werker niet bereikbaar</span>}
          {connected === false && <span>Zet GOOGLE_TTS_API_KEY in worker\.env.local; tot dan worden montages gemaakt zonder stem.</span>}
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">Stem</span>
          <select value={draft.voice_name} onChange={(e) => setDraft({ ...draft, voice_name: e.target.value })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1">
            {!known && <option value={draft.voice_name}>{draft.voice_name}</option>}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>
          {!dutchScripts && <span className="text-xs text-slate-500">De scripts zijn Engels; Nederlandse stemmen verschijnen zodra er Nederlandse scripts zijn.</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">Tempo van de verteller: {draft.speaking_rate.toLocaleString("nl-NL", { minimumFractionDigits: 2 })}×</span>
          <input type="range" min={0.75} max={1.5} step={0.05} value={draft.speaking_rate} onChange={(e) => setDraft({ ...draft, speaking_rate: Number(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">Gamegeluid onder de verteller: {Math.round(draft.game_volume * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={draft.game_volume} onChange={(e) => setDraft({ ...draft, game_volume: Number(e.target.value) })} />
        </label>
        <div className="flex gap-2">
          <Button disabled={!changed} onClick={() => void onSave({ ...draft, speaking_rate: Math.round(draft.speaking_rate * 100) / 100, game_volume: Math.round(draft.game_volume * 100) / 100 })}>
            Opslaan
          </Button>
          {changed && (
            <Button variant="ghost" onClick={() => setDraft(voice)}>
              Terugzetten
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

const pct = (v: number) => Math.round(v * 100);
const CORNER_NAMES = ["Linksboven: chat van Minecraft", "Rechtsboven: meldingen van de PS5"];
const FIELDS = [
  ["x", "Vanaf links %"],
  ["y", "Vanaf boven %"],
  ["w", "Breedte %"],
  ["h", "Hoogte %"],
] as const;

/** Fixed corners that are blurred in every montage, in percent of the picture, and muting when a voice is heard. */
function PrivacyCard({ privacy, onSave }: { privacy: PrivacySettings; onSave: (p: PrivacySettings) => Promise<void> }) {
  const [draft, setDraft] = useState(privacy);
  const changed = JSON.stringify(draft) !== JSON.stringify(privacy);
  const setRegion = (i: number, key: keyof Region, value: string) => {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) return;
    setDraft({ ...draft, privacy_regions: draft.privacy_regions.map((r, k) => (k === i ? { ...r, [key]: Math.min(100, Math.max(0, n)) / 100 } : r)) });
  };
  const valid = draft.privacy_regions.every((r) => r.w >= 0.08 && r.h >= 0.08 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001);
  return (
    <Section title="Vervagen en dempen" intro="Vaste hoeken van het beeld worden in elke montage vervaagd, in procenten van de hele opname. Het voorstel: linksboven (chat) en rechtsboven (meldingen van de PS5). Controleer in een preview of ze goed vallen.">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.privacy_blur} onChange={(e) => setDraft({ ...draft, privacy_blur: e.target.checked })} />
          Hoeken vervagen
        </label>
        {draft.privacy_blur && (
          <ul className="space-y-2">
            {draft.privacy_regions.map((r, i) => (
              <li key={i} className="rounded-md border border-slate-200 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-600">{CORNER_NAMES[i] ?? "Vlak " + (i + 1)}</span>
                  <Button variant="ghost" onClick={() => setDraft({ ...draft, privacy_regions: draft.privacy_regions.filter((_, k) => k !== i) })}>
                    Weghalen
                  </Button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {FIELDS.map(([key, label]) => (
                    <label key={key} className="grid gap-0.5">
                      <span className="text-xs text-slate-500">{label}</span>
                      <input inputMode="numeric" value={pct(r[key])} onChange={(e) => setRegion(i, key, e.target.value)} className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1" />
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {draft.privacy_blur && (
          <div className="flex flex-wrap gap-2">
            {draft.privacy_regions.length < 6 && (
              <Button variant="secondary" onClick={() => setDraft({ ...draft, privacy_regions: [...draft.privacy_regions, { x: 0, y: 0.8, w: 0.25, h: 0.2 }] })}>
                Vlak toevoegen
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDraft({ ...draft, privacy_regions: DEFAULT_BLUR_REGIONS })}>
              Voorstel terugzetten
            </Button>
          </div>
        )}
        {!valid && <p className="text-xs text-amber-800">Elk vlak moet minstens 8% breed en hoog zijn en binnen het beeld vallen.</p>}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.mute_flagged_voice} onChange={(e) => setDraft({ ...draft, mute_flagged_voice: e.target.checked })} />
          Gamegeluid helemaal uit als de analyse een stem hoort (de verteller blijft)
        </label>
        {!draft.privacy_blur && <p className="text-xs text-amber-800">Zonder vervagen kan een video met een gamertag, chat of melding niet worden goedgekeurd.</p>}
        <div className="flex gap-2">
          <Button disabled={!changed || !valid} onClick={() => void onSave(draft)}>
            Opslaan
          </Button>
          {changed && (
            <Button variant="ghost" onClick={() => setDraft(privacy)}>
              Terugzetten
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">Geldt voor de volgende montage. Een al gemaakte montage blijft zoals hij is: maak hem opnieuw.</p>
      </div>
    </Section>
  );
}

const QC_TONE: Record<QcItem["level"], string> = { green: "bg-emerald-500", orange: "bg-amber-500", red: "bg-red-500", na: "bg-slate-300" };

/** Quality checklist of the newest montage, with the real measured values (fase C1). */
function QcList({ qc }: { qc: QcItem[] | null }) {
  const [open, setOpen] = useState(false);
  if (!qc) return <p className="text-slate-500">Kwaliteitscontrole: nog niet gemeten voor deze montage (komt met werker 54.5 en migratie 034; maak de montage opnieuw).</p>;
  const count = (l: QcItem["level"]) => qc.filter((i) => i.level === l).length;
  const shown = open ? qc : qc.filter((i) => i.level === "red" || i.level === "orange");
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => setOpen(!open)} className="font-medium text-slate-700 underline-offset-2 hover:underline">
        Kwaliteitscontrole: {count("green")} goed, {count("orange")} let op, {count("red")} rood {open ? "(alles verbergen)" : "(alles tonen)"}
      </button>
      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map((i) => (
            <li key={i.key} className="flex items-start gap-2">
              <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${QC_TONE[i.level]}`} />
              <span>
                <span className="font-medium">{i.label}</span>: {i.value} <span className="text-slate-500">({QC_LEVEL_LABEL[i.level]}; {i.note})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The three hook variants of a script; Milan picks one (fase C2). The montage uses the chosen one. */
function HookChoice({ script, act }: { script: DbScript; act: Act }) {
  const chosen = script.chosen_hook ?? null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">Kies de opening (hook-first). De montage gebruikt de gekozen hook{script.status === "approved" ? "; na een andere keuze moet de montage opnieuw" : ""}.</p>
      <ul className="space-y-1">
        {(script.hooks ?? []).map((h, i) => (
          <li key={i} className={`rounded-md border px-2 py-1.5 ${chosen === i ? "border-cyan-500 bg-cyan-50/40" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                {HOOK_TYPE_LABEL[h.type] ?? h.type}
                {h.cold_open ? " · opent met het hoogtepunt" : ""}
              </span>
              {chosen === i ? (
                <span className="text-xs font-medium text-cyan-700">Gekozen</span>
              ) : (
                <Button variant="ghost" onClick={() => void act(() => setChosenHook(script, i))}>
                  Kies deze
                </Button>
              )}
            </div>
            <p className="text-sm">{h.first_line}</p>
            <p className="text-xs font-semibold tracking-wide">{h.overlay}</p>
          </li>
        ))}
      </ul>
      {script.loop_line && <p className="text-xs text-slate-500">Slotzin (loop naar het begin): {script.loop_line}</p>}
    </div>
  );
}

/** First-frame test: the still first frame without sound, with the first sentence. Is it clear within a second? */
function FirstFrame({ file, firstLine }: { file: string; firstLine: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md bg-slate-50 p-2">
      <video src={`${WORKER_URL}/renders/${encodeURIComponent(file)}#t=0.05`} crossOrigin="anonymous" muted playsInline preload="metadata" className="h-28 w-28 shrink-0 rounded bg-black object-contain" aria-label="Eerste beeld van de montage" />
      <div className="min-w-0 text-xs">
        <p className="font-medium text-slate-700">Eerste-frametest (zonder geluid)</p>
        <p className="mt-0.5 text-slate-600">Eerste zin: {firstLine || "–"}</p>
        <p className="mt-0.5 text-slate-500">Snap je in één seconde waar het om gaat, zonder geluid? Zo niet: kies een andere hook.</p>
      </div>
    </div>
  );
}

/** "Zelf samenstellen" (fase C): pick moments yourself, for more Shorts or an extra long video from one recording. */
function ManualMaker({ moments, onMake }: { moments: DbMoment[]; onMake: (chosen: DbMoment[], long: boolean) => Promise<void> }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const picked = moments.filter((m) => chosen.includes(m.id));
  const make = (long: boolean) => {
    setBusy(true);
    void onMake(picked, long).finally(() => {
      setBusy(false);
      setChosen([]);
    });
  };
  if (!moments.length) return null;
  return (
    <details className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Zelf samenstellen</summary>
      <p className="mt-1 text-xs text-slate-500">Vink momenten aan. Een Short per moment, of één lange video met de gekozen momenten als hoofdstukken (minstens 3). De werker schrijft daarna het script; er gaat niets online.</p>
      <ul className="mt-2 space-y-1">
        {moments.map((m) => (
          <li key={m.id}>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={chosen.includes(m.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, m.id] : chosen.filter((c) => c !== m.id))} className="mt-1" />
              <span>
                <span className="font-mono text-xs">{formatTimecode(m.start_ms)}</span> {KIND_LABEL[m.kind]} · score {m.score} <span className="text-xs text-slate-500">{m.reason}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || picked.length === 0} onClick={() => make(false)}>
          {picked.length === 1 ? "Short van dit moment" : `${picked.length || ""} Shorts maken`.trim()}
        </Button>
        <Button variant="secondary" disabled={busy || picked.length < 3} onClick={() => make(true)}>
          Lange video van {picked.length} momenten
        </Button>
      </div>
    </details>
  );
}

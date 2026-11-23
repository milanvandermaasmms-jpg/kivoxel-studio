"use client";

import { Check, ChevronLeft, ChevronRight, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { formatTimecode } from "@/lib/youtube/analysis";
import type { ReviewItem } from "@/lib/youtube/board";
import { approveConcept, approveFinal, rejectConcept, rejectFinal, sendBackConcept, type BoardState } from "@/lib/youtube/boardData";
import { AudioModeSwitch, renderAudio } from "@/components/youtube/AudioModeSwitch";
import { MiniReport } from "@/components/youtube/MiniReport";
import { changedCount, scriptDiff } from "@/lib/youtube/scriptDiff";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { reviewBlockers } from "@/lib/youtube/review";
import { FeedbackPanel } from "@/components/youtube/FeedbackPanel";
import { EditorPanel } from "@/components/youtube/EditorPanel";
import { ViralScoreCard } from "@/components/youtube/ViralScoreCard";
import { applyAi, applyJudgement, type PartKey, type ViralResult } from "@/lib/kivoxel/viralScore";
import { loadJudgements, requestContentCheck, saveJudgement } from "@/lib/youtube/viralJudgement";
import { aiForViral, AI_PARTS, type ContentCheck } from "@/lib/kivoxel/contentCheck";
import { isPreviewJob, type PreviewJob } from "@/lib/youtube/audioPreviewData";
import { AudioOptions } from "@/components/youtube/AudioOptions";
import type { BriefCheck, Briefing } from "@/lib/kivoxel/briefing";
import { saveBriefing } from "@/lib/youtube/studio";
import { ProducerDossierView } from "@/components/youtube/ProducerDossier";
import { buildDossier } from "@/lib/kivoxel/producerDossier";
import type { Lesson } from "@/lib/kivoxel/lessons";
import type { EditorReport } from "@/lib/kivoxel/editorReview";
import type { GateResult } from "@/lib/kivoxel/producerGate";
import { rejectWithFeedback, remountWithFeedback } from "@/lib/youtube/remountData";
import { clock, type FeedbackItem, type RemountMode } from "@/lib/youtube/reviewFeedback";

import { FORMATS } from "@/lib/youtube/studio";
import { askIvar, usePublishPageContext } from "@/lib/ivar/pageContext";

type Ready = Extract<BoardState, { ready: true }>;

/**
 * Review mode (superprompt 7.3): full screen, one item at a time, three big buttons. Swipe or use the arrow keys for
 * the next item. "Aanpassen" sends a concept back with a comment (a new version follows); for a final version it opens
 * the Productiestudio, where the script and montage can be changed.
 */
export function ReviewMode({ studioId, board, items, workerOnline, onClose, onEdit, onChanged, startAt }: { studioId: string; board: Ready; items: ReviewItem[]; workerOnline: boolean; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void>; startAt?: string | null }) {
  // "Keuren" on a tile opens the review mode at that video; the arrows still go through all of them.
  const [index, setIndex] = useState(() => Math.max(0, startAt ? items.findIndex((i) => i.videoId === startAt) : 0));
  const [rejecting, setRejecting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);
  // 23-11-2026: feedback on moments of the final version, and the version before it next to it.
  const player = useRef<HTMLVideoElement | null>(null);
  const before = useRef<HTMLVideoElement | null>(null);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [mode, setMode] = useState<RemountMode>("gericht");
  const [done, setDone] = useState<string | null>(null);

  const item = items[Math.min(index, items.length - 1)] as ReviewItem | undefined;
  const go = (step: number) => {
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + step)));
    setRejecting(false);
    setAdjusting(false);
    setNote("");
    setError(null);
    setFeedback([]);
    setDone(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // go only uses setters and items.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, items.length]);

  const video = item ? board.input.videos.find((v) => v.id === item.videoId) : undefined;
  const channel = video ? board.channels.find((c) => c.id === video.channel_id) : undefined;
  const format = video ? FORMATS.find((f) => f.key === video.format) : undefined;
  // 23-11-2026 (superprompt V6, fase 28.1/35): Ivar knows which video is open in the review.
  usePublishPageContext(video ? { channelId: video.channel_id ?? null, channelName: channel?.name ?? null, projectKind: "video", projectId: video.id, projectLabel: video.promise ?? "Video", page: "Keuren" } : null);
  const scripts = video ? board.scripts.filter((s) => s.video_id === video.id) : [];
  const script = item?.kind === "concept" ? scripts.find((s) => s.id === item.scriptId) : scripts.find((s) => s.status === "approved");
  const renders = video ? board.renders.filter((r) => r.video_id === video.id) : [];
  const flags = video ? [...new Set((video.yt_video_moments ?? []).flatMap((m) => board.input.moments.find((x) => x.id === m.moment_id)?.privacy_flags ?? []))] : [];
  const renderBusy = video ? board.jobs.some((j) => j.step === "render" && j.video_id === video.id && (j.status === "queued" || j.status === "running") && !isPreviewJob(j)) : false;
  const blockers = item?.kind === "final" ? reviewBlockers({ approvedScriptId: script?.status === "approved" ? script.id : null, latestRender: renders[0] ?? null, renderBusy, privacyFlags: flags }) : [];
  // Milan, 16-11-2026: approving is never blocked by the Poortwachter or the quality checks, only when there is no montage.
  const canApprove = !!item && !!script && blockers.length === 0;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setRejecting(false);
      setAdjusting(false);
      setNote("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dat lukte niet.");
    } finally {
      setBusy(false);
    }
  };
  const approve = () => {
    if (!item || !script) return;
    void act(() => (item.kind === "concept" ? approveConcept(studioId, script, board.jobs) : approveFinal(item.videoId)));
  };
  const reject = () => {
    if (!item || !script) return;
    void act(() => (item.kind === "concept" ? rejectConcept(script, note) : rejectWithFeedback(item.videoId, [], script.version, note)));
  };

  const adjust = () => {
    if (!item || item.kind !== "concept" || !script) return;
    void act(() => sendBackConcept(studioId, script, scripts, note));
  };
  // The version this concept replaces, to show what Milan's comment changed.
  const previous = item?.kind === "concept" && script ? scripts.filter((s) => s.version < script.version).sort((a, b) => b.version - a.version)[0] : undefined;
  const diff = previous && script ? scriptDiff(previous, script) : null;

  const hook = script ? (script.hooks?.[script.chosen_hook ?? -1]?.first_line ?? script.hook) : "";
  const render = renders[0];
  // The version before this one (an earlier render of the same video) and what changed, from the montage step itself.
  const older = renders[1];
  const renderJob = render ? (board.jobs.find((j) => j.id === (render as { job_id?: string | null }).job_id) as { result?: { changes?: string[]; feedback?: FeedbackItem[] } | null; payload?: { mode?: string; feedback?: FeedbackItem[] } | null } | undefined) : undefined;
  const lastFeedback = renderJob?.payload?.feedback ?? renderJob?.result?.feedback ?? [];
  // 23-11-2026: eindredacteur (stored with this version), voice split and producer gate of this production.
  const editor = (render?.qc as { editor?: EditorReport } | null | undefined)?.editor ?? null;
  // 23-11-2026 (superprompt V6, fase 30): the Viral Quality Score of this version, completed with Milan's own judgement.
  const storedViral = (render?.qc as { viral?: ViralResult } | null | undefined)?.viral ?? null;
  const [judgements, setJudgements] = useState<{ videoId: string; parts: Partial<Record<PartKey, number>> } | null>(null);
  useEffect(() => {
    if (!video?.id || !storedViral) return;
    let live = true;
    void loadJudgements(studioId, video.id).then((parts) => live && setJudgements({ videoId: video.id, parts })).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [studioId, video?.id, storedViral]);
  // The AI content check (if Milan started it) fills open parts, labelled "AI"; Milan's own judgement always wins.
  const content = (render?.qc as { content?: ContentCheck } | null | undefined)?.content ?? null;
  const withAi = storedViral && content ? applyAi(storedViral, aiForViral(storedViral, content), Object.fromEntries(AI_PARTS.map((k) => [k, content.parts[k].evidence]))) : storedViral;
  const viral = withAi ? applyJudgement(withAi, judgements && judgements.videoId === video?.id ? judgements.parts : {}) : null;
  const contentBusy = video && render ? board.jobs.some((j) => j.step === "viral" && j.video_id === video.id && (j.status === "queued" || j.status === "running") && (j.payload as { content_check?: boolean } | null)?.content_check) : false;
  const judge = (part: PartKey, score: number) => {
    if (!video) return;
    setJudgements((j) => ({ videoId: video.id, parts: { ...(j?.videoId === video.id ? j.parts : {}), [part]: score } }));
    void saveJudgement(studioId, video.channel_id ?? null, video.id, render?.id ?? null, part, score).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  // 23-11-2026 (superprompt V5, fase 13): the briefing check of this version; Milan may let an instruction go on purpose.
  const briefing = (render?.qc as { briefing?: { checks: BriefCheck[]; verdict: { ok: boolean; text: string }; brief: Briefing } } | null | undefined)?.briefing ?? null;
  const waive = (key: string) => {
    if (!briefing || !video?.recording_id) return;
    void act(() => saveBriefing(studioId, video.recording_id!, { ...briefing.brief, waived: [...new Set([...(briefing.brief.waived ?? []), key])] }));
  };
  const voicePlan = (renderJob?.result as { voicePlan?: { voice: boolean; reason: string } | null } | null | undefined)?.voicePlan ?? null;
  const scriptJob = video ? (board.jobs.filter((j) => j.video_id === video.id && j.step === "script" && j.status === "done").sort((a, b) => b.created_at.localeCompare(a.created_at))[0] as { result?: { producer?: GateResult; lessons?: Lesson[]; newMoment?: { from: number; to: number | null; why: string } } | null; payload?: { feedback?: FeedbackItem[]; mode?: string } | null } | undefined) : undefined;
  const producer = scriptJob?.result?.producer ?? null;
  // A full re-montage keeps Milan's feedback on its script step; the montage itself has none (23-11-2026).
  const shownFeedback = lastFeedback.length ? lastFeedback : (scriptJob?.payload?.feedback ?? []);
  const state_title = (id: string | undefined) => (id ? (scripts.find((s) => s.status === "approved")?.titles?.[0] ?? video?.promise ?? "Video") : "Video");
  const jumpTo = (ms: number) => {
    const v = player.current;
    if (v) {
      v.currentTime = ms / 1000;
      void v.play().catch(() => undefined);
    }
  };
  const compareFrom = (ms: number) => {
    for (const v of [player.current, before.current]) if (v) {
      v.currentTime = ms / 1000;
      void v.play().catch(() => undefined);
    }
  };
  const rejectOnly = () => {
    if (!item || item.kind !== "final") return;
    void act(async () => {
      await rejectWithFeedback(item.videoId, feedback, script?.version ?? null, note);
      setDone("Afgekeurd. De versie staat onder Afgekeurd; er start geen nieuwe montage.");
    });
  };
  const rejectAndRemount = () => {
    if (!item || item.kind !== "final" || !script || !video) return;
    void act(async () => {
      const r = await remountWithFeedback({ studioId, videoId: video.id, script, scriptsOfVideo: scripts, previousRenderId: render?.id ?? null, items: feedback, mode });
      setDone(`Opnieuw monteren gestart (${r.mode === "gericht" ? "gerichte correctie" : "volledig nieuwe montage"}): ${r.changes.join(" · ")}. De nieuwe versie komt terug bij Te keuren.`);
    });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Keur-modus" className="fixed inset-0 z-50 flex flex-col bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            Keuren {items.length ? `${Math.min(index, items.length - 1) + 1} van ${items.length}` : ""}
          </p>
          {item && (
            <p className="truncate font-medium">
              {item.kind === "concept" ? "Concept (script)" : "Eindversie"} · {format ? `${format.name}, ${format.kind.toLowerCase()}` : ""}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Keur-modus sluiten" className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1);
        }}
      >
        {!item || !video ? (
          <p className="py-16 text-center text-slate-600">Niets meer te keuren. Goed bezig!</p>
        ) : (
          // 23-11-2026 (superprompt V6, fase 33): video, audio and choices on the left; quality panel (viral score, editor,
          // dossier) on the right on a wide screen; one column on a phone.
          <div className="mx-auto max-w-6xl text-sm lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span aria-hidden className="h-3 w-3 rounded-full border border-slate-300" style={{ background: channel?.brand_color ?? "transparent" }} />
              <span>{channel?.name ?? "Kanaal"}</span>
              {video.is_test && <span className="rounded bg-slate-100 px-1.5 py-0.5">test</span>}
              {video.promise && <span>· {video.promise}</span>}
            </div>

            {item.kind === "final" &&
              (render && workerOnline ? (
                <div className={older ? "grid grid-cols-2 gap-2" : ""}>
                {older && (
                  <figure className="space-y-1">
                    <video ref={before} key={older.id} src={`${WORKER_URL}/renders/${encodeURIComponent(older.file_name)}`} crossOrigin="anonymous" controls playsInline preload="metadata" muted className="mx-auto max-h-[50vh] w-auto max-w-full rounded-md bg-black" />
                    <figcaption className="text-center text-xs text-slate-500">Vorige versie</figcaption>
                  </figure>
                )}
                <figure className="space-y-1">
                <video ref={player} key={render.id} src={`${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}`} crossOrigin="anonymous" controls playsInline preload="metadata" style={{ aspectRatio: `${render.width} / ${render.height}` }} className={`mx-auto rounded-md bg-black ${older ? "max-h-[50vh] w-auto max-w-full" : render.height > render.width ? "h-[min(60vh,36rem)] w-auto max-w-full" : "w-full"}`} />
                {older && <figcaption className="text-center text-xs text-slate-500">Nieuwe versie</figcaption>}
                </figure>
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 px-3 py-2 text-slate-600">{render ? "De video staat op de pc. Start de werker om hem hier te bekijken." : "Er is nog geen montage."}</p>
              ))}
            {item.kind === "final" && older && (
              <section className="space-y-1 rounded-md border border-cyan-200 p-3 text-xs">
                <p className="font-medium">Wat is er veranderd</p>
                {(renderJob?.result?.changes ?? []).length ? <p>{renderJob!.result!.changes!.join(" · ")}</p> : <p className="text-slate-500">{scriptJob?.result?.newMoment ? (scriptJob.result.newMoment.to !== null ? `Volledig nieuwe montage: ander moment uit de opname (${clock(scriptJob.result.newMoment.from)} → ${clock(scriptJob.result.newMoment.to)}: ${scriptJob.result.newMoment.why}).` : `Volledig nieuwe montage: ${scriptJob.result.newMoment.why}`) : renderJob?.payload?.mode === "volledig" || scriptJob?.payload?.mode === "volledig" ? "Volledig nieuwe montage (nieuw script)." : "Geen wijzigingen vastgelegd bij deze versie."}</p>}
                {shownFeedback.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {shownFeedback.map((f, k) => (
                      <button key={k} type="button" onClick={() => compareFrom(f.atMs)} className="rounded border border-slate-300 px-2 py-0.5">
                        ▶ beide vanaf {clock(f.atMs)}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
            {item.kind === "final" && render && script && video && (
              <AudioOptions
                studioId={studioId}
                channelId={video.channel_id ?? null}
                script={script}
                previews={board.jobs.filter((j) => j.video_id === video.id && isPreviewJob(j) && j.created_at > render.created_at).sort((a, b) => b.created_at.localeCompare(a.created_at)) as unknown as PreviewJob[]}
                attempt={board.jobs.filter((j) => j.step === "render" && j.video_id === video.id).length + 1}
                current={renderJob?.result ? { voice: (renderJob.result as { voice?: string | null }).voice ?? null, music: (renderJob.result as { music?: string | null }).music ?? null, sfx: (renderJob.result as { sfx?: number | null }).sfx ?? null } : null}
                game={board.input.recordings.find((r) => r.id === video.recording_id)?.label ?? null}
                act={act}
              />
            )}
            {item.kind === "final" && render && workerOnline && <FeedbackPanel player={() => player.current} items={feedback} onChange={setFeedback} mode={mode} onMode={setMode} />}
            {done && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">{done}</p>}
            {item.kind === "final" && render && script?.status === "approved" && !renderBusy && (
              <AudioModeSwitch
                studioId={studioId}
                script={script}
                attempt={board.jobs.filter((j) => j.step === "render" && (j as { payload?: { script_id?: string } | null }).payload?.script_id === script.id).length + 1}
                current={renderAudio(render)}
                channel={channel}
                nextVersion={Math.max(0, ...scripts.map((x) => x.version)) + 1}
                act={act}
              />
            )}

            {script && (
              <section className="space-y-2 rounded-md border border-slate-200 p-3">
                {script.top_line && <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{script.top_line}</p>}
                <p className="font-medium">Hook: {hook}</p>
                <ol className="space-y-1">
                  {script.lines.map((l, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-12 shrink-0 tabular-nums text-slate-500">{formatTimecode(l.at_ms)}</span>
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ol>
                {script.loop_line && <p className="text-xs text-slate-500">Loop naar het begin: {script.loop_line}</p>}
                <p className="text-xs text-slate-500">Versie {script.version}</p>
              </section>
            )}

            {diff && previous && (
              <section className="space-y-1 rounded-md border border-cyan-200 p-3">
                <p className="text-xs font-medium">
                  Versie {script!.version} t.o.v. versie {previous.version}: {changedCount(diff)} {changedCount(diff) === 1 ? "wijziging" : "wijzigingen"}
                  {script!.feedback ? <span className="font-normal text-slate-600"> · jouw opmerking: &ldquo;{script!.feedback}&rdquo;</span> : null}
                </p>
                <ul className="space-y-0.5 text-xs">
                  {diff.filter((r) => r.kind !== "same").map((r, i) => (
                    <li key={i} className={r.kind === "new" ? "text-emerald-700" : "text-red-700 line-through"}>
                      {r.kind === "new" ? "+ " : "− "}
                      {r.label}: {r.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* Milan, 16-11-2026: no Poortwachter, safety warnings or red/orange check lists in the review; only what blocks the montage itself. */}
            {blockers.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-red-200 bg-red-50 py-2 pl-7 pr-3 text-red-800">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {item.kind === "final" && render && <MiniReport qc={render.qc as Parameters<typeof MiniReport>[0]["qc"]} topLine={script?.top_line ?? null} model={(script as { model?: string | null } | undefined)?.model} short={render.height > render.width} />}
            {item.kind === "concept" && <p className="text-xs text-slate-500">Goedkeuren start meteen de montage op de pc. Publiceren blijft altijd een aparte klik.</p>}
            {item.kind === "final" && <p className="text-xs text-slate-500">Goedkeuren zet de video klaar om te publiceren. Publiceren of inplannen doe je daarna zelf.</p>}

            {(rejecting || adjusting) && (
              <label className="grid gap-1">
                <span className="text-slate-500">{adjusting ? "Wat moet er anders? (bijv. hook sneller, minder uitleg)" : "Waarom afkeuren? De video gaat daarna naar het archief."}</span>
                <textarea autoFocus value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="bijv. hook sneller, gamertag nog zichtbaar" className="rounded-md border border-slate-300 bg-transparent px-2 py-1" />
              </label>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                {error}
              </p>
            )}
          </div>
          <aside aria-label="Kwaliteit" className="mt-4 space-y-4 lg:sticky lg:top-0 lg:mt-0">
              {item.kind === "final" && render && viral && <ViralScoreCard result={viral} onJudge={judge} />}
            {item.kind === "final" && render && (
              <section aria-label="AI-inhoudscheck" className="space-y-1 rounded-md border border-slate-200 p-3 text-xs">
                <p className="text-sm font-semibold">AI-inhoudscheck</p>
                {content ? (
                  <>
                    <p className="text-slate-700">{content.summary}</p>
                    <ul className="space-y-0.5">
                      {AI_PARTS.map((k) => (
                        <li key={k}>
                          <span className="font-medium">{k}: {content.parts[k].score ?? "?"}</span> — {content.parts[k].evidence}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-slate-500">Oordeel van Gemini ({content.model}) op {new Date(content.checkedAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}. Een buitenstaander-oordeel, geen garantie; jouw oordeel gaat altijd voor.</p>
                  </>
                ) : contentBusy ? (
                  <p className="text-slate-600">Gemini bekijkt de video…</p>
                ) : (
                  <button type="button" onClick={() => void act(() => requestContentCheck(studioId, video!.id, render.id))} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    Laat Gemini de inhoud beoordelen (± {render.height > render.width ? "2" : "5"} cent)
                  </button>
                )}
              </section>
            )}
            {item.kind === "final" && render && (
              <button type="button" onClick={() => askIvar(viral && viral.status !== "publicatiegereed" ? `Waarom haalt deze video ${viral.total !== null ? viral.total.toFixed(1).replace(".", ",") : "geen score"} en wat is de beste verbetering?` : "Wat vind je van deze video, en welke van de drie audio-opties past het best?")} className="w-full rounded-md border border-violet-300 px-3 py-2 text-left text-sm text-violet-800 hover:bg-violet-50">
                Vraag Ivar om advies over deze video
              </button>
            )}
              {item.kind === "final" && render && <EditorPanel editor={editor} voicePlan={voicePlan} producer={producer} onJump={jumpTo} briefing={briefing} onWaive={waive} />}
              {item.kind === "final" && render && script && (
                <ProducerDossierView
                  title={state_title(video?.id)}
                  onJump={jumpTo}
                  dossier={buildDossier({
                    format: render.height > render.width ? "short" : "long",
                    title: state_title(video?.id),
                    titles: script.titles,
                    topLine: script.top_line,
                    hook: script.hook,
                    hooks: script.hooks,
                    chosenHook: script.chosen_hook,
                    lines: script.lines,
                    plan: script.edit_plan,
                    targetMs: script.target_ms,
                    loopLine: script.loop_line,
                    gate: producer,
                    editor,
                    voice: !!voicePlan?.voice || /stem/i.test(renderAudio(render)?.label ?? ""),
                    audioLabel: renderAudio(render)?.label ?? null,
                    music: renderAudio(render)?.music ?? null,
                    thumbnails: ((render as { thumbnails?: { label?: string; text?: string }[] }).thumbnails ?? []),
                    lessons: scriptJob?.result?.lessons ?? [],
                  })}
                />
              )}
          </aside>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 px-4 py-3">
        <div className="mx-auto grid max-w-2xl grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-2">
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Vorige" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          {rejecting || adjusting ? (
            <>
              <Button disabled={busy || !note.trim()} onClick={adjusting ? adjust : reject} className="col-span-2 justify-center py-3">
                {adjusting ? "Nieuwe versie maken" : "Afkeuren met reden"}
              </Button>
              <Button variant="secondary" onClick={() => { setRejecting(false); setAdjusting(false); }} className="justify-center py-3">
                Annuleren
              </Button>
            </>
          ) : item?.kind === "final" ? (
            <>
              <Button disabled={busy || !canApprove} onClick={approve} className="justify-center py-3">
                <Check className="h-4 w-4" aria-hidden /> Goedkeuren
              </Button>
              <Button variant="secondary" disabled={busy || !script} onClick={() => (feedback.length ? rejectOnly() : setRejecting(true))} className="justify-center py-3 text-red-700" title="Bewaren onder Afgekeurd, geen nieuwe montage">
                <X className="h-4 w-4" aria-hidden /> Afkeuren
              </Button>
              <Button variant="secondary" disabled={busy || !script || feedback.length === 0} onClick={rejectAndRemount} className="justify-center py-3" title={feedback.length ? "Bewaren en één nieuwe montage maken met jouw feedback" : "Geef eerst feedback op een moment"}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Afkeuren en opnieuw monteren
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy || !canApprove} onClick={approve} className="justify-center py-3">
                <Check className="h-4 w-4" aria-hidden /> Goedkeuren
              </Button>
              <Button variant="secondary" disabled={!item || busy} onClick={() => (item?.kind === "concept" && script ? setAdjusting(true) : onEdit())} className="justify-center py-3">
                <Pencil className="h-4 w-4" aria-hidden /> Aanpassen
              </Button>
              <Button variant="secondary" disabled={busy || !item || !script} onClick={() => setRejecting(true)} className="justify-center py-3 text-red-700">
                <X className="h-4 w-4" aria-hidden /> Afkeuren
              </Button>
            </>
          )}
          <button type="button" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Volgende" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </footer>
    </div>
  );
}

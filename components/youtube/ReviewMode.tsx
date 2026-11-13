"use client";

import { Check, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { formatTimecode } from "@/lib/youtube/analysis";
import type { ReviewItem } from "@/lib/youtube/board";
import { approveConcept, approveFinal, rejectConcept, rejectFinal, sendBackConcept, type BoardState } from "@/lib/youtube/boardData";
import { changedCount, scriptDiff } from "@/lib/youtube/scriptDiff";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { reviewBlockers, reviewChecks } from "@/lib/youtube/review";
import { hasRed, videoGate } from "@/lib/youtube/gatekeeper";
import { GateList } from "@/components/youtube/GateList";
import { FORMATS } from "@/lib/youtube/studio";

type Ready = Extract<BoardState, { ready: true }>;

/**
 * Review mode (superprompt 7.3): full screen, one item at a time, three big buttons. Swipe or use the arrow keys for
 * the next item. "Aanpassen" sends a concept back with a comment (a new version follows); for a final version it opens
 * the Productiestudio, where the script and montage can be changed.
 */
export function ReviewMode({ studioId, board, items, workerOnline, onClose, onEdit, onChanged }: { studioId: string; board: Ready; items: ReviewItem[]; workerOnline: boolean; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [index, setIndex] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const [redSeen, setRedSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touchX = useRef<number | null>(null);

  const item = items[Math.min(index, items.length - 1)] as ReviewItem | undefined;
  const go = (step: number) => {
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + step)));
    setRejecting(false);
    setAdjusting(false);
    setNote("");
    setRedSeen(false);
    setError(null);
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
  const scripts = video ? board.scripts.filter((s) => s.video_id === video.id) : [];
  const script = item?.kind === "concept" ? scripts.find((s) => s.id === item.scriptId) : scripts.find((s) => s.status === "approved");
  const renders = video ? board.renders.filter((r) => r.video_id === video.id) : [];
  const flags = video ? [...new Set((video.yt_video_moments ?? []).flatMap((m) => board.input.moments.find((x) => x.id === m.moment_id)?.privacy_flags ?? []))] : [];
  const renderBusy = video ? board.jobs.some((j) => j.step === "render" && j.video_id === video.id && (j.status === "queued" || j.status === "running")) : false;
  const blockers = item?.kind === "final" ? reviewBlockers({ approvedScriptId: script?.status === "approved" ? script.id : null, latestRender: renders[0] ?? null, renderBusy, privacyFlags: flags }) : [];
  const checks = item?.kind === "final" ? reviewChecks(flags) : [];
  const qc = item?.kind === "final" ? (renders[0]?.qc?.items ?? []) : [];
  const reds = qc.filter((q) => q.level === "red");
  const oranges = qc.filter((q) => q.level === "orange");
  const gate = item ? videoGate({ script, channel: channel ?? null, privateTerms: board.privateTerms, flags }) : [];
  const canApprove = !!item && !!script && blockers.length === 0 && !hasRed(gate) && (reds.length === 0 || redSeen);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setRejecting(false);
      setAdjusting(false);
      setNote("");
      setRedSeen(false);
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
    void act(() => (item.kind === "concept" ? rejectConcept(script, note) : rejectFinal(item.videoId, note)));
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
          <div className="mx-auto max-w-2xl space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span aria-hidden className="h-3 w-3 rounded-full border border-slate-300" style={{ background: channel?.brand_color ?? "transparent" }} />
              <span>{channel?.name ?? "Kanaal"}</span>
              {video.is_test && <span className="rounded bg-slate-100 px-1.5 py-0.5">test</span>}
              {video.promise && <span>· {video.promise}</span>}
            </div>

            {item.kind === "final" &&
              (render && workerOnline ? (
                <video key={render.id} src={`${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}`} crossOrigin="anonymous" controls playsInline preload="metadata" style={{ aspectRatio: `${render.width} / ${render.height}` }} className={`mx-auto rounded-md bg-black ${render.height > render.width ? "h-[min(60vh,36rem)] w-auto max-w-full" : "w-full"}`} />
              ) : (
                <p className="rounded-md border border-slate-200 px-3 py-2 text-slate-600">{render ? "De video staat op de pc. Start de werker om hem hier te bekijken." : "Er is nog geen montage."}</p>
              ))}

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
            {script && <GateList items={gate} />}
            {blockers.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-red-200 bg-red-50 py-2 pl-7 pr-3 text-red-800">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {(reds.length > 0 || oranges.length > 0) && (
              <ul className="space-y-1">
                {[...reds, ...oranges].map((q) => (
                  <li key={q.key} className={q.level === "red" ? "text-red-800" : "text-amber-800"}>
                    {q.level === "red" ? "●" : "○"} {q.label}: {q.value}
                    {q.note ? ` (${q.note})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {checks.length > 0 && blockers.length === 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                {checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {reds.length > 0 && blockers.length === 0 && (
              <label className="flex items-start gap-2 text-red-800">
                <input type="checkbox" checked={redSeen} onChange={(e) => setRedSeen(e.target.checked)} className="mt-0.5" />
                Ik heb de rode {reds.length === 1 ? "controle" : "controles"} bekeken en keur bewust toch goed.
              </label>
            )}
            {item.kind === "concept" && <p className="text-xs text-slate-500">Goedkeuren start meteen de montage op de pc. Publiceren blijft altijd een aparte klik.</p>}
            {item.kind === "final" && <p className="text-xs text-slate-500">Goedkeuren zet de video klaar om te publiceren. Publiceren of inplannen doe je daarna zelf.</p>}

            {(rejecting || adjusting) && (
              <label className="grid gap-1">
                <span className="text-slate-500">{adjusting ? "Wat moet er anders? (bijv. hook sneller, minder uitleg)" : "Waarom afkeuren?"}</span>
                <textarea autoFocus value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="bijv. hook sneller, gamertag nog zichtbaar" className="rounded-md border border-slate-300 bg-transparent px-2 py-1" />
              </label>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                {error}
              </p>
            )}
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

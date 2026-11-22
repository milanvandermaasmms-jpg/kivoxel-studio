"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui/Dialog";
import { FeedbackPanel } from "@/components/youtube/FeedbackPanel";
import type { FlowState } from "@/lib/youtube/flowData";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { remountWithFeedback } from "@/lib/youtube/remountData";
import type { FeedbackItem, RemountMode } from "@/lib/youtube/reviewFeedback";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
type Act = (a: () => Promise<unknown>) => Promise<void>;

/** Notes the studio wrote itself when it archived a video (not Milan's rejections). */
const SYSTEM_NOTE = /^(Niet gebruikt|Vervangen|test$)/i;

/**
 * Afgekeurd (23-11-2026): every video Milan rejected, with his reason, the last version and "Opnieuw monteren". For each
 * one the studio checks what is still on the pc: the export and the source recording. What is missing is said exactly.
 */
export function RejectedList({ state, channel, studioId, workerOnline, act }: { state: Ready; channel: string | null; studioId: string; workerOnline: boolean; act: Act }) {
  const b = state.board;
  const rejected = b.input.videos
    .filter((v) => v.status === "archived" && v.review_note && !SYSTEM_NOTE.test(v.review_note) && !v.is_test && (!channel || v.channel_id === channel))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const [sources, setSources] = useState<Set<string> | null>(null);
  const [files, setFiles] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!workerOnline) return;
    void fetch(`${WORKER_URL}/recordings`)
      .then((r) => r.json() as Promise<{ fingerprint: string }[]>)
      .then((list) => setSources(new Set(list.map((x) => x.fingerprint))))
      .catch(() => setSources(null));
  }, [workerOnline]);
  const ids = rejected.map((v) => v.id).join(",");
  useEffect(() => {
    if (!workerOnline) return;
    for (const v of rejected) {
      const r = b.renders.find((x) => x.video_id === v.id);
      if (!r || r.file_name in files) continue;
      void fetch(`${WORKER_URL}/renders/${encodeURIComponent(r.file_name)}`, { method: "HEAD" })
        .then((res) => setFiles((f) => ({ ...f, [r.file_name]: res.ok })))
        .catch(() => setFiles((f) => ({ ...f, [r.file_name]: false })));
    }
    // ids covers the list; files only grows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, workerOnline]);

  const titleOf = (id: string) => state.items.find((i) => i.videoId === id)?.title ?? "Video";
  const current = open ? rejected.find((v) => v.id === open) : undefined;

  return (
    <details className="rounded-xl border border-slate-200 bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold">🚫 Afgekeurd ({rejected.length})</summary>
      <p className="mt-1 text-xs text-slate-500">Wat je afkeurde, met je reden en de laatste versie. Met Opnieuw monteren maak je één nieuwe versie met je feedback; die komt terug bij Te keuren.</p>
      <ul className="mt-2 divide-y divide-slate-200 text-sm">
        {rejected.map((v) => {
          const renders = b.renders.filter((r) => r.video_id === v.id);
          const last = renders[0];
          const rec = b.input.recordings.find((r) => r.id === v.recording_id);
          const sourceThere = !rec?.fingerprint || !sources ? null : sources.has(rec.fingerprint);
          const fileThere = last ? files[last.file_name] : undefined;
          const script = b.scripts.filter((s) => s.video_id === v.id && s.status === "approved").sort((x, y) => y.version - x.version)[0];
          const missing = [!last ? "geen montage" : fileThere === false ? "exportbestand niet meer op de pc" : null, sourceThere === false ? "bronopname niet meer op de pc" : !v.recording_id ? "geen bronopname gekoppeld" : null, !script ? "geen goedgekeurd script" : null].filter(Boolean) as string[];
          return (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{titleOf(v.id)}</span>
                <span className="block text-xs text-slate-600">
                  {v.format === "C" ? "Lange video" : "Short"} · {renders.length} {renders.length === 1 ? "versie" : "versies"} · jouw reden: {v.review_note}
                </span>
                {missing.length > 0 && <span className="block text-xs text-amber-800">Ontbreekt: {missing.join(", ")}</span>}
              </span>
              <Button variant="secondary" disabled={!script || sourceThere === false || !workerOnline} onClick={() => setOpen(v.id)} title={!workerOnline ? "Start de werker op de pc" : undefined}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Opnieuw monteren
              </Button>
            </li>
          );
        })}
        {rejected.length === 0 && <li className="py-2 text-slate-500">Niets afgekeurd.</li>}
      </ul>
      <Dialog open={!!current} onClose={() => setOpen(null)} title={current ? `Opnieuw monteren: ${titleOf(current.id)}` : ""} width="max-w-3xl">
        {current && <RemountForm key={current.id} state={state} videoId={current.id} studioId={studioId} act={act} onDone={() => setOpen(null)} fileThere={files[b.renders.find((r) => r.video_id === current.id)?.file_name ?? ""] !== false} />}
      </Dialog>
    </details>
  );
}

function RemountForm({ state, videoId, studioId, act, onDone, fileThere }: { state: Ready; videoId: string; studioId: string; act: Act; onDone: () => void; fileThere: boolean }) {
  const b = state.board;
  const player = useRef<HTMLVideoElement | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [mode, setMode] = useState<RemountMode>("gericht");
  const scripts = b.scripts.filter((s) => s.video_id === videoId);
  const script = scripts.filter((s) => s.status === "approved").sort((x, y) => y.version - x.version)[0];
  const last = b.renders.find((r) => r.video_id === videoId);
  return (
    <div className="max-h-[80vh] space-y-3 overflow-y-auto p-3 text-sm">
      {last && fileThere ? (
        <video ref={player} src={`${WORKER_URL}/renders/${encodeURIComponent(last.file_name)}`} crossOrigin="anonymous" controls playsInline preload="metadata" className="mx-auto max-h-[50vh] w-auto max-w-full rounded-md bg-black" />
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">De vorige export staat niet meer op de pc. Je kunt toch feedback geven met een tijdcode (bijv. 0:08) en een volledig nieuwe montage maken.</p>
      )}
      <FeedbackPanel player={() => player.current} items={items} onChange={setItems} mode={mode} onMode={setMode} />
      <div className="flex gap-2">
        <Button
          disabled={!script || items.length === 0}
          onClick={() => void act(async () => {
            await remountWithFeedback({ studioId, videoId, script: script!, scriptsOfVideo: scripts, previousRenderId: last?.id ?? null, items, mode });
            onDone();
          })}
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Opnieuw monteren
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Annuleren
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { requestExtras, type DbPublication, type Extras } from "@/lib/youtube/publicationData";
import { loadSlotInput, suggestSlot, type Slot } from "@/lib/youtube/slot";

const seconds = (ms: number) => (ms / 1000).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Choose the thumbnail as a moment of the montage (fase D4b). The picture comes straight from the worker on the pc;
 * the worker cuts exactly this frame when it sends the thumbnail to YouTube.
 */
export function ThumbnailPicker({ file, durationMs, valueMs, onChange, workerOnline, disabled }: { file: string | null; durationMs: number | null; valueMs: number | null; onChange: (ms: number | null) => void; workerOnline: boolean; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [broken, setBroken] = useState(false);
  const at = valueMs ?? 0;
  useEffect(() => {
    if (video.current && valueMs !== null) video.current.currentTime = valueMs / 1000;
  }, [valueMs]);
  if (!file || !durationMs) return <p className="text-slate-500">Thumbnail: maak eerst een montage.</p>;
  return (
    <div className="space-y-1">
      <p className="font-medium">Thumbnail</p>
      {valueMs === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">YouTube kiest zelf een beeld.</span>
          <Button variant="secondary" disabled={disabled} onClick={() => onChange(Math.min(durationMs - 100, 1000))}>
            Zelf een beeld kiezen
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          {workerOnline && !broken ? (
            <video ref={video} src={`${WORKER_URL}/renders/${encodeURIComponent(file)}#t=${at / 1000}`} crossOrigin="anonymous" muted playsInline preload="auto" onError={() => setBroken(true)} className="h-36 w-auto rounded bg-black" aria-label="Gekozen beeld voor de thumbnail" />
          ) : (
            <span className="text-slate-500">{broken ? "Deze montage staat niet (meer) op de pc." : "Start de werker om het beeld te zien."}</span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <input type="range" min={0} max={Math.max(0, durationMs - 100)} step={100} value={at} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-full" aria-label="Moment van de thumbnail" />
            <p className="text-slate-600">
              Beeld op {seconds(at)} s van {seconds(durationMs)} s.{" "}
              <button type="button" disabled={disabled} onClick={() => onChange(null)} className="underline underline-offset-2">
                Toch YouTube laten kiezen
              </button>
            </p>
            <p className="text-slate-500">Lukt het niet, dan moet het kanaal eenmalig geverifieerd worden (youtube.com/verify); de werker meldt dat dan.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function CaptionsChoice({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        Ondertitels ook als apart spoor naar YouTube <span className="text-slate-500">(dezelfde tekst als in beeld; helpt bij zoeken en voor doven en slechthorenden; 400 van de 10.000 eenheden per dag)</span>
      </span>
    </label>
  );
}

/** After the upload: what happened with captions and thumbnail, and send them (again). The visibility stays as it is. */
export function ExtrasAfterUpload({ current, file, durationMs, workerOnline, busy, onSent }: { current: DbPublication; file: string | null; durationMs: number | null; workerOnline: boolean; busy: boolean; onSent: (message: string, ok: boolean) => void }) {
  const [choice, setChoice] = useState<Extras>({ captions_enabled: current.captions_enabled ?? true, thumbnail_ms: current.thumbnail_ms ?? null });
  const [sending, setSending] = useState(false);
  if (current.captions_enabled === undefined) return null; // migration 040 not run yet
  const captionsDone = (current.captions_status ?? "").startsWith("Klaar");
  async function send() {
    setSending(true);
    try {
      await requestExtras(current.id, choice);
      onSent("De werker stuurt de ondertitels en de thumbnail naar YouTube. Volg het in Live.", true);
    } catch (e) {
      onSent(e instanceof Error ? e.message : "Versturen lukte niet.", false);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <p className="font-medium">Ondertitels en thumbnail</p>
      <ul className="space-y-0.5 text-slate-600">
        <li>Ondertitels: {current.captions_status ?? (current.captions_enabled ? "nog niet verstuurd" : "uit")}</li>
        <li>Thumbnail: {current.thumbnail_status ?? (current.thumbnail_ms === null ? "YouTube kiest zelf" : "nog niet verstuurd")}</li>
      </ul>
      {!captionsDone && <CaptionsChoice value={choice.captions_enabled} onChange={(v) => setChoice({ ...choice, captions_enabled: v })} disabled={busy || sending} />}
      <ThumbnailPicker file={file} durationMs={durationMs} valueMs={choice.thumbnail_ms} onChange={(ms) => setChoice({ ...choice, thumbnail_ms: ms })} workerOnline={workerOnline} disabled={busy || sending} />
      <Button variant="secondary" disabled={busy || sending || ((captionsDone || !choice.captions_enabled) && choice.thumbnail_ms === null)} onClick={() => void send()}>
        Naar YouTube sturen
      </Button>
    </div>
  );
}

/**
 * Suggested moment (fase F): only fills in the field; scheduling stays Milan's own click.
 * Learns the hour from our own videos when there are at least three, and keeps 24 hours between videos.
 */
export function SlotSuggestion({ studioId, onUse, disabled }: { studioId: string; onUse: (iso: string) => void; disabled?: boolean }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  useEffect(() => {
    let live = true;
    loadSlotInput(studioId)
      .then((input) => live && setSlot(suggestSlot(input)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [studioId]);
  if (!slot) return null;
  const when = new Date(slot.iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return (
    <p className="flex flex-wrap items-center gap-2 text-slate-600">
      <span>
        Voorstel: <strong>{when}</strong> <span className="text-slate-500">({slot.reason})</span>
      </span>
      <button type="button" disabled={disabled} onClick={() => onUse(slot.iso)} className="underline underline-offset-2">
        Gebruik dit moment
      </button>
    </p>
  );
}

"use client";

import { Pause, Play, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Notice, Section } from "@/components/settings/Section";
import { Button, Field, inputClass } from "@/components/ui/Dialog";
import { formatBytes } from "@/lib/youtube/studio";
import { uploadRecording, type UploadOutcome, type UploadPhase } from "@/lib/youtube/workerClient";

const PHASE_TEXT: Record<UploadPhase, string> = {
  fingerprint: "Vingerafdruk berekenen…",
  checking: "Controleren of deze opname er al is…",
  uploading: "Uploaden naar de pc…",
  verifying: "Controleren of alles goed is aangekomen…",
};

type Progress = { phase: UploadPhase; received: number; total: number };
type Message = { tone: "ok" | "error"; text: string };

export function UploadCard({
  workerOnline,
  isKnown,
  onReceived,
}: {
  workerOnline: boolean;
  isKnown: (fingerprint: string) => Promise<boolean>;
  onReceived: (outcome: UploadOutcome) => Promise<string | null>;
}) {
  const [file, setFile] = useState<File | null>(null);
  // Real gameplay is the normal case now (pakket 52): test data must be chosen on purpose.
  const [label, setLabel] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busy = progress !== null && !paused;

  const run = async () => {
    if (!file) return;
    const abort = new AbortController();
    controller.current = abort;
    setPaused(false);
    setMessage(null);
    try {
      const outcome = await uploadRecording(file, {
        label: label.trim(),
        isTest,
        signal: abort.signal,
        isKnown,
        onProgress: (phase, received, total) => setProgress({ phase, received, total }),
      });
      setProgress(null);
      const note = await onReceived(outcome);
      setMessage(
        outcome.kind === "duplicate"
          ? { tone: "error", text: `Deze opname staat al op de pc als “${outcome.recording.label}”. Er is niets dubbel opgeslagen.` }
          : { tone: "ok", text: `Ontvangen op de pc: “${outcome.recording.label}” (${formatBytes(outcome.recording.size)}).${note ? ` ${note}` : ""}` },
      );
      if (outcome.kind === "done") setFile(null);
    } catch (e) {
      if (abort.signal.aborted) {
        setPaused(true);
        return;
      }
      setProgress(null);
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Uploaden is mislukt." });
    }
  };

  const pause = () => controller.current?.abort();
  const percent = progress && progress.total ? Math.floor((progress.received / progress.total) * 100) : 0;

  return (
    <Section title="Opname toevoegen" intro="De opname gaat rechtstreeks naar de werker op de pc en blijft daar. Een afgebroken upload gaat verder waar hij stopte, ook als je later hetzelfde bestand opnieuw kiest.">
      {!workerOnline && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Uploaden kan alleen op de pc waarop de werker draait. Start eerst de werker.</p>}
      <div className="space-y-3">
        <Field label="Naam van de opname" hint="Bijvoorbeeld de datum en wat er gebeurt. Gebruik geen echte naam of gamertag.">
          <input className={inputClass} value={label} maxLength={200} placeholder="bijv. 11-11 grot met creepers" onChange={(e) => setLabel(e.target.value)} disabled={busy || paused} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} disabled={busy || paused} className="h-4 w-4 accent-emerald-600" />
          Testdata (geen echte gameplay van Maes; wordt gratis en zonder AI verwerkt)
        </label>
        <Field label="Videobestand" hint="mp4, webm, mkv of mov. Grote bestanden (meerdere GB) mogen.">
          <input
            type="file"
            accept="video/mp4,video/webm,video/x-matroska,video/quicktime,.mp4,.webm,.mkv,.mov"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setProgress(null);
              setPaused(false);
              setMessage(null);
            }}
            disabled={busy}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
          />
        </Field>

        {progress && (
          <div className="space-y-1" aria-live="polite">
            <div className="flex justify-between text-xs text-slate-600">
              <span>{paused ? "Gepauzeerd" : PHASE_TEXT[progress.phase]}</span>
              <span>
                {formatBytes(progress.received)} van {formatBytes(progress.total)} ({percent}%)
              </span>
            </div>
            <div role="progressbar" aria-label="Uploadvoortgang" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-[width] ${paused ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {busy ? (
            <Button variant="secondary" onClick={pause}>
              <Pause className="h-4 w-4" aria-hidden /> Pauzeren
            </Button>
          ) : (
            <Button onClick={() => void run()} disabled={!file || !workerOnline || label.trim().length === 0}>
              {paused ? <Play className="h-4 w-4" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
              {paused ? "Hervatten" : "Uploaden"}
            </Button>
          )}
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </Section>
  );
}

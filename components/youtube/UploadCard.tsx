"use client";

import { Pause, Play, Upload } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Notice, Section } from "@/components/settings/Section";
import { Button, Field, inputClass } from "@/components/ui/Dialog";
import { formatBytes } from "@/lib/youtube/studio";
import { uploadRecording, type UploadOutcome, type UploadPhase } from "@/lib/youtube/workerClient";
import { GAMES, labelWithGame, PROFILES, type ChannelProfile, type GameId } from "@/lib/youtube/gameProfile";

const PHASE_TEXT: Record<UploadPhase, string> = {
  fingerprint: "Vingerafdruk berekenen…",
  checking: "Controleren of deze opname er al is…",
  uploading: "Uploaden naar de pc…",
  verifying: "Controleren of alles goed is aangekomen…",
};

type Progress = { phase: UploadPhase; received: number; total: number };
type Message = { tone: "ok" | "error"; text: string };

/**
 * 19-11-2026 (Milan): the upload lives outside the card, so it keeps running AND stays visible when he clicks to
 * another tab or another channel in the Studio. Only closing or reloading the page stops it (the browser warns first).
 */
type UploadState = { file: File | null; label: string; isTest: boolean; game: GameId | ""; progress: Progress | null; paused: boolean; message: Message | null; controller: AbortController | null; channel: string | null };
let state: UploadState = { file: null, label: "", isTest: false, game: "", progress: null, paused: false, message: null, controller: null, channel: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<UploadState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const snapshot = () => state;

export function UploadCard({
  workerOnline,
  isKnown,
  onReceived,
  profile = PROFILES.kivoxel,
}: {
  /** The channel the recording is for: on SpawnNado Milan picks the game (KIVOXEL is always Minecraft). */
  profile?: ChannelProfile;
  workerOnline: boolean;
  isKnown: (fingerprint: string) => Promise<boolean>;
  onReceived: (outcome: UploadOutcome) => Promise<string | null>;
}) {
  const { file, label, isTest, game, progress, paused, message } = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setFile = (file: File | null) => set({ file });
  const setLabel = (label: string) => set({ label });
  const setIsTest = (isTest: boolean) => set({ isTest });
  const setGame = (game: GameId | "") => set({ game });
  const setProgress = (progress: Progress | null) => set({ progress });
  const setPaused = (paused: boolean) => set({ paused });
  const setMessage = (message: Message | null) => set({ message });
  const busy = progress !== null && !paused;
  // Closing or reloading the page would stop the upload: the browser asks first while one is running.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const run = async () => {
    if (!file) return;
    const abort = new AbortController();
    set({ controller: abort, channel: profile.key });
    setPaused(false);
    setMessage(null);
    try {
      const outcome = await uploadRecording(file, {
        label: labelWithGame(label.trim(), game || null, profile),
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

  const pause = () => state.controller?.abort();
  const percent = progress && progress.total ? Math.floor((progress.received / progress.total) * 100) : 0;

  return (
    <Section title="Opname toevoegen" intro="De opname gaat rechtstreeks naar de werker op de pc en blijft daar. Een afgebroken upload gaat verder waar hij stopte, ook als je later hetzelfde bestand opnieuw kiest.">
      {!workerOnline && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Uploaden kan alleen op de pc waarop de werker draait. Start eerst de werker.</p>}
      <div className="space-y-3">
        <Field label="Naam van de opname" hint="Bijvoorbeeld de datum en wat er gebeurt. Gebruik geen achternaam, school of woonplaats.">
          <input className={inputClass} value={label} maxLength={200} placeholder="bijv. 11-11 grot met creepers" onChange={(e) => setLabel(e.target.value)} disabled={busy || paused} />
        </Field>
        {profile.games.length > 1 && (
          <Field label="Game" hint="Welke game staat er in deze opname? Weet je het niet, dan herkent de analyse het zelf.">
            <select className={inputClass} value={game} onChange={(e) => setGame(e.target.value as GameId | "")} disabled={busy || paused}>
              <option value="">Laat de analyse het herkennen</option>
              {profile.games.map((g) => (
                <option key={g} value={g}>
                  {GAMES[g].name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} disabled={busy || paused} className="h-4 w-4 accent-emerald-600" />
          Testdata (geen echte gameplay; wordt gratis en zonder AI verwerkt)
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

        {file && (busy || paused) && <p className="text-sm text-slate-700">Bezig met: <span className="font-medium">{file.name}</span> ({formatBytes(file.size)}){state.channel && state.channel !== profile.key ? ` · voor ${state.channel}` : ""}</p>}
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

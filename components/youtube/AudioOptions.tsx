"use client";

// 23-11-2026 (Milan, superprompt V6, fase 31 en 33): three audio options under the player. A is this version itself
// (made with the recommended audio); B (energiek) and C (naturel) are previews of the same montage with other audio,
// made on the pc on request. Milan can also mix his own: voice A/B/C/none, music A/B/C/none, effects subtle/balanced/
// dynamic. "Kies deze audio" makes the real version with that audio and remembers the choice as a preference.

import { useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { choiceLabel, GAMING_SET, type AudioChoice, type MusicChoice, type SfxChoice, type Variant, type VoiceChoice } from "@/lib/kivoxel/audioOptions";
import { chooseAudio, queuePreview, type PreviewJob } from "@/lib/youtube/audioPreviewData";
import type { DbScript } from "@/lib/youtube/analysisData";
import { WORKER_URL } from "@/lib/youtube/protocol";

const STATUS: Record<string, string> = { queued: "in de rij", running: "wordt gemaakt", done: "klaar", failed: "mislukt", cancelled: "geannuleerd" };

export function AudioOptions({ studioId, channelId, script, previews, attempt, current, game, act }: {
  studioId: string;
  channelId: string | null;
  script: DbScript;
  /** Render jobs of this video with payload.preview, newest first. */
  previews: PreviewJob[];
  /** Next montage attempt number (for the job key). */
  attempt: number;
  /** What this version (option A) has: voice, music, effects. */
  current: { voice: string | null; music: string | null; sfx: number | null } | null;
  game: string | null;
  act: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const set = GAMING_SET;
  const [own, setOwn] = useState<AudioChoice>({ voice: "B", music: "A", sfx: "gebalanceerd" });
  const find = (variant: Variant, choice?: AudioChoice) => previews.find((p) => p.payload?.preview === variant && (!choice || (p.payload?.audio_choice && choiceLabel(set, p.payload.audio_choice) === choiceLabel(set, choice))));
  const make = (variant: Variant, choice: AudioChoice) => act(() => queuePreview(studioId, script, set, variant, choice));
  const choose = (variant: Variant, choice: AudioChoice) => act(() => chooseAudio(studioId, channelId, script, set, choice, attempt, { game, variant }));
  const ownJobs = previews.filter((p) => p.payload?.preview === "eigen").slice(0, 3);

  const Card = ({ variant, choice, job }: { variant: "B" | "C" | "eigen"; choice: AudioChoice; job: PreviewJob | undefined }) => {
    const file = job?.status === "done" ? job.result?.preview?.file : null;
    return (
      <div className="space-y-1.5 rounded-md border border-slate-200 p-2">
        <p className="text-xs font-semibold">{variant === "eigen" ? "Eigen combinatie" : set.variants[variant].label}</p>
        <p className="text-[11px] text-slate-600">{variant === "eigen" ? choiceLabel(set, choice) : set.variants[variant].why}</p>
        {file ? (
          <video src={`${WORKER_URL}/renders/${encodeURIComponent(file)}`} crossOrigin="anonymous" controls playsInline preload="none" className="max-h-56 w-full rounded bg-black" />
        ) : job ? (
          <p className="text-xs text-slate-600">Preview {STATUS[job.status] ?? job.status}{job.error ? `: ${job.error.slice(0, 120)}` : ""}</p>
        ) : (
          <Button variant="secondary" className="w-full justify-center text-xs" onClick={() => void make(variant, choice)}>
            Preview maken
          </Button>
        )}
        {file && (
          <>
            <p className="text-[11px] text-slate-500">{[job?.result?.preview?.voice ? `stem: ${job.result.preview.voice}` : "geen stem", job?.result?.preview?.music ?? "geen muziek", `${job?.result?.preview?.sfx ?? 0} effecten`].join(" · ")}</p>
            <Button className="w-full justify-center text-xs" onClick={() => void choose(variant, choice)}>
              Kies deze audio
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Drie audio-opties" className="space-y-2 rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Audio: drie opties</h3>
        <span className="text-[11px] text-slate-500">Previews worden gratis op de pc gemaakt (± 1–3 min per Short; met de eigen stem langer).</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1.5 rounded-md border border-violet-300 bg-violet-50/50 p-2">
          <p className="text-xs font-semibold">{set.variants.A.label} (deze versie)</p>
          <p className="text-[11px] text-slate-600">{set.variants.A.why}</p>
          <p className="text-[11px] text-slate-500">{current ? [current.voice ? `stem: ${current.voice}` : "geen stem", current.music ?? "geen muziek", `${current.sfx ?? 0} effecten`].join(" · ") : "Speel de video hierboven."}</p>
        </div>
        <Card variant="B" choice={set.variants.B.choice} job={find("B")} />
        <Card variant="C" choice={set.variants.C.choice} job={find("C")} />
      </div>
      <details className="rounded-md border border-slate-200 p-2">
        <summary className="cursor-pointer text-xs font-medium">Zelf combineren: stem, muziek en effecten los kiezen</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs">
            Stem
            <select className="mt-0.5 block w-full rounded border border-slate-300 bg-surface p-1" value={own.voice} onChange={(e) => setOwn({ ...own, voice: e.target.value as VoiceChoice })}>
              {(["A", "B", "C"] as const).map((k) => (
                <option key={k} value={k}>
                  {set.voices[k].label}
                </option>
              ))}
              <option value="geen">Geen stem</option>
            </select>
          </label>
          <label className="text-xs">
            Muziek
            <select className="mt-0.5 block w-full rounded border border-slate-300 bg-surface p-1" value={own.music} onChange={(e) => setOwn({ ...own, music: e.target.value as MusicChoice })}>
              {(["A", "B", "C"] as const).map((k) => (
                <option key={k} value={k}>
                  {set.music[k].label}
                </option>
              ))}
              <option value="geen">Geen muziek</option>
            </select>
          </label>
          <label className="text-xs">
            Geluidseffecten
            <select className="mt-0.5 block w-full rounded border border-slate-300 bg-surface p-1" value={own.sfx} onChange={(e) => setOwn({ ...own, sfx: e.target.value as SfxChoice })}>
              <option value="subtiel">Subtiel</option>
              <option value="gebalanceerd">Gebalanceerd</option>
              <option value="dynamisch">Dynamisch</option>
            </select>
          </label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {find("eigen", own) ? null : <Card variant="eigen" choice={own} job={undefined} />}
          {ownJobs.map((j) => (
            <Card key={j.id} variant="eigen" choice={j.payload?.audio_choice ?? own} job={j} />
          ))}
        </div>
      </details>
    </section>
  );
}

"use client";
// KIVOXEL fase 1, section 3: pick the audio mode of a montage and render again, without writing a new script.
import { useState } from "react";
import { AUDIO_MODES, presetFile, type AudioMode } from "@/lib/kivoxel/config";
import { queueRender, remontage, type DbScript } from "@/lib/youtube/analysisData";
import { channelAudioMode, profileFor } from "@/lib/youtube/gameProfile";

type RenderAudio = { mode?: string; label?: string; music?: string | null; sfx?: number; voice?: boolean };

/** The audio info the worker stored with a montage (yt_renders.qc.audio), if any. */
export function renderAudio(render: { qc?: unknown } | null | undefined): RenderAudio | null {
  const qc = render?.qc as { audio?: RenderAudio } | null | undefined;
  return qc?.audio ?? null;
}

/** A script from before fase 1: its lines are not tied to the Event Timeline (no `kind`), so a new mix alone does not help. */
export const oldScript = (script: DbScript) => !(Array.isArray(script.lines) && (script.lines as { kind?: unknown }[]).some((l) => typeof l?.kind === "string"));

export function AudioModeSwitch({ studioId, script, attempt, current, nextVersion, onQueued, act, channel }: { studioId: string; script: DbScript; attempt: number; current: RenderAudio | null; /** For "Opnieuw door de nieuwe montage" (a new script version). */ nextVersion?: number; onQueued?: () => void; act: (fn: () => Promise<void>) => Promise<unknown>; /** SpawnNado offers only its own audio modes. */ channel?: { slug?: string | null; name?: string | null } | null }) {
  const modes = presetFile.base.audio_modes;
  const profile = profileFor(channel);
  const allowed = AUDIO_MODES.filter((m) => !profile.audioModes || profile.audioModes.includes(m));
  const fallback = channelAudioMode(presetFile.channel_default.audio_mode, profile);
  const [mode, setMode] = useState<AudioMode>((allowed as readonly string[]).includes(current?.mode ?? "") ? (current!.mode as AudioMode) : fallback);
  if (oldScript(script) && nextVersion) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Gemaakt met de <span className="font-medium text-slate-800">oude montage</span>: het script hangt nog niet aan de momenten.</span>
        <button type="button" onClick={() => void act(async () => { await remontage(studioId, [{ videoId: script.video_id, nextVersion }]); }).then(() => onQueued?.())} className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50">
          🔁 Opnieuw door de nieuwe montage
        </button>
        <span className="text-slate-500">Nieuw script, stem en montage; daarna staat hij weer hier.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>
        Geluid nu: <span className="font-medium text-slate-800">{current?.label ?? "oude mix (vóór fase 1)"}</span>
        {current?.music ? ` · muziek: ${current.music}` : ""}
        {current?.sfx ? ` · ${current.sfx} geluidseffecten` : ""}
      </span>
      <label className="flex items-center gap-1">
        <span className="sr-only">Audio-modus</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as AudioMode)} className="rounded-md border border-slate-300 bg-transparent px-1.5 py-1">
          {allowed.map((m) => (
            <option key={m} value={m}>
              {modes[m].label}
              {m === fallback ? " (standaard)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void act(() => queueRender(studioId, script, attempt, mode)).then(() => onQueued?.())}
        className="rounded-md border border-slate-300 px-2 py-1 font-medium text-slate-800 hover:bg-slate-50"
      >
        Opnieuw monteren met dit geluid
      </button>
      <span className="text-slate-500">Het script blijft hetzelfde.</span>
    </div>
  );
}

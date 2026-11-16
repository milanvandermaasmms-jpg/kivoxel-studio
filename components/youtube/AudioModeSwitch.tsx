"use client";
// KIVOXEL fase 1, section 3: pick the audio mode of a montage and render again, without writing a new script.
import { useState } from "react";
import { AUDIO_MODES, presetFile, type AudioMode } from "@/lib/kivoxel/config";
import { queueRender, type DbScript } from "@/lib/youtube/analysisData";

type RenderAudio = { mode?: string; label?: string; music?: string | null; sfx?: number; voice?: boolean };

/** The audio info the worker stored with a montage (yt_renders.qc.audio), if any. */
export function renderAudio(render: { qc?: unknown } | null | undefined): RenderAudio | null {
  const qc = render?.qc as { audio?: RenderAudio } | null | undefined;
  return qc?.audio ?? null;
}

export function AudioModeSwitch({ studioId, script, attempt, current, onQueued, act }: { studioId: string; script: DbScript; attempt: number; current: RenderAudio | null; onQueued?: () => void; act: (fn: () => Promise<void>) => Promise<unknown> }) {
  const modes = presetFile.base.audio_modes;
  const [mode, setMode] = useState<AudioMode>((AUDIO_MODES as readonly string[]).includes(current?.mode ?? "") ? (current!.mode as AudioMode) : presetFile.channel_default.audio_mode);
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
          {AUDIO_MODES.map((m) => (
            <option key={m} value={m}>
              {modes[m].label}
              {m === presetFile.channel_default.audio_mode ? " (standaard)" : ""}
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

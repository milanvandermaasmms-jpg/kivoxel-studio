"use client";

import { Music, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { MOODS, type Mood, type Track } from "@/lib/kivoxel/media";
import type { FlowState } from "@/lib/youtube/flowData";
import { WORKER_URL } from "@/lib/youtube/protocol";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;

/** "relentless-iros-young-main-version-47984-01-42.mp3" → title "Relentless", artist "Iros Young" (Milan checks it). */
export function guessFromFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/-main-version.*$/i, "").replace(/-\d+(-\d+)*$/, "");
  const words = base.split(/[-_]+/).filter(Boolean);
  const cap = (w: string[]) => w.map((x) => x[0]?.toUpperCase() + x.slice(1)).join(" ");
  if (words.length <= 2) return { title: cap(words), artist: "" };
  return { title: cap(words.slice(0, Math.ceil(words.length / 2))), artist: cap(words.slice(Math.ceil(words.length / 2))) };
}

/**
 * Muziek (23-11-2026): Milan downloads a track with his Uppbeat account (no download API exists), imports it here once
 * with the Uppbeat link, and the editor can then choose it for the channels he ticked. Per track: source, licence, credit
 * (only needed for a free download) and how often it was used in a montage version.
 */
export function MusicLibrary({ state, workerOnline }: { state: Ready | null; workerOnline: boolean }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", artist: "", url: "", energy: 4, moods: ["hype"] as Mood[], channels: ["kivoxel", "spawnnado"], bpm: "", credit: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => void fetch(`${WORKER_URL}/music`).then((r) => r.json() as Promise<Track[]>).then(setTracks).catch(() => setTracks(null));
  useEffect(() => {
    if (workerOnline) load();
  }, [workerOnline]);

  const used = new Map<string, number>();
  for (const r of state?.board.renders ?? []) for (const f of ((r.qc as { audio?: { musicFiles?: string[] } } | null)?.audio?.musicFiles ?? [])) used.set(f, (used.get(f) ?? 0) + 1);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const meta = { ...form, bpm: form.bpm ? Number(form.bpm) : undefined, fileName: file.name };
      const res = await fetch(`${WORKER_URL}/music/import?meta=${encodeURIComponent(JSON.stringify(meta))}`, { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } });
      const body = (await res.json()) as Track & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Importeren mislukt");
      setMsg(`"${body.title}" staat in de bibliotheek (${body.bpm} BPM${body.bpm_measured ? ", geschat" : ""}). De editor kan hem nu kiezen.`);
      setFile(null);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Importeren mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold">
        <Music className="h-4 w-4" aria-hidden /> Muziek (Uppbeat)
      </h2>
      <p className="text-slate-600">
        Uppbeat heeft geen download-koppeling. Download een track zelf op uppbeat.io (ingelogd met je Creator-account), en importeer hem hier één keer met de link van de track. Met je betaalde abonnement en je kanalen op de safelist is geen credit in de beschrijving nodig; vul alleen een credit in bij een gratis download. Die komt dan vanzelf in de beschrijving van de video die de track gebruikt.
      </p>
      {!workerOnline ? (
        <p className="text-slate-500">Start de werker op de pc om muziek te importeren.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 sm:col-span-2">
            <span className="text-xs text-slate-600">Audiobestand (mp3 of wav van Uppbeat)</span>
            <input type="file" accept=".mp3,.wav,.ogg,.m4a,.flac,audio/*" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) setForm((x) => ({ ...x, ...guessFromFileName(f.name) }));
            }} />
          </label>
          <label className="grid gap-1"><span className="text-xs text-slate-600">Titel</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <label className="grid gap-1"><span className="text-xs text-slate-600">Artiest</span><input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <label className="grid gap-1 sm:col-span-2"><span className="text-xs text-slate-600">Uppbeat-link van de track</span><input value={form.url} placeholder="https://uppbeat.io/t/..." onChange={(e) => setForm({ ...form, url: e.target.value })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <label className="grid gap-1"><span className="text-xs text-slate-600">Energie (1 rustig – 5 maximaal)</span><input type="number" min={1} max={5} value={form.energy} onChange={(e) => setForm({ ...form, energy: Number(e.target.value) })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <label className="grid gap-1"><span className="text-xs text-slate-600">BPM (leeg = de werker schat)</span><input value={form.bpm} inputMode="numeric" onChange={(e) => setForm({ ...form, bpm: e.target.value.replace(/\D/g, "") })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <fieldset className="sm:col-span-2"><legend className="text-xs text-slate-600">Sfeer</legend>
            <div className="flex flex-wrap gap-2">{MOODS.map((m) => <label key={m} className="flex items-center gap-1"><input type="checkbox" checked={form.moods.includes(m)} onChange={(e) => setForm({ ...form, moods: e.target.checked ? [...form.moods, m] : form.moods.filter((x) => x !== m) })} /> {m}</label>)}</div>
          </fieldset>
          <fieldset className="sm:col-span-2"><legend className="text-xs text-slate-600">Mag gebruikt worden op</legend>
            <div className="flex gap-3">{[["kivoxel", "KIVOXEL"], ["spawnnado", "SpawnNado"]].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={form.channels.includes(k)} onChange={(e) => setForm({ ...form, channels: e.target.checked ? [...form.channels, k] : form.channels.filter((x) => x !== k) })} /> {l}</label>)}</div>
          </fieldset>
          <label className="grid gap-1 sm:col-span-2"><span className="text-xs text-slate-600">Credit (alleen bij een gratis download; anders leeg laten)</span><input value={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.value })} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" /></label>
          <div className="sm:col-span-2">
            <Button disabled={busy || !file || !form.title.trim() || !form.url.trim() || !form.moods.length || !form.channels.length} onClick={() => void submit()}>
              <Upload className="h-4 w-4" aria-hidden /> Importeren
            </Button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="rounded-md bg-slate-50 px-3 py-2">{msg}</p>}
      {tracks && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-600">Bibliotheek ({tracks.filter((t) => !t.test).length} tracks)</summary>
          <ul className="mt-2 divide-y divide-slate-200">
            {tracks.filter((t) => !t.test).map((t) => (
              <li key={t.file} className="py-1.5">
                <span className="font-medium">{t.title}</span>
                {t.artist ? ` – ${t.artist}` : ""} · energie {t.energy} · {t.moods.join(", ")} · {t.bpm} BPM{t.bpm_measured ? " (geschat)" : ""}
                <span className="block text-xs text-slate-500">
                  {t.source} · {t.credit ? `credit: ${t.credit}` : "geen credit nodig"} · {t.channels?.length ? `alleen ${t.channels.join(", ")}` : "alle kanalen"} · {used.get(t.file) ?? 0}× gebruikt
                  {t.url ? <> · <a href={t.url} target="_blank" rel="noreferrer" className="underline">bron</a></> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

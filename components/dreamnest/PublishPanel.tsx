"use client";

import { useCallback, useEffect, useState } from "react";
import { Notice, Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { loadPublications, savePublication, type PublicationDraft, type PublicationRow } from "@/lib/dreamnest/data";
import { publishProblem, stamp, type Chapter } from "@/lib/dreamnest/package";
import type { Channel } from "@/lib/youtube/channels";
import { quotaText } from "@/lib/youtube/connection";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { youtubeStatus } from "@/lib/youtube/workerClient";

export type PackageResult = {
  title: string;
  description: string;
  tags: string[];
  chapters: Chapter[];
  thumbs: string[];
  long_file: string;
  qc_ok: boolean;
  shorts: { id: string; file: string; title: string; description: string; tags: string[]; lengthS: number }[];
};

const media = (path: string) => `${WORKER_URL}/dreamnest/${path.split("/").map(encodeURIComponent).join("/")}`;
const STATUS: Record<PublicationRow["status"], string> = { draft: "Concept", queued: "Klaargezet, wacht op de werker", uploading: "Bezig met uploaden", uploaded: "Geüpload (privé)", scheduled: "Ingepland", failed: "Mislukt" };

/** Tomorrow 19:00 local time, the calm evening slot; as the value of a datetime-local input. */
function defaultMoment(daysAhead = 1): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(19, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Fase 5 (megaprompt §7.13): publishing from the Studio, always Milan's click. Big "Uploaden naar", fixed Made for Kids
 * and AI label, scheduled and private by default. One card for the long video and one per Short.
 */
export function PublishPanel({ pkg, channel, studioId, episodeId, isAdmin }: { pkg: PackageResult; channel: Channel; studioId: string; episodeId: string; isAdmin: boolean }) {
  const [pubs, setPubs] = useState<PublicationRow[] | null | undefined>(undefined);
  const [quota, setQuota] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setPubs(await loadPublications(episodeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden lukte niet.");
    }
    const s = await youtubeStatus(channel.id).catch(() => null);
    setQuota(s?.connected ? quotaText(s.quota) : null);
  }, [episodeId, channel.id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const busy = pubs?.some((p) => p.status === "queued" || p.status === "uploading");
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [busy, refresh]);

  if (pubs === undefined) return null;
  if (pubs === null) return <Notice tone="error">Publiceren komt er met migratie 053 (nog niet uitgevoerd).</Notice>;
  const linked = !!channel.youtube_channel_id;
  const items: { key: string; label: string; draft: PublicationDraft }[] = [
    { key: "long", label: "Lange video", draft: { kind: "long", short_id: "", file: pkg.long_file, thumbnail: pkg.thumbs[0] ?? null, title: pkg.title, description: pkg.description, tags: pkg.tags, publish_at: null } },
    ...pkg.shorts.map((s, i) => ({ key: s.id, label: `Short ${i + 1} (${s.lengthS} s)`, draft: { kind: "short" as const, short_id: s.id, file: s.file, thumbnail: null, title: s.title, description: s.description, tags: s.tags, publish_at: null } })),
  ];
  return (
    <Section title="Publiceren" intro="Er gaat niets online zonder jouw klik. Standaard ingepland en tot dan privé; YouTube zet de video op het gekozen moment zelf openbaar.">
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border-2 border-[#e9c86b] bg-[#141b3d] px-4 py-3 text-[#f4eedf]">
        <span className="text-sm">Uploaden naar:</span>
        {channel.youtube_thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.youtube_thumbnail_url} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden className="text-2xl">🌙</span>
        )}
        <span className="text-lg font-semibold text-[#e9c86b]">{channel.youtube_title ?? "nog niet gekoppeld"}</span>
        {channel.youtube_channel_id && <span className="font-mono text-xs text-[#c8c0ea]">{channel.youtube_channel_id}</span>}
        {quota && <span className="ml-auto text-xs text-[#c8c0ea]">YouTube-quotum vandaag: {quota}</span>}
      </div>
      {!linked && <Notice tone="error">Koppel eerst het Dreamnest-kanaal (onderaan bij Kanaal en YouTube).</Notice>}
      {!pkg.qc_ok && <Notice tone="error">De controle (QC) van de montage is niet ✅: de lange video kan niet gepubliceerd worden.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="space-y-3">
        {items.map((it, i) => (
          <PublishCard key={it.key} label={it.label} start={it.draft} row={pubs.find((p) => p.kind === it.draft.kind && p.short_id === it.draft.short_id) ?? null} thumbs={it.draft.kind === "long" ? pkg.thumbs : []} chapters={it.draft.kind === "long" ? pkg.chapters : []} qcOk={pkg.qc_ok} linked={linked} isAdmin={isAdmin} defaultAt={defaultMoment(1 + i)} onSave={async (d, queue, row) => {
            try {
              setError(null);
              await savePublication(studioId, episodeId, channel.id, row, d, queue);
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Opslaan lukte niet.");
            }
          }} />
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">Made for Kids en het AI-label staan altijd aan. Eindschermen en kaarten kunnen bij Made for Kids niet; de beschrijving verwijst naar de afspeellijst &quot;DreamNest | Magical Sleep Worlds&quot;. Een lange video kost ± 1.750 quotum-eenheden, een Short ± 1.650 (gedeeld met KIVOXEL): verstuur Shorts liefst op verschillende dagen.</p>
    </Section>
  );
}

function PublishCard({ label, start, row, thumbs, chapters, qcOk, linked, isAdmin, defaultAt, onSave }: { label: string; start: PublicationDraft; row: PublicationRow | null; thumbs: string[]; chapters: Chapter[]; qcOk: boolean; linked: boolean; isAdmin: boolean; defaultAt: string; onSave: (d: PublicationDraft, queue: boolean, row: PublicationRow | null) => Promise<void> }) {
  const initial = row ? { ...start, thumbnail: row.thumbnail, title: row.title, description: row.description, tags: row.tags, publish_at: row.publish_at } : start;
  const [d, setD] = useState<PublicationDraft>(initial);
  const [at, setAt] = useState<string>(initial.publish_at ? toLocalInput(initial.publish_at) : defaultAt);
  const [scheduled, setScheduled] = useState(initial.publish_at !== null || !row);
  const [saving, setSaving] = useState(false);
  const locked = !!row && !["draft", "failed"].includes(row.status);
  const draft = { ...d, publish_at: scheduled ? new Date(at).toISOString() : null };
  const problem = publishProblem({ kind: d.kind, title: d.title, description: d.description, tags: d.tags, publishAt: draft.publish_at, qcOk, channelLinked: linked });
  const save = async (queue: boolean) => {
    setSaving(true);
    await onSave(draft, queue, row);
    setSaving(false);
  };
  const input = "mt-1 block w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm";
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {label}
          {row && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium">{STATUS[row.status]}{row.status === "uploading" && row.progress !== null ? ` ${Math.round(row.progress)}%` : ""}</span>}
        </p>
        {row?.youtube_video_id && (
          <a href={`https://studio.youtube.com/video/${row.youtube_video_id}/edit`} target="_blank" rel="noreferrer" className="text-sm text-cyan-700 underline underline-offset-2">
            Openen in YouTube Studio
          </a>
        )}
      </div>
      {row?.error && <p className={`mt-1 text-sm ${row.status === "failed" ? "text-red-800" : "text-amber-800"}`}>{row.error}</p>}
      {!locked && isAdmin && (
        <div className="mt-2 space-y-2">
          {thumbs.length > 0 && (
            <fieldset>
              <legend className="text-sm">Thumbnail</legend>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {thumbs.map((t) => (
                  <label key={t} className={`cursor-pointer rounded border-2 ${d.thumbnail === t ? "border-[#e9c86b]" : "border-transparent"}`}>
                    <input type="radio" name="thumb" className="sr-only" checked={d.thumbnail === t} onChange={() => setD({ ...d, thumbnail: t })} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={media(t)} crossOrigin="anonymous" alt={`Thumbnail ${t.slice(-5, -4)}`} className="aspect-video w-full rounded object-cover" />
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {d.kind === "short" && <video src={media(d.file)} crossOrigin="anonymous" controls playsInline preload="metadata" className="h-64 rounded bg-black" aria-label={label} />}
          <label className="block text-sm">
            Titel ({d.title.length}/100)
            <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} className={input} />
          </label>
          <label className="block text-sm">
            Beschrijving
            <textarea value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} rows={d.kind === "long" ? 10 : 4} className={`${input} font-mono text-xs`} />
          </label>
          {chapters.length > 0 && <p className="text-xs text-slate-500">{chapters.length} hoofdstukken uit de tijdlijn (staan in de beschrijving), van {stamp(chapters[0].atS)} tot {stamp(chapters[chapters.length - 1].atS)}.</p>}
          <label className="block text-sm">
            Tags (met komma&apos;s)
            <input value={d.tags.join(", ")} onChange={(e) => setD({ ...d, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} className={input} />
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} /> Inplannen op
            </label>
            <input type="datetime-local" value={at} disabled={!scheduled} onChange={(e) => setAt(e.target.value)} className="rounded-md border border-slate-300 bg-transparent px-2 py-1" />
            {!scheduled && <span className="text-xs text-slate-500">Zonder tijdstip blijft hij privé tot je hem zelf openbaar zet.</span>}
          </div>
          <p className="text-xs text-slate-600">Made for Kids: aan (vast) · AI-label: aan (vast) · Taal: Engels</p>
          {problem && <p className="text-sm text-red-800">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => void save(false)}>
              Opslaan
            </Button>
            <Button disabled={saving || !!problem} onClick={() => void save(true)}>
              {row?.status === "failed" ? "Opnieuw uploaden" : scheduled ? "Uploaden en inplannen" : "Privé uploaden"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

"use client";

// 24-11-2026 (superprompt V5, uploadcontrole): everything on YouTube checked against the studio's rules. Only a report:
// changing a video that is on YouTube is Milan's own choice in YouTube Studio.

import { useEffect, useMemo, useState } from "react";
import { Fold } from "@/components/settings/Section";
import { supabase } from "@/lib/supabase";
import { profileFor } from "@/lib/youtube/gameProfile";
import { auditSummary, auditUpload, type AuditRow } from "@/lib/youtube/uploadAudit";

type Pub = { id: string; channel_id: string | null; video_id: string; render_id: string | null; title: string; description: string; tags: string[] | null; made_for_kids: boolean | null; contains_synthetic_media: boolean | null; status: string; visibility: string | null; youtube_video_id: string };

const chunks = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function loadAudit(studioId: string): Promise<AuditRow[]> {
  const pubs = await supabase.from("yt_publications").select("id, channel_id, video_id, render_id, title, description, tags, made_for_kids, contains_synthetic_media, status, visibility, youtube_video_id").eq("studio_id", studioId).not("youtube_video_id", "is", null).limit(1000).returns<Pub[]>();
  if (pubs.error) throw new Error(pubs.error.message);
  const list = pubs.data ?? [];
  const [channels, videos, renders] = await Promise.all([
    supabase.from("yt_channels").select("id, slug, name").eq("studio_id", studioId).returns<{ id: string; slug: string | null; name: string }[]>(),
    Promise.all(chunks([...new Set(list.map((p) => p.video_id))]).map((ids) => supabase.from("yt_videos").select("id, recording_id").in("id", ids).returns<{ id: string; recording_id: string | null }[]>())),
    Promise.all(chunks([...new Set(list.map((p) => p.render_id).filter((x): x is string => !!x))]).map((ids) => supabase.from("yt_renders").select("id, qc").in("id", ids).returns<{ id: string; qc: { audio?: { voiceEngine?: string | null } | null } | null }[]>())),
  ]);
  const vids = new Map(videos.flatMap((r) => r.data ?? []).map((v) => [v.id, v.recording_id]));
  const recIds = [...new Set([...vids.values()].filter((x): x is string => !!x))];
  const recs = await Promise.all(chunks(recIds).map((ids) => supabase.from("yt_recordings").select("id, label").in("id", ids).returns<{ id: string; label: string }[]>()));
  const labels = new Map(recs.flatMap((r) => r.data ?? []).map((r) => [r.id, r.label]));
  const voice = new Map(renders.flatMap((r) => r.data ?? []).map((r) => [r.id, r.qc?.audio?.voiceEngine ?? null]));
  const chan = new Map((channels.data ?? []).map((c) => [c.id, c]));
  return list.map((p) => {
    const c = p.channel_id ? chan.get(p.channel_id) : undefined;
    const profile = profileFor(c ?? null);
    const rec = vids.get(p.video_id);
    const findings = auditUpload({
      id: p.id,
      youtubeVideoId: p.youtube_video_id,
      title: p.title ?? "",
      description: p.description ?? "",
      tags: p.tags,
      madeForKids: p.made_for_kids,
      syntheticMedia: p.contains_synthetic_media,
      status: p.status,
      visibility: p.visibility,
      profile,
      recordingLabel: rec ? (labels.get(rec) ?? null) : null,
      voiceEngine: p.render_id ? (voice.get(p.render_id) ?? null) : null,
    });
    return { id: p.id, youtubeVideoId: p.youtube_video_id, title: p.title, channel: c?.name ?? profile.name, status: p.status, findings };
  });
}

const STATUS: Record<string, string> = { published: "live", uploaded: "privé geüpload", scheduled: "ingepland", processing: "YouTube verwerkt" };

export function UploadAudit({ studioId }: { studioId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  useEffect(() => {
    void loadAudit(studioId).then(setRows).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [studioId]);
  const sum = useMemo(() => (rows ? auditSummary(rows) : null), [rows]);
  const shown = (rows ?? []).filter((r) => r.findings.some((f) => f.severity === "probleem") || (notes && r.findings.length)).sort((a, b) => Number(b.findings.some((f) => f.severity === "probleem")) - Number(a.findings.some((f) => f.severity === "probleem")));
  return (
    <Fold id="library.uploadaudit" title="Uploadcontrole" intro={sum ? (sum.problems ? `${sum.problems} van ${sum.total} video's op YouTube hebben een probleem` : `Alle ${sum.total} video's op YouTube in orde`) : "Alles wat op YouTube staat, nagelopen."}>
      <p className="text-xs text-slate-600">Elke video die op YouTube staat, nagelopen op de regels van de studio: Engelse tekst, het juiste kanaal en de juiste game, de AI-melding bij de gekloonde stem en de keuzes voor de doelgroep. Dit is alleen een overzicht: een video op YouTube aanpassen doe je zelf in YouTube Studio.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!sum ? (
        <p className="text-sm text-slate-500">Nalopen…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">{sum.problems} probleem</span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">{sum.notes} let op</span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{sum.clean} in orde</span>
            <button type="button" aria-pressed={notes} onClick={() => setNotes(!notes)} className="min-h-8 rounded-full border border-slate-300 bg-surface px-3 text-slate-700 underline-offset-2 hover:underline">
              {notes ? "Alleen problemen tonen" : "Ook 'let op' tonen"}
            </button>
          </div>
          {!shown.length ? (
            <p className="text-sm text-slate-600">{notes ? "Niets te melden." : "Geen problemen gevonden."}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.slice(0, 200).map((r) => (
                <li key={r.id} className="space-y-1 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <a href={`https://youtu.be/${r.youtubeVideoId}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline">
                      {r.title || "(zonder titel)"}
                    </a>
                    <span className="text-xs text-slate-600">
                      {r.channel} · {STATUS[r.status] ?? r.status}
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {r.findings.map((f) => (
                      <li key={f.key} className={`text-xs ${f.severity === "probleem" ? "text-red-700" : "text-amber-800"}`}>
                        {f.severity === "probleem" ? "Probleem" : "Let op"}: {f.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Fold>
  );
}

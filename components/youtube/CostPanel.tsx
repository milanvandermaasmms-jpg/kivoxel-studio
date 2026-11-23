"use client";

// 23-11-2026 (superprompt V5 fase 23): costs per production, from the real cost lines in the studio. Measured and
// estimated apart (an estimate is a reservation that was never settled). Ivar and other costs without a production
// stand on their own rows.

import { useEffect, useMemo, useState } from "react";
import { Fold } from "@/components/settings/Section";
import { supabase } from "@/lib/supabase";
import { costOverview, eur, type CostLine, type JobRef } from "@/lib/youtube/costOverview";

type Data = { lines: CostLine[]; jobs: JobRef[]; recordings: Record<string, string>; videos: Record<string, { title: string; recordingId: string | null }> };

async function loadCosts(studioId: string): Promise<Data> {
  const costs = await supabase.from("yt_costs").select("job_id, video_id, amount_cents, is_estimate, category, service, incurred_on").eq("studio_id", studioId).eq("currency", "EUR").order("incurred_on", { ascending: false }).limit(5000).returns<CostLine[]>();
  if (costs.error) throw new Error(costs.error.message);
  const lines = costs.data ?? [];
  const ids = [...new Set(lines.map((l) => l.job_id).filter((x): x is string => !!x))];
  const jobs: JobRef[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const r = await supabase.from("yt_jobs").select("id, step, video_id, recording_id").in("id", ids.slice(i, i + 150)).returns<JobRef[]>();
    jobs.push(...(r.data ?? []));
  }
  const videoIds = [...new Set([...lines.map((l) => l.video_id), ...jobs.map((j) => j.video_id)].filter((x): x is string => !!x))];
  const recIds = [...new Set(jobs.map((j) => j.recording_id).filter((x): x is string => !!x))];
  const [vids, recs] = await Promise.all([
    videoIds.length ? supabase.from("yt_videos").select("id, promise, recording_id").in("id", videoIds.slice(0, 500)).returns<{ id: string; promise: string | null; recording_id: string | null }[]>() : Promise.resolve({ data: [] as { id: string; promise: string | null; recording_id: string | null }[] }),
    recIds.length ? supabase.from("yt_recordings").select("id, label").in("id", recIds.slice(0, 500)).returns<{ id: string; label: string }[]>() : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ]);
  const scripts = videoIds.length ? await supabase.from("yt_scripts").select("video_id, titles, version").in("video_id", videoIds.slice(0, 500)).returns<{ video_id: string; titles?: string[] | null; version: number }[]>() : { data: [] };
  const titleOf = (id: string) => (scripts.data ?? []).filter((s) => s.video_id === id).sort((a, b) => b.version - a.version)[0]?.titles?.[0];
  return {
    lines,
    jobs,
    recordings: Object.fromEntries((recs.data ?? []).map((r) => [r.id, r.label])),
    videos: Object.fromEntries((vids.data ?? []).map((v) => [v.id, { title: titleOf(v.id) ?? v.promise ?? "Video", recordingId: v.recording_id }])),
  };
}

const monthStart = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).format(new Date()) + "-01";

export function CostPanel({ studioId }: { studioId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(true);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void loadCosts(studioId).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [studioId]);
  const view = useMemo(() => (data ? costOverview(data.lines, data.jobs, { recordings: data.recordings, videos: data.videos }, month ? monthStart() : undefined) : null), [data, month]);
  return (
    <Fold id="library.costs" title="Kosten per productie" intro={view ? `${month ? "Deze maand" : "Alles"}: ${eur(view.total.measured)} gemeten${view.total.estimated ? ` + ${eur(view.total.estimated)} geschat` : ""}` : "Wat elke opname en video echt kostte."}>
      <p className="text-xs text-slate-600">Uit de kostenlijst van de studio. Een analyse hoort bij de opname, een script, montage of check bij de video. Gemeten = het echte bedrag na de aanroep; geschat = een reservering die nooit is afgerekend (bijvoorbeeld na een netwerkfout). Stem (gratis deel van Google), montage en metingen op de pc kosten niets.</p>
      <div className="flex gap-2" role="group" aria-label="Periode">
        {[true, false].map((m) => (
          <button key={String(m)} type="button" aria-pressed={month === m} onClick={() => setMonth(m)} className={`min-h-9 rounded-full border px-3 text-xs ${month === m ? "border-ink bg-ink text-ink-fg" : "border-slate-300 bg-surface text-slate-700"}`}>
            {m ? "Deze maand" : "Alles"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!view ? (
        <p className="text-sm text-slate-500">Laden…</p>
      ) : !view.rows.length ? (
        <p className="text-sm text-slate-500">Geen kosten in deze periode.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {view.rows.slice(0, all ? 500 : 15).map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{r.kind}</span>
                  {r.label}
                </span>
                <span className="text-xs text-slate-600">{Object.entries(r.byStep).map(([k, v]) => `${k} ${eur(v)}`).join(" · ")}</span>
                <span className="w-24 text-right font-medium tabular-nums">{eur(r.measured + r.estimated)}{r.estimated ? <span className="block text-[11px] font-normal text-amber-800">waarvan {eur(r.estimated)} geschat</span> : null}</span>
              </li>
            ))}
          </ul>
          {view.rows.length > 15 && (
            <button type="button" onClick={() => setAll(!all)} className="text-xs underline underline-offset-2">
              {all ? "Minder tonen" : `Alle ${view.rows.length} tonen`}
            </button>
          )}
        </>
      )}
    </Fold>
  );
}

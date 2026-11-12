"use client";

import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { dropMoment, signals, type Production, type Signal } from "@/lib/youtube/signals";
import { loadReports, type Report } from "@/lib/youtube/reports";
import { biggestDrop, curvePath, engagedShare, loadStats, saveViewedPct, type Manual, type StatsView, type VideoRow } from "@/lib/youtube/stats";
import { refreshStats } from "@/lib/youtube/workerClient";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString("nl-NL"));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`);
const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : "–");
const dur = (s: number | null) => (s === null ? "–" : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** One number with where it comes from: near-live counts or delayed analytics (2.2 chapter 7: show the difference). */
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500">{note}</p>
    </div>
  );
}

function Curve({ v, p }: { v: VideoRow; p: Production | undefined }) {
  if (!v.retention?.length) return <span className="text-slate-500">nog geen kijkcurve</span>;
  const drop = dropMoment(v, p);
  const fallback = biggestDrop(v.retention);
  return (
    <div className="space-y-0.5">
      <svg viewBox="0 0 160 40" className="h-10 w-40" role="img" aria-label="Kijkcurve: hoeveel kijkers er op elk moment nog kijken">
        <line x1="0" x2="160" y1={40 - 40 / 1.2} y2={40 - 40 / 1.2} stroke="currentColor" className="text-slate-300" strokeDasharray="2 2" />
        <path d={curvePath(v.retention, 160, 40)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-600" />
      </svg>
      {drop ? (
        <p className="text-[11px] text-slate-600">
          Grootste afhaakmoment rond {dur(drop.atMs / 1000)} ({Math.round(drop.share * 100)}% van de kijkers){drop.fragment ? `: ongeveer ${drop.fragment}` : ""}
        </p>
      ) : (
        fallback && <p className="text-[11px] text-slate-600">Grootste afhaakmoment rond {Math.round(fallback.at * 100)}% van de video</p>
      )}
    </div>
  );
}

/** "Viewed" (vs "Swiped away") from YouTube Studio: the API does not give it, so Milan fills it in (2.2, 24.7). */
function ViewedInput({ studioId, v, manual, onSaved }: { studioId: string; v: VideoRow; manual: Manual | undefined; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(manual ? String(manual.value).replace(".", ",") : "");
  const [state, setState] = useState<string | null>(null);
  async function save() {
    const text = value.trim().replace(",", ".");
    try {
      await saveViewedPct(studioId, v.youtube_video_id, text === "" ? null : Number(text));
      setState("Opgeslagen");
      await onSaved();
    } catch (e) {
      setState(e instanceof Error ? e.message : "Opslaan lukte niet.");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1">
        <span className="text-slate-500">Viewed (vs swiped away)</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="bijv. 72,5" className="w-20 rounded-md border border-slate-300 bg-transparent px-2 py-0.5" aria-label="Percentage Viewed uit YouTube Studio" />
        <span>%</span>
      </label>
      <Button variant="ghost" onClick={() => void save()}>
        Opslaan
      </Button>
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">handmatig{manual ? `, ${day(manual.measured_on)}` : ""}</span>
      {state && <span className="text-slate-500">{state}</span>}
    </div>
  );
}

/** Performance report after 24 hours, 72 hours and 7 days, from the worker's own hourly measurements (fase F). */
function ReportLine({ report }: { report: Report | undefined }) {
  if (!report) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <span className="text-slate-500">Prestatierapport:</span>
      {report.milestones.map((m) => (
        <span key={m.key}>
          {m.label}:{" "}
          {m.state === "measured" ? (
            <>
              <strong className="tabular-nums">{n(m.views)}</strong> views
              {m.channelMedian !== null && <span className="text-slate-500"> (mediaan van je andere {m.others} video&apos;s: {n(m.channelMedian)})</span>}
            </>
          ) : m.state === "future" ? (
            <span className="text-slate-500">nog niet</span>
          ) : (
            <span className="text-slate-500">niet gemeten (werker stond uit)</span>
          )}
        </span>
      ))}
    </div>
  );
}

function Signals({ list }: { list: Signal[] }) {
  return (
    <Section title="Signaleringen" intro="Alleen op echte cijfers, met de regel en de getallen erbij. Er wordt nooit een conclusie getrokken uit één video: elke vergelijking vraagt minstens 3 andere video's.">
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">Nog geen signaleringen. Die verschijnen als er genoeg openbare video's met cijfers zijn om te vergelijken.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((s, i) => (
            <li key={`${s.kind}-${s.videoId ?? i}`} className={`rounded-md border p-2 text-xs ${s.tone === "good" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="font-medium">{s.title}</p>
              <p className="text-slate-600">{s.rule}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Analytics Center (fase E): channel overview and numbers per video, with the time of the last sync. */
export function StatsCenter({ studioId, workerOnline }: { studioId: string; workerOnline: boolean | undefined }) {
  const [view, setView] = useState<StatsView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const refresh = useCallback(async () => {
    try {
      const v = await loadStats(studioId);
      setView(v);
      if (v !== "migration") setReports(await loadReports(studioId, v.videos).catch(() => []));
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Cijfers laden lukte niet." });
      setView(null);
    }
  }, [studioId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      const m = await refreshStats();
      setMessage({ ok: true, text: m ? `Bijgewerkt: ${m}` : "Bijgewerkt." });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Verversen lukte niet." });
    } finally {
      setBusy(false);
    }
  }

  if (view === undefined) return <p className="text-sm text-slate-500">Cijfers laden…</p>;
  if (view === "migration") return <Section title="Cijfers"><p className="text-sm text-slate-600">De cijfers komen er met migratie 041 (nog niet uitgevoerd).</p></Section>;
  const c = view?.channel ?? null;
  const analyticsNote = c?.analytics_until ? `YouTube Analytics, t/m ${day(c.analytics_until)}` : "YouTube Analytics (nog niet opgehaald)";

  return (
    <div className="space-y-4">
      <Section
        title="Kanaaloverzicht"
        intro="Tellers zoals abonnees en views komen bijna actueel uit YouTube (elk uur bijgewerkt). Kijktijd, engaged views en de 7- en 28-dagencijfers komen uit YouTube Analytics en lopen 1 à 2 dagen achter; daarom staat erbij t/m welke dag."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>{c ? `Laatst opgehaald: ${when(c.taken_at)}` : "Nog niets opgehaald. De werker haalt de cijfers elk uur op zodra YouTube gekoppeld is."}</span>
          <Button variant="secondary" disabled={busy || !workerOnline} onClick={() => void syncNow()}>
            {busy ? "Ophalen…" : "Nu verversen"}
          </Button>
        </div>
        {!workerOnline && <p className="text-xs text-slate-500">Verversen kan als de werker op de pc draait.</p>}
        {c?.analytics_error && <p className="text-xs text-amber-800">Statistieken: {c.analytics_error}</p>}
        {message && <p className={`text-xs ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p>}
        {c && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Abonnees" value={c.subscribers === null ? "verborgen" : n(c.subscribers)} note="bijna actueel" />
            <Tile label="Views totaal" value={n(c.views_total)} note="bijna actueel" />
            <Tile label="Views laatste 24 uur" value={n(view?.views24h)} note={view?.views24h === null ? "na een dag meten" : "eigen meting, bijna actueel"} />
            <Tile label="Video's" value={n(c.videos_total)} note="bijna actueel" />
            <Tile label="Views 7 dagen" value={n(c.views_7d)} note={analyticsNote} />
            <Tile label="Views 28 dagen" value={n(c.views_28d)} note={analyticsNote} />
            <Tile label="Engaged views 28 dagen" value={n(c.engaged_views_28d)} note={analyticsNote} />
            <Tile label="Kijktijd 28 dagen" value={c.watch_minutes_28d === null ? "–" : `${n(Math.round(c.watch_minutes_28d / 60))} uur`} note={analyticsNote} />
          </div>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          Omzet en RPM: niet beschikbaar (alleen voor kanalen in het YouTube Partner Programma) · Impressies en CTR: YouTube levert die niet via de API
        </p>
      </Section>

      {view && <Signals list={signals(view.videos, view.production)} />}

      <Section title="Per video" intro="Nieuwste eerst. Bij Shorts telt YouTube sinds 31 maart 2025 elke start als view; vergelijk daarom met engaged views (kijkers die echt bleven).">
        {!view?.videos.length ? (
          <p className="text-sm text-slate-500">Nog geen video's met cijfers.</p>
        ) : (
          <ul className="space-y-3">
            {view.videos.map((v) => (
              <li key={v.youtube_video_id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={`https://studio.youtube.com/video/${v.youtube_video_id}/analytics`} target="_blank" rel="noreferrer" className="text-sm font-medium underline-offset-2 hover:underline">
                    {v.title || v.youtube_video_id}
                  </a>
                  <span className="text-slate-500">
                    {v.isShort ? "Short" : "lange video"} · {v.published_at ? when(v.published_at) : "–"} · {dur(v.duration_s)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  <div><dt className="text-slate-500">Views</dt><dd className="tabular-nums">{n(v.views)}{v.views24h ? ` (+${n(v.views24h)} in 24 uur)` : ""}</dd></div>
                  <div><dt className="text-slate-500">Likes · reacties</dt><dd className="tabular-nums">{n(v.likes)} · {n(v.comments)}</dd></div>
                  <div><dt className="text-slate-500">Engaged views</dt><dd className="tabular-nums">{n(v.engaged_views)}{engagedShare(v) !== null ? ` (${Math.round(engagedShare(v)! * 100)}%)` : ""}</dd></div>
                  <div><dt className="text-slate-500">Nieuwe abonnees</dt><dd className="tabular-nums">{n(v.subscribers_gained)}</dd></div>
                  <div><dt className="text-slate-500">Gem. kijkduur</dt><dd className="tabular-nums">{dur(v.avg_view_duration_s)}</dd></div>
                  <div><dt className="text-slate-500">Gem. bekeken</dt><dd className="tabular-nums">{pct(v.avg_view_pct)}</dd></div>
                  <div className="col-span-2"><dt className="text-slate-500">Kijkcurve</dt><dd><Curve v={v} p={v.video_id ? view.production[v.video_id] : undefined} /></dd></div>
                </dl>
                <ReportLine report={reports.find((r) => r.youtube_video_id === v.youtube_video_id)} />
                {v.isShort && view.manual !== null && <ViewedInput studioId={studioId} v={v} manual={view.manual.find((m) => m.youtube_video_id === v.youtube_video_id)} onSaved={refresh} />}
                <p className="text-[11px] text-slate-500">Views, likes en reacties: bijna actueel ({when(v.taken_at)}). Overige: YouTube Analytics{v.analytics_until ? `, t/m ${day(v.analytics_until)}` : ", nog niet beschikbaar"}.</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

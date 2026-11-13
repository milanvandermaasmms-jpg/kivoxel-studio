"use client";

import { ExternalLink, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import type { Channel } from "@/lib/youtube/channels";
import type { Preference } from "@/lib/youtube/learning";
import { setPreference } from "@/lib/youtube/learningData";
import { defaultQueries, summarizeReference } from "@/lib/youtube/viral";
import { loadInsights, requestReference, type InsightsData } from "@/lib/youtube/viralData";
import { outcomes, whatWorks } from "@/lib/youtube/viralInsights";

const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

/**
 * Inzichten (fase 3.1 and 3.3): what works in the niche (reference videos) and what works on THIS channel (the predicted
 * Viral-score next to the real numbers after 24 hours and 7 days). Honest when there is too little data.
 */
export function ViralInsights({ studioId, channels, channel, prefs, onPrefs }: { studioId: string; channels: Channel[]; channel: string | null; prefs: Preference[]; onPrefs: () => Promise<void> }) {
  const [data, setData] = useState<InsightsData | "migration" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef("");
  const load = useCallback(async () => {
    try {
      const d = await loadInsights(studioId);
      const key = JSON.stringify(d);
      if (key !== last.current) {
        last.current = key;
        setData(d);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [studioId]);
  useEffect(() => {
    void load();
  }, [load]);
  const busy = !!data && data !== "migration" && (data.referenceJob?.status === "queued" || data.referenceJob?.status === "running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (data === null) return <div aria-busy className="h-40 animate-pulse rounded-xl bg-slate-50" />;
  if (data === "migration") return <Section title="Wat werkt bij jouw kanaal"><p className="text-sm text-slate-600">Komt er met migratie 050 (nog niet uitgevoerd).</p></Section>;

  const rows = outcomes(data.checks, data.pubs, data.snaps);
  const works = whatWorks(rows);
  const active = channels.filter((c) => c.status === "active" && (!channel || c.id === channel));

  return (
    <>
      <Section title="📈 Wat werkt bij jouw kanaal" intro="De voorspelde Viral-score naast de echte cijfers na 24 uur en 7 dagen. Hoe meer video's, hoe betrouwbaarder.">
        {works.scoreMatches && <p className="mb-2 rounded bg-violet-50 px-2 py-1 text-sm text-violet-900">{works.scoreMatches}</p>}
        {works.insights.length > 0 ? (
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
            {works.insights.map((i) => (
              <li key={i.text}>{i.text}</li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-slate-600">
            Nog te weinig gegevens om eerlijk iets te zeggen ({rows.length} {rows.length === 1 ? "video" : "video's"} met een score en cijfers; vanaf ongeveer 4 per soort worden verschillen zichtbaar). De Studio rekent dit vanzelf bij.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2 font-normal">Video</th>
                  <th className="pr-2 font-normal">Voorspeld</th>
                  <th className="pr-2 font-normal">Views na 24 u</th>
                  <th className="pr-2 font-normal">Views na 7 d</th>
                  <th className="font-normal">Gem. bekeken</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.videoId} className="border-t border-slate-100">
                    <td className="max-w-[16rem] truncate py-1 pr-2">
                      <a href={`https://youtu.be/${r.youtubeId}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        {r.title || r.youtubeId}
                      </a>
                    </td>
                    <td className="pr-2 tabular-nums">{nl(r.predicted)}</td>
                    <td className="pr-2 tabular-nums">{r.views24h ?? "nog niet"}</td>
                    <td className="pr-2 tabular-nums">{r.views7d ?? "nog niet"}</td>
                    <td className="tabular-nums">{r.avgViewPct !== null ? `${nl(r.avgViewPct)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">De klikfrequentie (CTR) geeft YouTube niet via de koppeling; die zie je alleen in YouTube Studio. Kijkduur komt pas als YouTube Analytics genoeg kijkers heeft.</p>
      </Section>

      <Section title="🔎 Wat nu goed loopt in je niche" intro="Elke week haalt de werker de best presterende recente video's op (views ten opzichte van abonnees). Kost alleen YouTube-quotum, geen geld.">
        {active.length === 0 && <p className="text-sm text-slate-500">Geen actief kanaal gekozen.</p>}
        <div className="space-y-4">
          {active.map((c) => (
            <NicheView key={c.id} studioId={studioId} channel={c} data={data} busy={busy} prefs={prefs} onPrefs={onPrefs} onAsk={async () => {
              try {
                await requestReference(studioId, c.id);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }} />
          ))}
        </div>
        {data.referenceJob?.status === "failed" && <p role="alert" className="mt-2 text-sm text-red-800">Ophalen mislukt: {data.referenceJob.error}</p>}
      </Section>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </>
  );
}

function NicheView({ studioId, channel, data, busy, prefs, onPrefs, onAsk }: { studioId: string; channel: Channel; data: InsightsData; busy: boolean; prefs: Preference[]; onPrefs: () => Promise<void>; onAsk: () => Promise<void> }) {
  const own = data.reference.filter((r) => r.channel_id === channel.id);
  const saved = prefs.find((p) => p.key === "reference_queries" && p.channel_id === channel.id)?.value;
  const queries = Array.isArray(saved) && saved.length ? (saved as string[]) : defaultQueries(channel.language);
  const [text, setText] = useState(queries.join(", "));
  const fetched = own.map((r) => r.fetched_at).sort().at(-1);
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{channel.name}</p>
        <Button variant="secondary" disabled={busy} onClick={() => void onAsk()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} {busy ? "Bezig met ophalen…" : "Nu ophalen"}
        </Button>
      </div>
      <label className="grid gap-1 text-xs">
        <span className="text-slate-500">Zoektermen (komma&apos;s ertussen, hoogstens 3)</span>
        <span className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 py-1" />
          <Button variant="ghost" disabled={text === queries.join(", ")} onClick={() => void setPreference(studioId, channel.id, "reference_queries", text.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3)).then(onPrefs)}>
            Opslaan
          </Button>
        </span>
      </label>
      {own.length === 0 ? (
        <p className="text-xs text-slate-500">Nog niet opgehaald. Dat gebeurt vanzelf één keer per week zolang YouTube gekoppeld is, of nu met de knop.</p>
      ) : (
        <>
          <p className="text-xs text-slate-500">Laatst opgehaald {fetched ? new Date(fetched).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" }) : "–"} · {own.length} video&apos;s</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["short", "long"] as const).map((kind) => {
              const s = summarizeReference(own, kind);
              return (
                <div key={kind} className="rounded-md bg-slate-50 p-2 text-xs">
                  <p className="font-medium">{kind === "short" ? "Shorts" : "Lange video's"}</p>
                  {!s ? (
                    <p className="text-slate-500">Te weinig voorbeelden.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-slate-700">
                      <li>Titels van ongeveer {s.medianTitleChars} tekens</li>
                      {s.medianDurationS !== null && <li>Meestal {Math.floor(s.medianDurationS / 60)}:{String(s.medianDurationS % 60).padStart(2, "0")} lang</li>}
                      {s.bestHours.length > 0 && <li>Vaak geplaatst rond {s.bestHours.map((h) => `${h}:00`).join(", ")} (Nederlandse tijd)</li>}
                      {s.topWords.length > 0 && <li>Veel gebruikte woorden: {s.topWords.join(", ")}</li>}
                      {s.examples.map((e) => (
                        <li key={e.title} className="truncate text-slate-500">
                          · {e.title} ({e.views.toLocaleString("nl-NL")} views)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-600">Alle referentievideo&apos;s</summary>
            <ul className="mt-1 space-y-0.5">
              {own.slice(0, 40).map((r) => (
                <li key={r.query + r.youtube_video_id} className="flex gap-2">
                  <a href={`https://youtu.be/${r.youtube_video_id}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate underline-offset-2 hover:underline">
                    {r.title} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                  </a>
                  <span className="shrink-0 text-slate-500">{r.views.toLocaleString("nl-NL")} views{r.ratio !== null ? ` · ${nl(Number(r.ratio))}× abonnees` : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

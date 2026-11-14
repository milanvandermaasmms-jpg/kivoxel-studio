"use client";
// Ivar's own weekly insights per channel: trends in the niche, lessons from Milan's choices and our numbers, and tips.
// Advice with evidence; only "Onthouden" turns a lesson into a lasting preference (ivar_memory).
import { Lightbulb, RefreshCw, Trash2, TrendingUp, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as data from "@/lib/ivar/data";

const KIND = {
  trend: { label: "Trend", icon: TrendingUp, tone: "bg-sky-50 text-sky-800" },
  learning: { label: "Geleerd", icon: GraduationCap, tone: "bg-violet-50 text-violet-800" },
  tip: { label: "Tip", icon: Lightbulb, tone: "bg-amber-50 text-amber-800" },
} as const;
const CONF = { low: "weinig data", medium: "redelijk zeker", high: "duidelijk" } as const;

export function InsightsView({ studioId, channelId, channelName, onAsk, onSeen }: { studioId: string; channelId: string | null; channelName: string | null; onAsk: (text: string) => void; onSeen: () => void }) {
  const [list, setList] = useState<data.InsightRow[] | null>(null);
  const [last, setLast] = useState<Awaited<ReturnType<typeof data.lastInsightRun>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const rows = await data.loadInsights(studioId, channelId);
      setList(rows);
      if (channelId) setLast(await data.lastInsightRun(studioId, channelId));
      const fresh = rows.filter((r) => r.status === "new").map((r) => r.id);
      if (fresh.length) {
        await data.setInsightStatus(fresh, "seen");
        onSeen();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [studioId, channelId, onSeen]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
      <p className="text-xs text-slate-600">
        Elke week kijkt Ivar zelf naar wat werkt in de niche (echte YouTube-referentievideo's), naar onze cijfers en naar wat jij met zijn voorstellen deed. Dit is advies met bewijs, geen opdracht. Alleen wat je onthoudt, wordt een vaste voorkeur.
      </p>
      {channelId ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>
            Laatste ronde voor {channelName}:{" "}
            {last ? (last.status === "done" ? `${last.finished_at ? new Date(last.finished_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : ""}${last.result?.skipped ? ` (${last.result.skipped})` : ""}` : last.status === "failed" ? `mislukt: ${last.error ?? "onbekend"}` : "bezig") : "nog niet (gebeurt wekelijks vanzelf)"}
          </span>
          <button type="button" disabled={busy || last?.status === "queued" || last?.status === "running"} onClick={() => void act(() => data.queueInsights(studioId, channelId), "Ivar gaat zoeken; de inzichten verschijnen hier binnen een minuut.")} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Nu vernieuwen (± € 0,02)
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Kies bovenin een kanaal om alleen de inzichten van dat kanaal te zien.</p>
      )}
      {note && <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{note}</p>}
      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
      {list === null ? (
        <p className="mt-3 text-slate-500">Laden…</p>
      ) : !list.length ? (
        <p className="mt-3 text-slate-500">Nog geen inzichten. De eerste wekelijkse ronde start vanzelf zodra de werker draait en betaalde verwerking aan staat.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((i) => {
            const k = KIND[i.kind];
            const Icon = k.icon;
            return (
              <li key={i.id} className={`rounded-lg border p-2.5 ${i.status === "accepted" ? "border-emerald-200" : "border-slate-200"}`}>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${k.tone}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {k.label}
                  </span>
                  <span className="text-slate-500">
                    {i.week} · {CONF[i.confidence]}
                    {i.status === "accepted" ? " · omarmd" : ""}
                  </span>
                </div>
                <p className="mt-1 font-medium text-slate-900">{i.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{i.body}</p>
                {i.suggestion && <p className="mt-1 rounded bg-slate-50 p-1.5 text-xs text-slate-700">→ {i.suggestion}</p>}
                <details className="mt-1 text-xs text-slate-500">
                  <summary className="cursor-pointer">Bewijs ({i.evidence.length})</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {i.evidence.map((e, n) => (
                      <li key={n}>{e}</li>
                    ))}
                  </ul>
                </details>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {i.kind === "learning" && i.status !== "accepted" && (
                    <button type="button" disabled={busy} onClick={() => void act(async () => (await data.addMemory(studioId, (i.suggestion ?? i.title).slice(0, 500), { channelId: i.channel_id }), await data.setInsightStatus([i.id], "accepted")), "Onthouden als voorkeur voor dit kanaal.")} className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                      Onthouden
                    </button>
                  )}
                  {i.kind !== "learning" && (
                    <button type="button" disabled={busy} onClick={() => (void data.setInsightStatus([i.id], "accepted"), onAsk(`Werk dit inzicht uit tot één concreet videoconcept voor ${channelName ?? "dit kanaal"} en sla het op als idee: "${i.title}". ${i.suggestion ?? ""}`))} className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
                      Maak er een idee van
                    </button>
                  )}
                  {i.status !== "accepted" && (
                    <button type="button" disabled={busy} onClick={() => void act(() => data.setInsightStatus([i.id], "dismissed"))} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                      Niet nuttig
                    </button>
                  )}
                  <button type="button" aria-label="Inzicht verwijderen" disabled={busy} onClick={() => void act(() => data.deleteInsight(i.id))} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

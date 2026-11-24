"use client";

// 24-11-2026 (opdracht 4): what Ivar learned from Milan's own decisions, with the evidence, whether it is applied by
// itself (only safe changes) or only a proposal, how often it was used in a production, and the version history.
// Milan switches any lesson off or on again; that choice survives every rebuild.

import { useCallback, useEffect, useState } from "react";
import { Fold } from "@/components/settings/Section";
import { WORKER_URL } from "@/lib/youtube/protocol";
import type { Lesson } from "@/lib/ivar/learningCycle";

type LessonFile = { version: number; builtAt: string | null; lessons: Lesson[]; off: string[]; history: { version: number; at: string; changes: string[] }[]; applied: Record<string, number> };

const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function LessonsPanel({ workerOnline, channels }: { workerOnline: boolean; channels: { id: string; name: string }[] }) {
  const [data, setData] = useState<LessonFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${WORKER_URL}/lessons`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Werker gaf ${r.status}`);
      setData((await r.json()) as LessonFile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (workerOnline) void load();
  }, [workerOnline, load]);
  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(`${WORKER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Werker gaf ${r.status}`);
      setData((await r.json()) as LessonFile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const chan = (id: string | null) => (id ? (channels.find((c) => c.id === id)?.name ?? "Kanaal") : "Alle kanalen");
  const active = (data?.lessons ?? []).filter((l) => l.status === "actief" && !data!.off.includes(l.id)).length;
  return (
    <Fold id="library.lessons" title="Wat Ivar leerde" intro={data ? `${active} les(sen) actief, ${(data.lessons.length - active)} voorstel of uit · versie ${data.version}` : "Lessen uit jouw keuzes, afkeuringen en audio."}>
      <p className="text-xs text-slate-600">Ivar leert van wat jij afkeurt, goedkeurt, opnieuw laat monteren en aan audio kiest; de kijkcijfers per soort moment wegen al mee bij het kiezen van Shorts. Alleen veilige verbeteringen past hij zelf toe (welke soort momenten een Short worden, iets langere uitkomst, je vaste audiokeuze). De rest is een voorstel. Elke les kun je uitzetten.</p>
      {!workerOnline ? (
        <p className="text-sm text-slate-500">Start de werker op de pc om de lessen te zien.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void post("/lessons/run")} className="min-h-9 rounded-full border border-slate-300 bg-surface px-3 text-xs text-slate-700 disabled:opacity-50">
              {busy ? "Bezig…" : "Nu opnieuw leren"}
            </button>
            {data?.builtAt && <span className="text-xs text-slate-500">Laatst bijgewerkt {when(data.builtAt)}</span>}
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {data && !data.lessons.length && <p className="text-sm text-slate-600">Nog geen lessen: daarvoor zijn minstens 2-3 dezelfde keuzes van jou nodig.</p>}
          <ul className="divide-y divide-slate-100">
            {(data?.lessons ?? []).map((l) => {
              const off = data!.off.includes(l.id);
              const state = off ? "uit" : l.status === "actief" ? "actief" : "voorstel";
              return (
                <li key={l.id} className="space-y-1 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 font-medium">{l.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${state === "actief" ? "bg-emerald-100 text-emerald-800" : state === "uit" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-900"}`}>{state}</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {chan(l.channelId)} · {l.evidence.join(" · ")}
                    {data!.applied[l.id] ? ` · ${data!.applied[l.id]}× toegepast in een productie` : ""}
                  </p>
                  {l.status === "actief" && (
                    <button type="button" disabled={busy} onClick={() => void post("/lessons/toggle", { id: l.id, off: !off })} className="text-xs underline underline-offset-2 disabled:opacity-50">
                      {off ? "Weer aanzetten" : "Uitzetten"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {data?.history.length ? (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Versies ({data.history.length})</summary>
              <ul className="mt-1 space-y-1">
                {data.history.map((h) => (
                  <li key={`${h.version}-${h.at}`}>
                    <span className="font-medium">v{h.version}</span> · {when(h.at)}: {h.changes.join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Fold>
  );
}

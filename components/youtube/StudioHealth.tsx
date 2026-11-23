"use client";

// 23-11-2026 (Milan, superprompt V6, fase 28 en 34.4): Studio-gezondheid. What Ivar's first aid on the pc sees right now
// (stuck or failed steps, disk, budget, YouTube, the upload line, productions below 8.0), what it repaired itself and
// whether that worked, and what waits for Milan. Only real data from the worker; without the worker: "onbekend".

import { useCallback, useEffect, useState } from "react";
import type { Incident } from "@/lib/kivoxel/incidents";
import { WORKER_URL } from "@/lib/youtube/protocol";

export type HealthState = { checkedAt: string | null; health: { status: "operationeel" | "aandacht" | "storing"; text: string }; incidents: Incident[] };
const TONE = { operationeel: "border-emerald-200 bg-emerald-50 text-emerald-900", aandacht: "border-amber-300 bg-amber-50 text-amber-900", storing: "border-red-300 bg-red-50 text-red-900" } as const;
const SEV = { storing: "bg-red-600", waarschuwing: "bg-amber-500", info: "bg-slate-400" } as const;
const time = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Reads /incidents every minute while the page is visible. */
export function useStudioHealth(workerOnline: boolean): HealthState | null {
  const [state, setState] = useState<HealthState | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${WORKER_URL}/incidents`);
      if (r.ok) setState((await r.json()) as HealthState);
    } catch {
      setState(null);
    }
  }, []);
  useEffect(() => {
    if (!workerOnline) return;
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(id);
  }, [workerOnline, load]);
  return workerOnline ? state : null;
}

export function IncidentList({ incidents, compact = false }: { incidents: Incident[]; compact?: boolean }) {
  const open = incidents.filter((i) => !i.resolvedAt);
  const closed = incidents.filter((i) => i.resolvedAt).slice(0, compact ? 3 : 10);
  return (
    <div className="space-y-2 text-xs">
      {!open.length && <p className="text-slate-600">Geen open meldingen.</p>}
      <ul className="space-y-1.5">
        {open.map((i) => (
          <li key={i.id} className="rounded-md border border-slate-200 bg-surface p-2">
            <p className="flex items-start gap-2 font-medium text-slate-900">
              <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEV[i.severity]}`} />
              <span>
                {i.title} <span className="font-normal text-slate-500">({i.domain === "kwaliteit" ? "kwaliteit" : i.severity}, sinds {time(i.firstSeen)})</span>
              </span>
            </p>
            <p className="mt-0.5 text-slate-700">Oorzaak: {i.cause}</p>
            {i.done ? (
              <p className="mt-0.5 text-emerald-800">Ivar deed: {i.done.what} ({time(i.done.at)}){i.done.verified === null ? " — wordt bij de volgende ronde gecontroleerd" : ""}</p>
            ) : i.action ? (
              <p className="mt-0.5 text-slate-600">{i.action.auto ? "Ivar herstelt dit zelf: " : i.action.level === 3 ? "Jouw beslissing: " : "Voorstel: "}{i.action.what}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-600">Opgelost ({closed.length})</summary>
          <ul className="mt-1 space-y-1">
            {closed.map((i) => (
              <li key={i.id + i.resolvedAt} className="text-slate-600">
                ✓ {i.title} — {i.resolution} ({time(i.resolvedAt!)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function StudioHealth({ workerOnline }: { workerOnline: boolean }) {
  const state = useStudioHealth(workerOnline);
  if (!workerOnline) return <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Studio-gezondheid: onbekend, de werker op de pc antwoordt niet.</section>;
  if (!state) return null;
  return (
    <section aria-label="Studio-gezondheid" className={`space-y-2 rounded-xl border p-3 text-sm ${TONE[state.health.status]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Studio-gezondheid: {state.health.status}</h2>
        {state.checkedAt && <span className="text-xs opacity-80">Laatste controle door Ivar: {time(state.checkedAt)}</span>}
      </div>
      <p>{state.health.text}</p>
      {state.incidents.length > 0 && <IncidentList incidents={state.incidents} />}
    </section>
  );
}

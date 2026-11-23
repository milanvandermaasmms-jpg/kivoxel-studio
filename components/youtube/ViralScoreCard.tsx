"use client";

// 23-11-2026 (superprompt V6, fase 30 en 33): the Viral Quality Score in the review. Total and status at the top (with
// the reason when it is blocked or below 8.0), then every part with its score, its source and the evidence. Parts the
// pc cannot measure get Milan's own 0-10; the measured parts can be overruled by him too (marked "Milan").

import { useState } from "react";
import { MINIMUM, type PartKey, type ViralResult } from "@/lib/kivoxel/viralScore";

const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1).replace(".", ","));
const TONE: Record<ViralResult["status"], string> = { publicatiegereed: "border-emerald-300 bg-emerald-50 text-emerald-900", "oordeel nodig": "border-amber-300 bg-amber-50 text-amber-900", "onder 8,0": "border-red-300 bg-red-50 text-red-900", geblokkeerd: "border-red-400 bg-red-100 text-red-950" };
const STEPS = [4, 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export function ViralScoreCard({ result, onJudge }: { result: ViralResult; onJudge?: (part: PartKey, score: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Viralscore" className={`space-y-2 rounded-md border p-3 text-sm ${TONE[result.status]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          Viralscore {fmt(result.total)} <span className="font-normal">/ 10 · minimum {fmt(MINIMUM)}</span>
        </p>
        <span className="rounded bg-white/70 px-2 py-0.5 text-xs font-medium">{result.status}</span>
      </div>
      <p>{result.summary}</p>
      {result.blocks.length > 0 && (
        <ul className="list-disc pl-5 text-xs">
          {result.blocks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {result.weakest.length > 0 && result.status !== "geblokkeerd" && (
        <p className="text-xs">
          Verbeteren: {result.weakest.slice(0, 3).map((w) => `${w.label} (${fmt(w.score)}): ${w.fix}`).join(" · ")}
        </p>
      )}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs underline underline-offset-2">
        {open ? "Onderdelen verbergen" : "Alle onderdelen en bewijs"}
      </button>
      {open && (
        <ul className="space-y-1.5 text-xs">
          {result.parts.map((p) => (
            <li key={p.key} className="rounded bg-white/60 p-2 text-slate-800">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{p.label}</span>
                <span className="text-slate-500">({Math.round(p.weight * 100)}%)</span>
                <span className={`ml-auto font-semibold tabular-nums ${p.score === null ? "text-slate-400" : p.score >= MINIMUM ? "text-emerald-700" : "text-red-700"}`}>{fmt(p.score)}</span>
                <span className="text-slate-500">{p.source ?? "oordeel nodig"}</span>
              </div>
              <p className="text-slate-600">{p.evidence.join(" · ")}</p>
              {onJudge && (
                <label className="mt-1 flex items-center gap-2">
                  <span>Jouw oordeel:</span>
                  <select className="rounded border border-slate-300 bg-surface px-1 py-0.5" value="" onChange={(e) => e.target.value && onJudge(p.key, Number(e.target.value))}>
                    <option value="">{p.source === "Milan" ? `${fmt(p.score)} (wijzigen)` : "kies"}</option>
                    {STEPS.map((n) => (
                      <option key={n} value={n}>
                        {fmt(n)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] opacity-80">Een interne inschatting, geen belofte van weergaven. Gemeten = door de pc in de export; inschatting = regel over gemeten feiten; AI = oordeel van Gemini over de video (alleen waar niets anders was); Milan = jouw oordeel, dat altijd voorgaat.</p>
    </section>
  );
}

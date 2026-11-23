"use client";

import { useEffect, useState } from "react";
import type { EditorReport } from "@/lib/kivoxel/editorReview";
import type { GateResult } from "@/lib/kivoxel/producerGate";
import type { BriefCheck } from "@/lib/kivoxel/briefing";
import { WORKER_URL } from "@/lib/youtube/protocol";

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const TONE: Record<string, string> = { "Klaar voor Milan": "border-emerald-200 bg-emerald-50 text-emerald-900", "Correctie nodig": "border-red-200 bg-red-50 text-red-900", "Handmatige controle nodig": "border-amber-200 bg-amber-50 text-amber-900" };

/**
 * Eindredacteur in the review (23-11-2026): his status for this version, the main finding and one improvement, what he
 * saw blind in the export, every finding with a button to that moment, and why this version has (no) voice-over and
 * what the producer gate said about the moment.
 */
export function EditorPanel({ editor, voicePlan, producer, onJump, briefing, onWaive }: { editor: EditorReport | null | undefined; voicePlan?: { voice: boolean; reason: string } | null; producer?: GateResult | null; onJump: (ms: number) => void; /** 23-11-2026: did this version follow the upload briefing? */ briefing?: { checks: BriefCheck[]; verdict: { ok: boolean; text: string } } | null; onWaive?: (key: string) => void }) {
  if (!editor && !voicePlan && !producer && !briefing) return null;
  return (
    <section aria-label="Eindredacteur" className="space-y-2 text-sm">
      {editor && (
        <div className={`space-y-1 rounded-md border p-3 ${TONE[editor.status] ?? ""}`}>
          <p className="font-semibold">Eindredacteur: {editor.status}</p>
          <p>{editor.main}</p>
          {editor.blind.length > 0 && <p className="text-xs opacity-80">Blind gezien in de export: {editor.blind.join(" ")}</p>}
          {editor.findings.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {editor.findings.map((f, k) => (
                <li key={k} className="flex gap-2">
                  <button type="button" onClick={() => onJump(f.atMs)} className="shrink-0 tabular-nums underline underline-offset-2">
                    ▶ {clock(f.atMs)}
                  </button>
                  <span>
                    <span className="font-medium">{f.severity === "blokkeert" ? "Blokkeert" : f.severity === "controle" ? "Controle" : "Verbeteren"}:</span> {f.text}
                    {f.fix ? ` → ${f.fix}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {briefing && briefing.checks.length > 0 && (
        <div className={`space-y-1 rounded-md border p-3 ${briefing.verdict.ok ? "border-slate-200" : "border-red-200 bg-red-50 text-red-900"}`}>
          <p className="font-semibold">Briefing: {briefing.verdict.ok ? "gevolgd" : "niet gevolgd"}</p>
          <ul className="space-y-1 text-xs">
            {briefing.checks.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{c.status === "ok" ? "✓" : c.status === "niet" ? "✗" : c.status === "vervallen" ? "–" : "?"} {c.instruction}</span>
                <span className="opacity-80">{c.why}</span>
                {c.status === "niet" && onWaive && (
                  <button type="button" onClick={() => onWaive(c.key)} className="underline underline-offset-2">
                    Laat vervallen
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(voicePlan || producer) && (
        <div className="space-y-0.5 rounded-md border border-slate-200 p-3 text-xs text-slate-700">
          {voicePlan && <p>Stem: {voicePlan.voice ? "met Engelse voice-over" : "zonder voice-over"} — {voicePlan.reason}</p>}
          {producer && (
            <p>
              Producer: {producer.status} — {producer.summary}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

type Row = { channelId: string; format: "short" | "long"; planned: { voice: number; total: number }; delivered: { voice: number; total: number }; openInGroup: number; groupHasVoice: boolean };

/** Stemverdeling per kanaal and format: planned and really delivered, against 1 of 3 Shorts and 1 of 5 long videos. */
export function VoiceSplit({ channels, workerOnline }: { channels: { id: string; name: string }[]; workerOnline: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!workerOnline) return;
    void fetch(`${WORKER_URL}/voice-plan`).then((r) => (r.ok ? (r.json() as Promise<Row[]>) : null)).then(setRows).catch(() => setRows(null));
  }, [workerOnline]);
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-surface p-4 text-sm">
      <h2 className="font-semibold">Stemverdeling</h2>
      <p className="text-xs text-slate-600">Afspraak: 1 van iedere 3 Shorts en 1 van iedere 5 lange video&apos;s met Engelse voice-over, per kanaal. Telt per productie (een nieuwe versie telt niet opnieuw); een gearchiveerde productie geeft haar plek terug.</p>
      {!rows?.length ? (
        <p className="text-slate-500">{workerOnline ? "Nog geen producties volgens de stemverdeling." : "Start de werker op de pc."}</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1">Kanaal</th>
              <th>Format</th>
              <th>Gepland met stem</th>
              <th>Opgeleverd met stem</th>
              <th>Groep</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.channelId}:${r.format}`} className="border-t border-slate-200">
                <td className="py-1">{channels.find((c) => c.id === r.channelId)?.name ?? "Kanaal"}</td>
                <td>{r.format === "short" ? "Shorts (1 op 3)" : "Lang (1 op 5)"}</td>
                <td>{r.planned.voice} van {r.planned.total}</td>
                <td>{r.delivered.voice} van {r.delivered.total}</td>
                <td>{r.openInGroup ? `${r.openInGroup} plek(ken) open${r.groupHasVoice ? ", stem al gekozen" : ", stem nog open"}` : "groep vol"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

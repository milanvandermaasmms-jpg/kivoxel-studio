"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Dialog";
import type { Dossier } from "@/lib/kivoxel/producerDossier";
import { dossierText } from "@/lib/kivoxel/producerDossier";
import type { Candidate } from "@/lib/kivoxel/producerGate";

const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const TONE: Record<string, string> = { "GROEN LICHT": "text-emerald-800", PROEFOPNAME: "text-amber-800", AFGEKEURD: "text-red-800" };

/** The producer dossier of one production (23-11-2026), folded; "Kopieer" gives it as plain text for the team. */
export function ProducerDossierView({ dossier, title, onJump }: { dossier: Dossier; title: string; onJump: (ms: number) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="rounded-md border border-slate-200 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Producerdossier · <span className={TONE[dossier.status] ?? ""}>{dossier.status}</span>
      </summary>
      <div className="mt-2 space-y-3">
        <p>{dossier.reason}</p>
        <p><span className="font-medium">Kijkbelofte:</span> {dossier.promise}</p>
        <p><span className="font-medium">Beslissend eindbeeld:</span> {dossier.endImage}</p>
        <div>
          <p className="font-medium">Openingen</p>
          <ul className="text-xs">{dossier.openings.map((o) => <li key={o.label}>{o.chosen ? "✓ " : "· "}{o.label}: &ldquo;{o.firstLine}&rdquo; — {o.firstImage}{o.why ? ` — ${o.why}` : ""}</li>)}</ul>
        </div>
        {dossier.packaging.length > 0 && (
          <div>
            <p className="font-medium">Titel en thumbnail</p>
            <ul className="text-xs">{dossier.packaging.map((p, k) => <li key={k}>{p.chosen ? "✓ " : "· "}{p.title} — {p.thumbnail}</li>)}</ul>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead><tr className="text-slate-500"><th>Tijd</th><th>Shot</th><th>Beeld</th><th>VO</th><th>Tekst</th><th>Geluid</th><th>Knip</th></tr></thead>
            <tbody>
              {dossier.shots.map((s) => (
                <tr key={s.id} className="border-t border-slate-200 align-top">
                  <td className="py-1"><button type="button" className="tabular-nums underline" onClick={() => onJump(s.startMs)}>{clock(s.startMs)}–{clock(s.endMs)}</button></td>
                  <td>{s.id}{s.essential ? " *" : ""}</td><td>{s.image}</td><td>{s.vo}</td><td>{s.text}</td><td>{s.sound}</td><td>{s.cut}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500">* essentieel voor de belofte · tijden volgens het montageplan; in de export kan alles tot 1,5 s later vallen door de cold open (de ondertitels hebben de echte tijden)</p>
        </div>
        {dossier.voText.length > 0 && (
          <div>
            <p className="font-medium">Voice-over ({dossier.speakingSeconds} s gesproken)</p>
            <ul className="text-xs">{dossier.voText.map((v, k) => <li key={k}>{clock(v.atMs)} ({v.seconds} s) {v.text}</li>)}{dossier.silences.map((s, k) => <li key={`s${k}`} className="text-slate-500">stilte {clock(s.startMs)}–{clock(s.endMs)}</li>)}</ul>
          </div>
        )}
        <div>
          <p className="font-medium">Risico op wegvegen</p>
          <ul className="text-xs">{dossier.risks.map((r, k) => <li key={k}><button type="button" className="underline" onClick={() => onJump(r.atMs)}>{clock(r.atMs)}</button>: {r.risk} → {r.solution}</li>)}</ul>
        </div>
        {dossier.lessons.length > 0 && <div><p className="font-medium">Lessen uit jouw afkeuringen</p><ul className="list-disc pl-5 text-xs">{dossier.lessons.map((e, k) => <li key={k}>{e}</li>)}</ul></div>}
        <div><p className="font-medium">Editor</p><ul className="list-disc pl-5 text-xs">{dossier.editor.map((e, k) => <li key={k}>{e}</li>)}</ul></div>
        <div><p className="font-medium">Kijkproef</p><ul className="list-disc pl-5 text-xs">{dossier.viewingTest.map((e, k) => <li key={k}>{e}</li>)}</ul></div>
        <div><p className="font-medium">Variant</p><p className="text-xs">{dossier.variant.hypothesis}</p><p className="text-xs">{dossier.variant.a} · {dossier.variant.b}</p><p className="text-xs text-slate-500">{dossier.variant.compare}</p></div>
        <div><p className="font-medium">Meetplan</p><ul className="list-disc pl-5 text-xs">{dossier.measure.map((e, k) => <li key={k}>{e}</li>)}</ul></div>
        <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(dossierText(dossier, title)).then(() => setCopied(true))}>
          <Copy className="h-4 w-4" aria-hidden /> {copied ? "Gekopieerd" : "Kopieer dossier"}
        </Button>
      </div>
    </details>
  );
}

/** Viral check before the montage: the ranked candidate moments of the latest analyses. */
export function CandidateList({ items }: { items: { label: string; at: string; enough: boolean; candidates: Candidate[] }[] }) {
  if (!items.length) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Kandidaatfragmenten (producer-poort vóór de montage)</summary>
      <div className="mt-2 space-y-3">
        {items.map((r) => (
          <div key={r.label + r.at}>
            <p className="font-medium">{r.label} <span className="text-xs font-normal text-slate-500">{r.enough ? "" : "· onvoldoende basis voor een goede Short"}</span></p>
            <ol className="text-xs">
              {r.candidates.map((c) => (
                <li key={c.rank} className="py-0.5">
                  {c.rank}. <span className={TONE[c.status]}>{c.status}</span> · {clock(c.startMs)}–{clock(c.endMs)} (piek {clock(c.peakMs)}) · {c.type ?? "?"} · {c.description.slice(0, 90)} — <span className="text-slate-500">{c.why}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}

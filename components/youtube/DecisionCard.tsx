"use client";

// 23-11-2026 (Milan: "onoverzichtelijk, maak het gebruiksvriendelijk"): one decision block at the top of the review.
// The score at a glance, what Milan must do (blocks and points to look at, with a jump to the time), and how much is
// fine. Every detail (all score parts, the AI judgement, the editor, the briefing, the dossier) stays one click away.

import type { EditorReport } from "@/lib/kivoxel/editorReview";
import type { BriefCheck } from "@/lib/kivoxel/briefing";
import type { ViralResult } from "@/lib/kivoxel/viralScore";

type Todo = { tone: "rood" | "oranje" | "paars"; text: string; atMs?: number };
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
const fmt = (n: number) => n.toFixed(1).replace(".", ",");

export function decisionTodos(viral: ViralResult | null, editor: EditorReport | null, briefing: BriefCheck[]): { todos: Todo[]; ok: number } {
  const todos: Todo[] = [];
  for (const b of viral?.blocks ?? []) todos.push({ tone: "rood", text: b.replace(/^Eindredacteur: /, "") });
  for (const f of editor?.findings ?? []) {
    if (f.kind === "briefing") continue;
    if (f.severity === "blokkeert" && viral?.blocks.some((b) => b.includes(f.text))) continue;
    if (f.severity !== "verbeteren") todos.push({ tone: f.severity === "blokkeert" ? "rood" : "oranje", text: f.text, atMs: f.atMs });
  }
  for (const c of briefing) if (c.status === "niet") todos.push({ tone: "rood", text: `Briefing: ${c.instruction}. ${c.why}` });
  for (const p of viral?.parts ?? []) if (p.score === null) todos.push({ tone: "paars", text: `Geef zelf een cijfer voor "${p.label}" (onder Details)` });
  for (const p of viral?.parts ?? []) if (p.source === "AI") todos.push({ tone: "paars", text: `"${p.label}" is door de AI beoordeeld (${fmt(p.score!)}); ben je het eens?` });
  for (const c of briefing) if (c.status === "onbekend") todos.push({ tone: "paars", text: `Kijk zelf: ${c.instruction}` });
  const ok = (viral?.parts.filter((p) => p.score !== null && p.score >= 8 && p.source !== "AI").length ?? 0) + briefing.filter((c) => c.status === "ok").length;
  return { todos, ok };
}

const TONE = { rood: "border-l-red-500", oranje: "border-l-amber-500", paars: "border-l-violet-500" } as const;

export function DecisionCard({ viral, editor, briefing, onJump }: { viral: ViralResult | null; editor: EditorReport | null; briefing: BriefCheck[]; onJump: (ms: number) => void }) {
  const { todos, ok } = decisionTodos(viral, editor, briefing);
  const blocked = todos.some((t) => t.tone === "rood");
  const verdict = !viral ? "Nog geen viralscore (oudere versie)" : blocked ? "Eerst iets oplossen" : viral.status === "onder 8,0" ? "Onder de 8,0" : todos.length ? "Bijna klaar: jouw blik nodig" : "Klaar om goed te keuren";
  const chip = blocked ? "bg-red-600 text-white" : viral?.status === "onder 8,0" ? "bg-amber-500 text-white" : todos.length ? "bg-violet-600 text-white" : "bg-emerald-600 text-white";
  return (
    <section aria-label="Beslissing" className="space-y-3 rounded-xl border border-slate-200 bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-4">
        <div className="text-center">
          <p className="text-4xl font-bold tabular-nums leading-none text-slate-900">{viral?.total !== null && viral?.total !== undefined ? fmt(viral.total) : "—"}</p>
          <p className="mt-1 text-[11px] text-slate-500">van 10 · min. 8,0</p>
        </div>
        <div className="min-w-0">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip}`}>{verdict}</span>
          <p className="mt-1 text-xs text-slate-600">{todos.length ? `${todos.length} punt${todos.length === 1 ? "" : "en"} voor jou` : "Niets voor jou te doen"}{ok ? ` · ${ok} in orde` : ""}</p>
        </div>
      </div>
      {todos.length > 0 && (
        <ul className="space-y-1.5">
          {todos.slice(0, 6).map((t, i) => (
            <li key={i} className={`flex items-start gap-2 rounded-md border border-slate-200 border-l-4 ${TONE[t.tone]} bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800`}>
              {typeof t.atMs === "number" && (
                <button type="button" onClick={() => onJump(t.atMs!)} className="shrink-0 rounded bg-slate-200 px-1.5 text-xs font-medium tabular-nums text-slate-800 hover:bg-slate-300">
                  ▶ {clock(t.atMs)}
                </button>
              )}
              <span>{t.text}</span>
            </li>
          ))}
          {todos.length > 6 && <li className="text-xs text-slate-500">En nog {todos.length - 6} (onder Details).</li>}
        </ul>
      )}
    </section>
  );
}

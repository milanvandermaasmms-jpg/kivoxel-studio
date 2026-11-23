"use client";

// 23-11-2026 (Milan, superprompt V5, fase 4-6): the content register in the Studio. Every production of the gaming
// channels with its five measured scores, the total, an action and why, filterable. Built on the pc (no AI, no costs).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Fold } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { NORM, SCORE_LABEL, STAGES, type Action, type Entry, type Register, type ScoreKey, type Stage } from "@/lib/kivoxel/contentRegister";
import { WORKER_URL } from "@/lib/youtube/protocol";

type State = (Register & { running?: { done: number; total: number } | null }) | { entries: []; builtAt: null; running?: { done: number; total: number } | null };
const ACTIONS: Action[] = ["opnieuw maken", "verbeteren", "behouden", "niet beoordeeld", "afgekeurd (archief)", "live (alleen info)"];
const TONE: Record<Action, string> = { "opnieuw maken": "bg-red-100 text-red-900", verbeteren: "bg-amber-100 text-amber-900", behouden: "bg-emerald-100 text-emerald-900", "niet beoordeeld": "bg-slate-100 text-slate-700", "live (alleen info)": "bg-sky-100 text-sky-900", "afgekeurd (archief)": "bg-slate-200 text-slate-700" };
const KEYS: ScoreKey[] = ["script", "montage", "audio", "beeld", "techniek"];
const scoreTone = (v: number | null) => (v === null ? "text-slate-400" : v >= NORM.keep ? "text-emerald-700" : v >= NORM.remake ? "text-amber-700" : "text-red-700");
const STATUS: Record<string, string> = { idea: "Idee", scripted: "Script", rendering: "In montage", review: "Te keuren", approved: "Klaar", scheduled: "Ingepland", published: "Live", failed: "Mislukt", archived: "Afgekeurd" };

export function ContentRegister({ workerOnline, channelName, onOpen }: { workerOnline: boolean; /** Only this channel; null = all. */ channelName: string | null; onOpen?: (videoId: string) => void }) {
  const [reg, setReg] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | "alle">("alle");
  const [type, setType] = useState<"alle" | "Short" | "Lang">("alle");
  const [stage, setStage] = useState<Stage | "alle">("alle");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${WORKER_URL}/register`);
      if (!r.ok) throw new Error(`Werker antwoordde ${r.status}`);
      setReg((await r.json()) as State);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (!workerOnline) return;
    void load();
  }, [workerOnline, load]);
  // While the pc builds a new register: follow the progress.
  useEffect(() => {
    if (!reg?.running) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [reg, load]);

  const run = async () => {
    const r = await fetch(`${WORKER_URL}/register/run`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return setError("De werker kon het register niet starten");
    setTimeout(() => void load(), 1000);
  };

  const entries = useMemo(() => (reg?.entries ?? []).filter((e) => (!channelName || e.channel === channelName) && (action === "alle" || e.action === action) && (type === "alle" || e.type === type) && (stage === "alle" || e.stage === stage)), [reg, channelName, action, type, stage]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<Action, number>;
    for (const e of reg?.entries ?? []) if (!channelName || e.channel === channelName) c[e.action] += 1;
    return c;
  }, [reg, channelName]);

  return (
    <Fold id="production.register" title="Contentregister" intro={reg?.builtAt ? `${(reg.entries ?? []).filter((e) => !channelName || e.channel === channelName).length} producties beoordeeld · ${new Date(reg.builtAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}` : "Elke video en Short opnieuw beoordeeld, uit metingen op de pc."}>
      <p className="text-xs text-slate-600">
        Scores (0–100) komen alleen uit wat de pc in het exportbestand meet (zwart of bevroren beeld, stiltes, vervorming, beweging, uitkomst na het hoogtepunt, hoeveel gameplay en hoeveel menu) en uit wat bij de productie is opgeslagen (script, controles, jouw afkeurreden). Geen AI, geen kosten. Wat niet te meten is, staat als “niet beoordeeld”. Norm: vanaf {NORM.keep} behouden, onder {NORM.remake} opnieuw maken. Live video&apos;s worden nooit aangeraakt.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!workerOnline || !!reg?.running} onClick={() => void run()}>
          {reg?.running ? `Bezig: ${reg.running.done} van ${reg.running.total || "…"}` : reg?.builtAt ? "Opnieuw beoordelen" : "Register opbouwen"}
        </Button>
        {!workerOnline && <span className="text-xs text-amber-800">Start de werker op de pc.</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
      {!!reg?.entries?.length && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter op actie">
            {(["alle", ...ACTIONS] as const).map((a) => (
              <button key={a} type="button" aria-pressed={action === a} onClick={() => setAction(a)} className={`min-h-9 rounded-full border px-3 text-xs ${action === a ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-surface text-slate-700"}`}>
                {a === "alle" ? "Alle" : `${a} (${counts[a]})`}
              </button>
            ))}
            <select aria-label="Controle" className="min-h-9 rounded-md border border-slate-300 bg-surface px-2 text-xs" value={stage} onChange={(e) => setStage(e.target.value as Stage | "alle")}>
              <option value="alle">Elke controle</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s} ({(reg?.entries ?? []).filter((e) => (!channelName || e.channel === channelName) && e.stage === s).length})
                </option>
              ))}
            </select>
            <select aria-label="Type" className="min-h-9 rounded-md border border-slate-300 bg-surface px-2 text-xs" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="alle">Shorts en lang</option>
              <option value="Short">Alleen Shorts</option>
              <option value="Lang">Alleen lange video&apos;s</option>
            </select>
          </div>
          <ul className="divide-y divide-slate-100">
            {entries.map((e) => (
              <RegisterRow key={e.videoId} e={e} open={open === e.videoId} onToggle={() => setOpen(open === e.videoId ? null : e.videoId)} onOpen={onOpen} />
            ))}
          </ul>
          {!entries.length && <p className="text-sm text-slate-500">Geen producties met dit filter.</p>}
        </>
      )}
    </Fold>
  );
}

function RegisterRow({ e, open, onToggle, onOpen }: { e: Entry; open: boolean; onToggle: () => void; onOpen?: (videoId: string) => void }) {
  return (
    <li className="py-2">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[e.action]}`}>{e.action}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
        <span className="text-xs text-slate-500">
          {e.channel} · {e.type} · {STATUS[e.status] ?? e.status}
        </span>
        <span className={`w-10 text-right text-sm font-semibold tabular-nums ${scoreTone(e.total)}`}>{e.total ?? "—"}</span>
      </button>
      <p className="mt-0.5 text-xs text-slate-600">{e.why}</p>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-3 text-xs">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {KEYS.map((k) => (
              <div key={k}>
                <dt className="text-slate-500">{SCORE_LABEL[k]}</dt>
                <dd className={`text-base font-semibold tabular-nums ${scoreTone(e.scores[k].value)}`}>{e.scores[k].value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-0.5">
            {KEYS.map((k) => (
              <li key={k}>
                <span className="font-medium">{SCORE_LABEL[k]}:</span> {e.scores[k].reasons.join("; ")}
              </li>
            ))}
          </ul>
          <p className="text-slate-600">
            Bronmateriaal: {e.source} · Stand: {e.stage ?? "—"} · Controle: {e.control}
            {e.avgViewPct !== null ? ` · YouTube: ${Math.round(e.avgViewPct)}% bekeken, ${e.views ?? 0} weergaven` : ""}
          </p>
          {onOpen && e.status === "review" && (
            <button type="button" onClick={() => onOpen(e.videoId)} className="underline underline-offset-2">
              Openen in de keuring
            </button>
          )}
        </div>
      )}
    </li>
  );
}

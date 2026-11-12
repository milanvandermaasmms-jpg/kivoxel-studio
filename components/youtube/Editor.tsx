"use client";

import { ArrowLeft, ArrowRight, Redo2, Scissors, Trash2, Undo2, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { formatTimecode, type Segment } from "@/lib/youtube/analysis";
import { saveEditedScript, type DbScript } from "@/lib/youtube/analysisData";
import { addLine, commit, editorProblems, moveSegment, redo, relayout, removeLine, removeSegment, setLine, setSegmentText, setSpeed, splitSegment, startHistory, toggleZoom, totalMs, trimSegment, undo, ZOOM, type EditorState, type History } from "@/lib/youtube/editor";
import { applyHook, parseHooks } from "@/lib/youtube/hooks";

const PART: Record<string, string> = { hook: "Hook", build: "Opbouw", payoff: "Afloop", teaser: "Teaser", search: "Zoeken", discovery: "Ontdekking", aftermath: "Daarna", cold_open: "Cold open", goals: "Doelen", chapter: "Hoofdstuk" };
const TONE: Record<string, string> = { cold_open: "bg-violet-500", hook: "bg-violet-400", payoff: "bg-emerald-500", discovery: "bg-emerald-500", chapter: "bg-cyan-600" };
const SPEEDS = [0.5, 0.75, 1, 1.1, 1.25, 1.5, 2];
const sec = (ms: number) => (ms / 1000).toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const parseSec = (v: string) => {
  if (!v.trim()) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
};

/** What the montage shows now for this version: the chosen hook applied on top of the stored plan (what you see is what you edit). */
function initialState(script: DbScript, peakMs: number | null): EditorState {
  const hooks = parseHooks(script.hooks);
  const chosen = typeof script.chosen_hook === "number" ? (hooks[script.chosen_hook] ?? null) : null;
  const cut = applyHook(script, chosen, peakMs);
  return { topLine: cut.topLine ?? "", lines: cut.lines, segments: relayout(cut.segments) };
}

/**
 * Editor (fase C3): the montage plan as a timeline. Trim, move, split, speed, zoom and text per segment; narration
 * and top line. Every edit can be undone; saving makes a new version and never overwrites an earlier one.
 */
export function Editor({ script, nextVersion, recordingMs, peakMs, studioId, act, onClose }: { script: DbScript; nextVersion: number; recordingMs: number | null; peakMs: number | null; studioId: string; act: (a: () => Promise<unknown>) => Promise<void>; onClose: () => void }) {
  const [history, setHistory] = useState<History>(() => startHistory(initialState(script, peakMs)));
  const [selected, setSelected] = useState(0);
  const state = history.present;
  const apply = (next: EditorState) => setHistory((h) => commit(h, next));
  const problems = editorProblems(state, recordingMs);
  const total = totalMs(state.segments);
  const changed = history.past.length > 0;
  const seg: Segment | undefined = state.segments[selected];

  // Ctrl+Z / Ctrl+Shift+Z (Cmd on a Mac); inside a text field the browser keeps its own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (selected >= state.segments.length) setSelected(Math.max(0, state.segments.length - 1));
  }, [selected, state.segments.length]);

  const [splitAt, setSplitAt] = useState("");
  const widths = useMemo(() => state.segments.map((s) => Math.max(2, ((s.src_end_ms - s.src_start_ms) / s.speed / Math.max(1, total)) * 100)), [state.segments, total]);

  const save = (approve: boolean) => void act(() => saveEditedScript(studioId, script, nextVersion, { topLine: state.topLine, lines: state.lines, segments: state.segments, targetMs: total }, approve)).then(onClose);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-cyan-300 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Editor <span className="text-xs font-normal text-slate-500">· wordt versie {nextVersion}, gebaseerd op versie {script.version} · lengte {formatTimecode(total)}</span>
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" disabled={!history.past.length} onClick={() => setHistory(undo)} aria-label="Ongedaan maken (Ctrl+Z)">
            <Undo2 className="h-4 w-4" aria-hidden /> Ongedaan maken
          </Button>
          <Button variant="ghost" disabled={!history.future.length} onClick={() => setHistory(redo)} aria-label="Opnieuw (Ctrl+Shift+Z)">
            <Redo2 className="h-4 w-4" aria-hidden /> Opnieuw
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-slate-500">Tijdlijn: klik een fragment om het te bewerken.</p>
        <div className="flex h-9 w-full overflow-hidden rounded-md border border-slate-200" role="listbox" aria-label="Fragmenten">
          {state.segments.map((s, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === selected}
              onClick={() => setSelected(i)}
              title={`${PART[s.part] ?? s.part} · ${formatTimecode(s.out_start_ms)}`}
              style={{ width: `${widths[i]}%` }}
              className={`relative border-r border-white/60 text-[10px] text-white ${TONE[s.part] ?? "bg-slate-500"} ${i === selected ? "ring-2 ring-inset ring-cyan-300" : "opacity-80 hover:opacity-100"}`}
            >
              <span className="block truncate px-1">
                {i + 1}
                {s.effects.includes(ZOOM) ? " 🔍" : ""}
                {s.text ? " T" : ""}
              </span>
            </button>
          ))}
        </div>
      </div>

      {seg && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <p className="text-xs font-medium text-slate-700">
            Fragment {selected + 1}: {PART[seg.part] ?? seg.part} · in de video vanaf {formatTimecode(seg.out_start_ms)} · {sec((seg.src_end_ms - seg.src_start_ms) / seg.speed)} s
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="grid min-w-0 gap-0.5 text-xs">
              <span className="text-slate-500">Begin in opname (s)</span>
              <input key={`a${selected}-${seg.src_start_ms}`} defaultValue={sec(seg.src_start_ms)} onBlur={(e) => { const v = parseSec(e.target.value); if (v !== null && v !== seg.src_start_ms) apply(trimSegment(state, selected, v, seg.src_end_ms)); }} className="w-full min-w-0 rounded border border-slate-300 bg-transparent px-2 py-1" />
            </label>
            <label className="grid min-w-0 gap-0.5 text-xs">
              <span className="text-slate-500">Einde in opname (s)</span>
              <input key={`b${selected}-${seg.src_end_ms}`} defaultValue={sec(seg.src_end_ms)} onBlur={(e) => { const v = parseSec(e.target.value); if (v !== null && v !== seg.src_end_ms) apply(trimSegment(state, selected, seg.src_start_ms, v)); }} className="w-full min-w-0 rounded border border-slate-300 bg-transparent px-2 py-1" />
            </label>
            <label className="grid min-w-0 gap-0.5 text-xs">
              <span className="text-slate-500">Snelheid</span>
              <select value={seg.speed} onChange={(e) => apply(setSpeed(state, selected, Number(e.target.value)))} className="w-full min-w-0 rounded border border-slate-300 bg-transparent px-2 py-1">
                {[...new Set([...SPEEDS, seg.speed])].sort((a, b) => a - b).map((v) => (
                  <option key={v} value={v}>
                    {v.toLocaleString("nl-NL")}×
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-0.5 text-xs">
              <span className="text-slate-500">Tekst in beeld</span>
              <input key={`t${selected}-${seg.text ?? ""}`} defaultValue={seg.text ?? ""} maxLength={60} placeholder="bijv. 4 ZOMBIES" onBlur={(e) => { if ((e.target.value.trim() || undefined) !== seg.text) apply(setSegmentText(state, selected, e.target.value)); }} className="w-full min-w-0 rounded border border-slate-300 bg-transparent px-2 py-1" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant={seg.effects.includes(ZOOM) ? "primary" : "secondary"} onClick={() => apply(toggleZoom(state, selected))}>
              <ZoomIn className="h-4 w-4" aria-hidden /> Zoom {seg.effects.includes(ZOOM) ? "aan" : "uit"}
            </Button>
            <Button variant="ghost" disabled={selected === 0} onClick={() => { apply(moveSegment(state, selected, -1)); setSelected(selected - 1); }} aria-label="Naar voren">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" disabled={selected >= state.segments.length - 1} onClick={() => { apply(moveSegment(state, selected, 1)); setSelected(selected + 1); }} aria-label="Naar achteren">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <span className="flex items-center gap-1">
              <input value={splitAt} onChange={(e) => setSplitAt(e.target.value)} placeholder="na … s" aria-label="Splitsen na seconden in dit fragment" className="w-20 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs" />
              <Button variant="ghost" onClick={() => { const v = parseSec(splitAt) ?? Math.round((seg.src_end_ms - seg.src_start_ms) / seg.speed / 2); const next = splitSegment(state, selected, v); if (next !== state) { apply(next); setSplitAt(""); } }}>
                <Scissors className="h-4 w-4" aria-hidden /> Splitsen
              </Button>
            </span>
            <Button variant="ghost" disabled={state.segments.length <= 1} onClick={() => apply(removeSegment(state, selected))}>
              <Trash2 className="h-4 w-4" aria-hidden /> Verwijderen
            </Button>
          </div>
          <p className="text-xs text-slate-500">Splitsen zonder getal: in het midden. Zoom = het middelste deel van het beeld, goed voor een duidelijke beeldwissel.</p>
        </div>
      )}

      <label className="grid gap-1 text-xs">
        <span className="text-slate-500">Tekst bovenin (Shorts)</span>
        <input key={`top-${state.topLine}`} defaultValue={state.topLine} maxLength={60} onBlur={(e) => { if (e.target.value !== state.topLine) apply({ ...state, topLine: e.target.value }); }} className="rounded border border-slate-300 bg-transparent px-2 py-1 text-sm font-semibold" />
      </label>

      <div className="space-y-1">
        <p className="text-xs text-slate-500">Ondertitels en voice-over (tijd in seconden in de video)</p>
        {state.lines.map((l, j) => (
          <div key={`${j}-${l.at_ms}`} className="flex items-center gap-2">
            <input defaultValue={sec(l.at_ms)} onBlur={(e) => { const v = parseSec(e.target.value); if (v !== null && v !== l.at_ms) apply(setLine(state, j, { at_ms: v })); }} aria-label="Tijd in seconden" className="w-16 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs" />
            <input defaultValue={l.text} maxLength={400} onBlur={(e) => { if (e.target.value !== l.text) apply(setLine(state, j, { text: e.target.value })); }} aria-label="Tekst" className="min-w-0 flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs" />
            <Button variant="ghost" onClick={() => apply(removeLine(state, j))} aria-label="Regel verwijderen">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="ghost" onClick={() => apply(addLine(state, Math.max(0, Math.min(total - 1000, (state.lines[state.lines.length - 1]?.at_ms ?? 0) + 2000))))}>
          Regel toevoegen
        </Button>
      </div>

      {problems.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-amber-800">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
        <Button disabled={!changed || problems.length > 0} onClick={() => save(true)}>
          Opslaan als versie {nextVersion}, goedkeuren en monteren
        </Button>
        <Button variant="secondary" disabled={!changed || problems.length > 0} onClick={() => save(false)}>
          Alleen opslaan
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Sluiten zonder opslaan
        </Button>
      </div>
      <p className="text-xs text-slate-500">Elke opslag wordt een nieuwe versie; eerdere versies en montages blijven bestaan. Sneltoetsen: Ctrl+Z en Ctrl+Shift+Z.</p>
    </div>
  );
}

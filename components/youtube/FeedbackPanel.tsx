"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { remountPreview } from "@/lib/youtube/remountData";
import { clock, FEEDBACK_KINDS, FEEDBACK_LABEL, type FeedbackItem, type FeedbackKind, type RemountMode } from "@/lib/youtube/reviewFeedback";

/**
 * Feedback while watching (23-11-2026): "Feedback op dit moment" takes the time of the player, then a quick choice
 * (verkeerde clip, zwakke opening, payoff ontbreekt, slechte crop, timing, voice-over, captions, muziek, overig) and
 * free text. Milan chooses a targeted correction or a full new montage and sees what will change before he confirms.
 */
export function FeedbackPanel({ player, items, onChange, mode, onMode }: { player: () => HTMLVideoElement | null; items: FeedbackItem[]; onChange: (items: FeedbackItem[]) => void; mode: RemountMode; onMode: (m: RemountMode) => void }) {
  const [draft, setDraft] = useState<FeedbackItem | null>(null);
  const take = () => {
    const v = player();
    if (v) v.pause();
    setDraft({ atMs: Math.round((v?.currentTime ?? 0) * 1000), kind: "other", text: "" });
  };
  const add = () => {
    if (!draft) return;
    onChange([...items, draft].sort((a, b) => a.atMs - b.atMs));
    setDraft(null);
  };
  const jump = (ms: number) => {
    const v = player();
    if (v) {
      v.currentTime = ms / 1000;
      void v.play().catch(() => undefined);
    }
  };
  const preview = items.length ? remountPreview(items, mode) : null;

  return (
    <section aria-label="Feedback" className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Feedback</p>
        <Button variant="secondary" onClick={take}>
          <MessageSquarePlus className="h-4 w-4" aria-hidden /> Feedback op dit moment
        </Button>
      </div>

      {draft && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <p className="text-xs text-slate-600">Bij {clock(draft.atMs)}</p>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Wat gaat er mis">
            {FEEDBACK_KINDS.map((k: FeedbackKind) => (
              <button key={k} type="button" role="radio" aria-checked={draft.kind === k} onClick={() => setDraft({ ...draft, kind: k })} className={`rounded-full border px-2.5 py-1 text-xs ${draft.kind === k ? "border-violet-500 bg-violet-50 font-medium text-violet-900" : "border-slate-300 text-slate-700"}`}>
                {FEEDBACK_LABEL[k]}
              </button>
            ))}
          </div>
          {draft.kind === "crop" && (
            <div className="flex gap-2 text-xs">
              <span className="text-slate-600">Uitsnede moet naar:</span>
              {(["left", "right"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="radio" name="side" checked={draft.side === s} onChange={() => setDraft({ ...draft, side: s })} /> {s === "left" ? "links" : "rechts"}
                </label>
              ))}
            </div>
          )}
          {draft.kind === "music" && (
            <div className="flex gap-2 text-xs">
              {(["other", "none"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <input type="radio" name="music" checked={draft.music === m} onChange={() => setDraft({ ...draft, music: m })} /> {m === "other" ? "andere muziek" : "geen muziek"}
                </label>
              ))}
            </div>
          )}
          <textarea value={draft.text} maxLength={200} rows={2} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="bijv. de tegenstander verdwijnt rechts uit beeld" className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm" />
          <div className="flex gap-2">
            <Button onClick={add}>Toevoegen</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Annuleren
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {items.map((it, k) => (
            <li key={k} className="flex items-start gap-2">
              <button type="button" onClick={() => jump(it.atMs)} className="shrink-0 tabular-nums text-cyan-700 underline underline-offset-2" title="Afspelen vanaf dit moment">
                {clock(it.atMs)}
              </button>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{FEEDBACK_LABEL[it.kind]}</span>
                {it.side ? ` (naar ${it.side === "left" ? "links" : "rechts"})` : ""}
                {it.music ? ` (${it.music === "none" ? "geen" : "andere"} muziek)` : ""}
                {it.text ? `: ${it.text}` : ""}
              </span>
              <button type="button" aria-label="Verwijderen" onClick={() => onChange(items.filter((_, i) => i !== k))} className="text-slate-500 hover:text-red-700">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="text-xs text-slate-600">Bij opnieuw monteren</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "gericht"} onChange={() => onMode("gericht")} /> Gerichte correctie (zelfde fragment en script, alleen dit aanpassen)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "volledig"} onChange={() => onMode("volledig")} /> Volledig nieuwe montage
          </label>
          {preview && (
            <div className="rounded-md bg-slate-50 px-2 py-1 text-xs">
              {preview.changes.length > 0 && <p className="text-emerald-800">Verandert: {preview.changes.join(" · ")}</p>}
              {preview.unsupported.length > 0 && <p className="text-amber-800">Kan niet gericht: {preview.unsupported.join(" · ")} — kies volledig nieuwe montage.</p>}
            </div>
          )}
        </fieldset>
      )}
    </section>
  );
}

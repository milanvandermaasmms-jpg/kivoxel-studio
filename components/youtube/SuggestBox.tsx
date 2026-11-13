"use client";

import { Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { addTag, removeTag } from "@/lib/youtube/suggest";
import { loadSuggestState, requestSuggestions, type SuggestState } from "@/lib/youtube/suggestData";

/** Tags as chips: click the cross to remove, type and press Enter (or a comma) to add. */
export function TagChips({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const commit = (value: string) => {
    let next = tags;
    // "minecraft #gaming #shorts" are three tags, not one (that went wrong in the old tag field).
    for (const part of value.split(/,|s+(?=#)/)) next = addTag(next, part);
    onChange(next);
    setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1">
      {tags.map((t) => (
        <span key={t.toLowerCase()} className="inline-flex items-center gap-1 rounded-full bg-cyan-50 py-0.5 pl-2 pr-1 text-cyan-900">
          {t}
          {!disabled && (
            <button type="button" onClick={() => onChange(removeTag(tags, t))} aria-label={`Tag ${t} verwijderen`} className="rounded-full p-0.5 hover:bg-cyan-200">
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={text}
          onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) commit(text);
            } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => text.trim() && commit(text)}
          placeholder={tags.length ? "Nog een tag…" : "Typ een tag en druk op Enter"}
          aria-label="Eigen tag toevoegen"
          className="min-w-[8rem] flex-1 bg-transparent py-0.5 outline-none"
        />
      )}
    </div>
  );
}

/**
 * AI suggestions for tags, titles and description (fase 1.6). Always shows what is happening: waiting for the worker,
 * busy, done, or the error with "Opnieuw proberen". Nothing is taken over without Milan's click.
 */
export function SuggestBox({ studioId, videoId, title, description, tags, disabled, onTags, onTitle, onDescription }: {
  studioId: string;
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  disabled?: boolean;
  onTags: (tags: string[]) => void;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
}) {
  const [state, setState] = useState<SuggestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const last = useRef("");

  const load = useCallback(async () => {
    try {
      const s = await loadSuggestState(videoId);
      const key = JSON.stringify(s);
      if (key !== last.current) {
        last.current = key;
        setState(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggesties laden lukte niet.");
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);
  const pending = state?.state === "waiting" || state?.state === "running";
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  async function ask() {
    setAsking(true);
    setError(null);
    try {
      await requestSuggestions(studioId, videoId, { title, description });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vragen lukte niet.");
    } finally {
      setAsking(false);
    }
  }

  const s = state?.state === "done" ? state.suggestions : null;
  const missing = s ? s.tags.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())) : [];
  const waitedLong = pending && state && "since" in state && Date.now() - Date.parse(state.since) > 60_000;

  return (
    <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-violet-900">
          <Sparkles className="h-4 w-4" aria-hidden /> AI-suggesties voor tags, titel en beschrijving
        </p>
        {!pending && (
          <Button variant="secondary" disabled={disabled || asking} onClick={() => void ask()}>
            {asking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {s ? "Nieuwe suggesties" : "Vraag AI-suggesties"}
          </Button>
        )}
      </div>

      {state === null && !error && <p className="text-slate-500">Laden…</p>}
      {state?.state === "none" && <p className="text-slate-600">De AI kijkt naar de titel, de beschrijving, de voice-over en het kanaal. Kost een fractie van een cent (testvideo&apos;s gratis).</p>}
      {pending && (
        <div role="status" className="flex items-center gap-2 text-violet-900">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {state.state === "waiting" ? "Wacht op de werker op de pc…" : "De AI denkt na…"}
          {waitedLong && <span className="text-amber-800">Dit duurt lang. Staat de werker aan?</span>}
        </div>
      )}
      {(error || state?.state === "failed") && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded bg-red-50 px-2 py-1 text-red-800">
          <span className="[overflow-wrap:anywhere]">Suggesties mislukt: {error ?? (state?.state === "failed" ? state.error : "")}</span>
          <Button variant="secondary" disabled={disabled || asking} onClick={() => void ask()}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Opnieuw proberen
          </Button>
        </div>
      )}

      {s && (
        <div className="space-y-2">
          {s.source === "test" && <p className="text-amber-800">Testvideo: vaste voorbeeldsuggesties, geen AI.</p>}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-slate-600">Tags (klik om toe te voegen):</span>
              {missing.length > 0 && (
                <button type="button" disabled={disabled} onClick={() => onTags(missing.reduce(addTag, tags))} className="text-violet-800 underline underline-offset-2">
                  Alle {missing.length} toevoegen
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.tags.map((t) => {
                const added = tags.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <button key={t} type="button" disabled={disabled} aria-pressed={added} onClick={() => onTags(added ? removeTag(tags, t) : addTag(tags, t))} className={`rounded-full border px-2 py-0.5 ${added ? "border-cyan-500 bg-cyan-50 text-cyan-900" : "border-violet-300 bg-surface text-violet-900 hover:bg-violet-50"}`}>
                    {added ? "✓ " : "+ "}
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          {s.titles.length > 0 && (
            <div className="space-y-1">
              <span className="text-slate-600">Titels (klik om te gebruiken):</span>
              <div className="flex flex-wrap gap-1.5">
                {s.titles.map((t) => (
                  <button key={t} type="button" disabled={disabled} onClick={() => onTitle(t)} className={`rounded-full border px-2 py-0.5 text-left ${title === t ? "border-cyan-500 bg-cyan-50" : "border-violet-300 bg-surface hover:bg-violet-50"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {s.description && (
            <div className="space-y-1">
              <span className="text-slate-600">Beschrijving:</span>
              <p className="whitespace-pre-line rounded bg-surface p-2 text-slate-700">{s.description}</p>
              <button type="button" disabled={disabled || description === s.description} onClick={() => onDescription(s.description)} className="text-violet-800 underline underline-offset-2 disabled:text-slate-400 disabled:no-underline">
                {description === s.description ? "In gebruik" : description ? "Vervang mijn beschrijving" : "Gebruik deze beschrijving"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

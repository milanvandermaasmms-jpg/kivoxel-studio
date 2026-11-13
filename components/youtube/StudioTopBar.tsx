"use client";

import { Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Channel } from "@/lib/youtube/channels";
import { countFlow, type Flow, type FlowItem } from "@/lib/youtube/flow";

/** The same order as the tabs: what needs Milan, what is being made, what is planned, what is live. */
const CHIPS: { key: string; label: string; dot: string; keys: Flow[] }[] = [
  { key: "action", label: "Te keuren of mislukt", dot: "bg-violet-500", keys: ["review", "failed"] },
  { key: "production", label: "In productie", dot: "bg-slate-400", keys: ["production"] },
  { key: "scheduled", label: "Ingepland", dot: "bg-sky-500", keys: ["scheduled"] },
  { key: "live", label: "Live", dot: "bg-emerald-500", keys: ["live"] },
];

/**
 * Always visible at the top (fase 1.1 and 1.3): "🚀 X klaar voor YouTube", the count per status and a filter per
 * channel. A new video that becomes ready gives a short message and a number in the browser tab.
 */
export function StudioTopBar({ items, channels, channel, onChannel, onOpen }: { items: FlowItem[] | null; channels: Channel[]; channel: string | null; onChannel: (id: string | null) => void; onOpen: (flow: Flow) => void }) {
  const shown = items?.filter((i) => !channel || i.channelId === channel) ?? null;
  const counts = shown ? countFlow(shown) : null;
  const ready = counts?.ready ?? 0;
  const readyIds = (items ?? []).filter((i) => i.flow === "ready").map((i) => i.videoId);
  const seen = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!items) return;
    const now = new Set(readyIds);
    if (seen.current) {
      const fresh = items.filter((i) => i.flow === "ready" && !seen.current!.has(i.videoId));
      if (fresh.length) setToast(fresh.length === 1 ? `🚀 Nieuw klaar voor YouTube: ${fresh[0].title}` : `🚀 ${fresh.length} nieuwe video's klaar voor YouTube`);
    }
    seen.current = now;
  }, [readyIds.join(",")]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = ready > 0 ? `(${ready}) ${base}` : base;
  }, [ready]);

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-surface/95 px-4 py-2 backdrop-blur lg:mx-0 lg:rounded-xl lg:border">
      <div className="flex items-center gap-2 sm:flex-wrap">
        <button
          type="button"
          onClick={() => onOpen("ready")}
          className={`relative inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ${ready > 0 ? "bg-amber-500 text-slate-950 hover:bg-amber-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          <Rocket className="h-4 w-4" aria-hidden />
          {counts === null ? "Laden…" : `${ready} klaar voor YouTube`}
          {ready > 0 && <span aria-hidden className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-red-500 ring-2 ring-white" />}
        </button>
        {/* Fixed widths and tabular numbers: the bar keeps its size when a number changes. */}
        <ul className="hidden flex-wrap gap-1 text-xs sm:flex" aria-label="Aantal video's per status">
          {CHIPS.map((f) => (
            <li key={f.key}>
              <button type="button" onClick={() => onOpen(f.keys[0])} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 hover:bg-slate-50">
                <span aria-hidden className={`h-2 w-2 rounded-full ${f.dot}`} />
                {f.label}
                <span className="inline-block min-w-[1.25rem] text-right font-semibold tabular-nums">{counts ? f.keys.reduce((n, k) => n + counts[k], 0) : "–"}</span>
              </button>
            </li>
          ))}
        </ul>
        {/* Always rendered (also while loading), so the bar does not change height when the data arrives. */}
        {(
          <label className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
            <span className="hidden sm:inline">Kanaal</span>
            <select value={channel ?? ""} aria-label="Kanaal" onChange={(e) => onChannel(e.target.value || null)} className="max-w-[9rem] rounded-md border border-slate-300 bg-transparent px-2 py-1">
              <option value="">Alle kanalen</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.status === "planned" ? " (gepland)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {toast && (
        <div role="status" className="fixed bottom-20 right-4 z-50 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg md:bottom-6">
          <button type="button" onClick={() => onOpen("ready")} className="text-left">
            {toast}
          </button>
        </div>
      )}
    </div>
  );
}

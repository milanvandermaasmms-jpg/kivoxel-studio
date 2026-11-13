"use client";

import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { loadLearning, setPreference } from "@/lib/youtube/learningData";
import { loadNoticeInput, notices, visibleNotices, type Notice } from "@/lib/youtube/notices";
import { signals } from "@/lib/youtube/signals";
import { loadStats } from "@/lib/youtube/stats";

const TONE: Record<Notice["tone"], string> = { error: "border-red-200 bg-red-50 text-red-900", warn: "border-amber-200 bg-amber-50 text-amber-900" };
const MAX = 5;

/**
 * Meldingen (opschonen 13-11-2026): only what Milan has to act on, grouped, at most 5 visible, each with a direct
 * action and "Negeren". Nothing is sent anywhere. Shows nothing at all when there is nothing to do.
 */
export function Notices({ studioId, onOpen }: { studioId: string; onOpen: (tab: NonNullable<Notice["action"]["tab"]>) => void }) {
  const [list, setList] = useState<Notice[] | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [stats, learning] = await Promise.all([loadStats(studioId).catch(() => "migration" as const), loadLearning(studioId).catch(() => null)]);
    const found = stats === "migration" ? [] : signals(stats.videos, stats.production);
    const input = await loadNoticeInput(studioId, found);
    const d: Record<string, string> = {};
    if (learning?.ready) for (const p of learning.prefs) if (p.key.startsWith("notice_dismissed:") && typeof p.value === "string") d[p.key.slice("notice_dismissed:".length)] = p.value;
    setDismissed(d);
    setList(notices(input));
  }, [studioId]);
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Meldingen laden lukte niet."));
  }, [load]);

  const shown = list ? visibleNotices(list, dismissed) : [];
  if (error) return <p className="text-sm text-red-800">{error}</p>;
  if (!list || shown.length === 0) return null;
  const ignore = (n: Notice) =>
    void setPreference(studioId, null, `notice_dismissed:${n.key}`, n.signature)
      .then(() => setDismissed((d) => ({ ...d, [n.key]: n.signature })))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  return (
    <section aria-label="Meldingen" className="space-y-2">
      <ul className="space-y-2">
        {(all ? shown : shown.slice(0, MAX)).map((n) => (
          <li key={n.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${TONE[n.tone]}`}>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{n.text}</span>
            <span className="flex gap-1">
              {n.action.href ? (
                <a href={n.action.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium underline underline-offset-2">
                  {n.action.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <Button variant="secondary" onClick={() => n.action.tab && onOpen(n.action.tab)}>
                  {n.action.label}
                </Button>
              )}
              <Button variant="ghost" onClick={() => ignore(n)}>
                Negeren
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {shown.length > MAX && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-slate-600 underline underline-offset-2">
          {all ? "Minder tonen" : `Toon alles (${shown.length})`}
        </button>
      )}
    </section>
  );
}

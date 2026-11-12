"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { loadNoticeInput, notices, type Notice } from "@/lib/youtube/notices";
import { signals } from "@/lib/youtube/signals";
import { loadStats } from "@/lib/youtube/stats";

const TONE: Record<Notice["tone"], string> = { error: "border-red-200 bg-red-50 text-red-900", warn: "border-amber-200 bg-amber-50 text-amber-900", info: "border-slate-200 text-slate-700" };
const TAB_LABEL: Record<Notice["tab"], string> = { pipeline: "Naar pijplijn", stats: "Naar cijfers", settings: "Naar instellingen" };

/** Notifications (fase F): only in the app, nothing is sent. Publications, the YouTube link, statistics and signals. */
export function Notices({ studioId, onOpen }: { studioId: string; onOpen: (tab: Notice["tab"]) => void }) {
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const stats = await loadStats(studioId).catch(() => "migration" as const);
      const found = stats === "migration" ? [] : signals(stats.videos, stats.production);
      const input = await loadNoticeInput(studioId, found);
      if (live) setList(notices(input));
    })().catch((e) => live && setError(e instanceof Error ? e.message : "Meldingen laden lukte niet."));
    return () => {
      live = false;
    };
  }, [studioId]);

  return (
    <Section title={`Meldingen${list ? `: ${list.length}` : ""}`} intro="Alleen hier in de app; er wordt niets verstuurd.">
      {error && <p className="text-sm text-red-800">{error}</p>}
      {list === null && !error && <p className="text-sm text-slate-500">Laden…</p>}
      {list?.length === 0 && <p className="text-sm text-slate-500">Geen meldingen.</p>}
      {list && list.length > 0 && (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${TONE[n.tone]}`}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{n.text}</span>
              <Button variant="ghost" onClick={() => onOpen(n.tab)}>
                {TAB_LABEL[n.tab]}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

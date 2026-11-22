"use client";

import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Dialog";
import type { FlowState } from "@/lib/youtube/flowData";
import type { FlowItem } from "@/lib/youtube/flow";
import { byLine, waitReason } from "@/lib/youtube/uploadWait";

type Ready = Extract<NonNullable<FlowState>, { board: unknown }>;
type Waiting = FlowItem & { wait: NonNullable<FlowItem["wait"]> };

const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Wachtrij YouTube (22-11-2026): the step between Klaar voor YouTube and Live. What YouTube does not take now (the
 * channel's daily upload limit, or the day quota) waits here, per channel, in the order it goes. The worker sends the
 * first in line by itself as soon as it may, one at a time per channel; nobody has to click again.
 */
export function WaitingList({ state, channel, onArchive }: { state: Ready; channel: string | null; onArchive: (videoId: string) => void }) {
  const waiting = state.items.filter((i): i is Waiting => i.flow === "waiting" && !!i.wait && (!channel || i.channelId === channel));
  const uploading = state.items.filter((i) => i.flow === "uploading" && (!channel || i.channelId === channel));
  const channels = [...new Set([...waiting, ...uploading].map((i) => i.channelId))];
  const nameOf = (id: string) => state.board.channels.find((c) => c.id === id)?.name ?? "Kanaal";
  const now = Date.now();

  return (
    <section className="space-y-4" aria-label="Wachtrij YouTube">
      <div className="rounded-xl border border-slate-200 bg-surface p-4 text-sm">
        <h2 className="text-base font-semibold">⏳ Wachtrij YouTube ({waiting.length})</h2>
        <p className="mt-1 text-slate-600">
          Video&apos;s die YouTube nu niet aanneemt (daglimiet van het kanaal of dagquotum). De werker uploadt ze zelf zodra het weer mag: per kanaal één tegelijk, in deze volgorde, privé. Je hoeft niets opnieuw te versturen.
        </p>
      </div>

      {!channels.length && (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
          Er wacht niets. Weigert YouTube een upload, dan komt de video hier te staan en gaat hij vanzelf door zodra het kan.
        </p>
      )}

      {channels.map((ch) => {
        const line = waiting.filter((i) => i.channelId === ch).sort((a, b) => byLine({ id: a.videoId, wait: a.wait }, { id: b.videoId, wait: b.wait }));
        const busy = uploading.filter((i) => i.channelId === ch);
        const head = line[0];
        const headDue = head && Date.parse(head.wait.retryAt) <= now;
        return (
          <div key={ch} className="space-y-2 rounded-xl border border-slate-200 bg-surface p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{nameOf(ch)}</h3>
              <p className="text-xs text-slate-600">
                {busy.length
                  ? "Nu bezig met uploaden; daarna de volgende."
                  : !head
                    ? ""
                    : headDue
                      ? "Aan de beurt: gaat binnen 2 minuten naar YouTube."
                      : `Volgende poging: ${when(head.wait.retryAt)} · ${waitReason(head.wait.reason)}`}
              </p>
            </div>
            {busy.map((i) => (
              <div key={i.videoId} className="flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                <span className="min-w-0 flex-1 truncate">Nu naar YouTube: {i.title}</span>
              </div>
            ))}
            <ol className="divide-y divide-slate-200">
              {line.map((i, k) => (
                <li key={i.videoId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="w-8 shrink-0 text-center font-semibold tabular-nums text-slate-700">{k + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{i.title}</span>
                    <span className="block text-xs text-slate-500">
                      {i.kind === "short" ? "Short" : "Lange video"} · in de wachtrij sinds {when(i.wait.since)}
                    </span>
                  </span>
                  <Button variant="ghost" onClick={() => onArchive(i.videoId)} title="Uit de wachtrij halen en archiveren">
                    <Archive className="h-4 w-4" aria-hidden /> Archiveren
                  </Button>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

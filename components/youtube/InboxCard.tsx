"use client";

import { FolderInput } from "lucide-react";
import { Section } from "@/components/settings/Section";
import type { WorkerHealth } from "@/lib/youtube/protocol";

const time = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Inbox folder (fase 2): drop a recording in the folder on the pc instead of uploading it here. */
export function InboxCard({ health }: { health: WorkerHealth | null | undefined }) {
  const inbox = health?.inbox;
  return (
    <Section title="Inbox-map" intro="Zet een opname in deze map op de pc. De werker pakt hem op zodra het kopiëren klaar is en start dan zelf de intake. Je hoeft hier niets te uploaden.">
      {health === undefined ? (
        <p className="text-sm text-slate-500">Laden…</p>
      ) : !health ? (
        <p className="text-sm text-slate-500">Zichtbaar zodra de werker bereikbaar is.</p>
      ) : !inbox ? (
        <p className="text-sm text-slate-500">Deze werker heeft nog geen inbox-map (versie 60 of nieuwer nodig), of hij staat uit (KIVOXEL_INBOX=0).</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex items-start gap-2">
            <FolderInput className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <span className="break-all font-mono text-xs leading-5">{inbox.dir}</span>
          </p>
          <p className="text-slate-600">
            {inbox.waiting > 0 ? `${inbox.waiting} bestand${inbox.waiting === 1 ? "" : "en"} wordt nog gekopieerd` : "Niets aan het wachten"} · {inbox.imported} opgepakt sinds de werker startte
          </p>
          {inbox.last && (
            <p className="text-slate-600">
              Laatste: {inbox.last.label} ({time(inbox.last.at)}){inbox.last.duplicate ? " — stond er al, verplaatst naar _dubbel" : ""}
            </p>
          )}
          {inbox.errors.length > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              <p className="font-medium">Niet gelukt (staat in de map _fout, met uitleg ernaast):</p>
              <ul className="mt-1 list-disc pl-5">
                {inbox.errors.map((e) => (
                  <li key={e.file + e.at} className="[overflow-wrap:anywhere]">
                    {e.file}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

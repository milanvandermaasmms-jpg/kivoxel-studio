"use client";

// 23-11-2026: the briefing for a recording that is already in the studio (fase 11, also after the upload). Saving keeps
// every earlier version; "opslaan en opnieuw analyseren" starts a paid analysis that uses it (cost shown first).

import { useState } from "react";
import { Button } from "@/components/ui/Dialog";
import { BriefingForm, briefingToDraft, draftToBriefing, type BriefingDraft } from "./BriefingForm";
import { briefingSummary } from "@/lib/kivoxel/briefing";
import { loadBriefing, saveBriefing } from "@/lib/youtube/studio";

export function RecordingBriefing({ studioId, recordingId, game, reanalyse, act }: { studioId: string; recordingId: string; game: string | null; /** Present when a paid analysis may start: label with the cost and the action. */ reanalyse?: { label: string; run: () => Promise<unknown> }; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState<BriefingDraft | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const open = async () => {
    const b = await loadBriefing(studioId, recordingId).catch(() => null);
    setSummary(b ? briefingSummary(b) : null);
    setDraft(briefingToDraft(b));
  };
  if (!draft)
    return (
      <button type="button" onClick={() => void open()} className="text-xs text-violet-700 underline underline-offset-2">
        Briefing bekijken of aanpassen
      </button>
    );
  const briefing = draftToBriefing(draft, game);
  return (
    <div className="mt-2 space-y-2">
      {summary && <p className="text-xs text-slate-600">Huidige briefing: {summary}</p>}
      <BriefingForm draft={draft} game={game} onChange={setDraft} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!briefing} onClick={() => void act(async () => { await saveBriefing(studioId, recordingId, briefing!); setSummary(briefingSummary(briefing)); })}>
          Briefing opslaan
        </Button>
        {reanalyse && (
          <Button disabled={!briefing} onClick={() => void act(async () => { await saveBriefing(studioId, recordingId, briefing!); await reanalyse.run(); setSummary(briefingSummary(briefing)); })}>
            Opslaan en {reanalyse.label}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setDraft(null)}>
          Sluiten
        </Button>
      </div>
    </div>
  );
}

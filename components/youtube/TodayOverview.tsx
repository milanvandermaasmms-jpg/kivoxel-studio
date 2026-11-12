"use client";

import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { studioOverview, type StudioOverview } from "@/lib/youtube/actions";
import type { AnalysisState } from "@/lib/youtube/analysisData";
import { STEP_LABEL, type DbState } from "@/lib/youtube/studio";

/** Overview from what the page already loaded; null while something is still loading or a migration is missing. */
export function overviewFrom(db: DbState | null, analysis: AnalysisState | null, workerOnline: boolean | undefined): StudioOverview | null {
  if (!db?.ready || !analysis?.ready) return null;
  return studioOverview({
    videos: analysis.videos,
    scripts: analysis.scripts,
    jobs: db.jobs,
    settings: analysis.settings,
    spentCents: analysis.spentCents,
    workerOnline,
    stepLabel: (s) => STEP_LABEL[s] ?? s,
  });
}

const COUNTERS: { key: keyof Omit<StudioOverview, "actions">; label: string }[] = [
  { key: "ready", label: "Klaar voor publicatie" },
  { key: "review", label: "Wacht op controle" },
  { key: "scriptsToApprove", label: "Scripts te keuren" },
  { key: "rendering", label: "Montage bezig" },
];

/** "Vandaag" on the overview tab: what is ready, and Mijn acties with a button to the right tab. */
export function TodayOverview({ overview, onOpen }: { overview: StudioOverview | null; onOpen: (tab: "pipeline" | "settings") => void }) {
  return (
    <Section title="Vandaag" intro="Testdata telt hier niet mee. Er gaat niets online zonder jouw klik in het publicatiescherm.">
      {!overview ? (
        <p className="text-sm text-slate-500">Laden…</p>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTERS.map((c) => (
              <div key={c.key} className="rounded-lg border border-slate-200 px-3 py-2">
                <dt className="text-xs text-slate-500">{c.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{overview[c.key]}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="text-sm font-medium">Mijn acties: {overview.actions.length}</h3>
            {overview.actions.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Er wacht niets op jou.</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {overview.actions.map((a) => (
                  <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${a.tone === "error" ? "text-red-700" : "text-amber-800"}`}>{a.text}</span>
                    <Button variant="ghost" onClick={() => onOpen(a.tab)}>
                      {a.tab === "settings" ? "Naar instellingen" : "Naar pijplijn"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

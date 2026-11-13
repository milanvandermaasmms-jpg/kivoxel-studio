"use client";

import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { parseWords } from "@/lib/youtube/channels";
import type { GateItem } from "@/lib/youtube/gatekeeper";
import { loadPrivateTerms, savePrivateTerms } from "@/lib/youtube/gatekeeperData";

const MARK: Record<GateItem["level"], { mark: string; tone: string }> = {
  green: { mark: "✓", tone: "text-emerald-700" },
  orange: { mark: "!", tone: "text-amber-800" },
  red: { mark: "✕", tone: "text-red-800" },
};

/** The Poortwachter checklist: green, orange or red per rule, with what to do. */
export function GateList({ items, title = "Poortwachter" }: { items: GateItem[]; title?: string }) {
  const reds = items.filter((i) => i.level === "red").length;
  return (
    <section aria-label={title} className="space-y-1 rounded-md border border-slate-200 p-2">
      <p className="text-xs font-medium">
        {title}: {reds ? <span className="text-red-800">{reds === 1 ? "1 punt houdt dit tegen" : `${reds} punten houden dit tegen`}</span> : <span className="text-emerald-700">alles in orde</span>}
      </p>
      <ul className="space-y-0.5 text-xs">
        {items.map((i) => (
          <li key={i.key} className={`flex gap-1.5 ${MARK[i.level].tone}`}>
            <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
              {MARK[i.level].mark}
            </span>
            <span>
              {i.label}
              {i.note ? <span className={i.level === "green" ? "text-slate-500" : ""}>: {i.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Loads the private word list and shows the card. */
export function PrivateTermsSettings({ studioId, onError }: { studioId: string; onError: (m: string | null) => void }) {
  const [terms, setTerms] = useState<string[] | null | undefined>(undefined);
  const load = useCallback(() => {
    loadPrivateTerms(studioId)
      .then(setTerms)
      .catch((e) => onError(e instanceof Error ? e.message : "Laden lukte niet."));
  }, [studioId, onError]);
  useEffect(load, [load]);
  return <PrivateTermsCard key={JSON.stringify(terms)} studioId={studioId} terms={terms} onSaved={load} onError={onError} />;
}

/** Settings: the words that may never appear in a script, title, description or tag (migration 046). */
function PrivateTermsCard({ studioId, terms, onSaved, onError }: { studioId: string; terms: string[] | null | undefined; onSaved: () => void; onError: (m: string | null) => void }) {
  const [text, setText] = useState((terms ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const next = parseWords(text);
  const changed = JSON.stringify(next) !== JSON.stringify(terms ?? []);
  return (
    <Section title="Privé-woorden" intro="Namen van de kinderen, school, woonplaats, straat en gamertags. Staat een van deze woorden in een script, titel, beschrijving of tag, dan houdt de Poortwachter de video tegen: goedkeuren en uploaden lukken dan niet. Alleen beheerders zien deze lijst.">
      {terms === undefined ? (
        <p className="text-sm text-slate-500">Laden…</p>
      ) : terms === null ? (
        <p className="text-sm text-slate-600">De lijst komt er met migratie 046 (nog niet uitgevoerd).</p>
      ) : (
        <div className="space-y-2 text-sm">
          <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} placeholder="komma tussen elk woord" className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1" />
          <p className="text-xs text-slate-500">{next.length === 0 ? "De lijst is leeg: vul hem in, anders kan de Poortwachter niet op namen letten." : `${next.length} ${next.length === 1 ? "woord" : "woorden"}.`}</p>
          <Button
            disabled={!changed || busy}
            onClick={() => {
              setBusy(true);
              onError(null);
              savePrivateTerms(studioId, next)
                .then(onSaved)
                .catch((e) => onError(e instanceof Error ? e.message : "Opslaan lukte niet."))
                .finally(() => setBusy(false));
            }}
          >
            Opslaan
          </Button>
        </div>
      )}
    </Section>
  );
}

"use client";

import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import type { Channel } from "@/lib/youtube/channels";
import { FOLDS, type Preference, type Tip } from "@/lib/youtube/learning";
import { answerTip, deletePreference, type LearningState, type TipChoice } from "@/lib/youtube/learningData";

/**
 * "💡 Studio-tips" (fase 2.2): concrete proposals from what Milan does, each with Toepassen, Negeren and Nooit meer
 * tonen. Nothing changes without his click, and nothing is ever published by a tip.
 */
export function StudioTips({ studioId, tips, state, onChanged }: { studioId: string; tips: Tip[]; state: LearningState | null; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function answer(tip: Tip, choice: TipChoice) {
    setBusy(tip.id);
    setError(null);
    try {
      await answerTip(studioId, tip, choice);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dat lukte niet.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Lightbulb className="h-4 w-4" aria-hidden /> 💡 Studio-tips
      </h2>
      {state && !state.ready ? (
        <p className="mt-2 text-sm text-amber-900">{state.reason === "migration" ? "De Studio-tips komen er met migratie 049 (nog niet uitgevoerd)." : `Tips laden lukte niet: ${state.message ?? ""}`}</p>
      ) : tips.length === 0 ? (
        <p className="mt-2 text-sm text-amber-900">Nog geen tips. De Studio kijkt mee met wat je doet (welke tags, welke tijden, wat je overslaat) en stelt hier voor wat je vaker doet als standaard te maken.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tips.map((t) => (
            <li key={t.id} className="rounded-lg border border-amber-200 bg-surface p-3 text-sm">
              <p className="font-medium">{t.text}</p>
              <p className="mt-0.5 text-xs text-slate-600">{t.because}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button disabled={busy === t.id} onClick={() => void answer(t, "applied")}>
                  Toepassen
                </Button>
                <Button variant="secondary" disabled={busy === t.id} onClick={() => void answer(t, "ignored")}>
                  Negeren
                </Button>
                <Button variant="ghost" disabled={busy === t.id} onClick={() => void answer(t, "never")}>
                  Nooit meer tonen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}

const describe = (p: Preference, channels: Channel[]): string | null => {
  const where = p.channel_id ? (channels.find((c) => c.id === p.channel_id)?.name ?? "kanaal") : "alle kanalen";
  if (p.key === "default_tags" && Array.isArray(p.value)) return `Standaardtags (${where}): ${(p.value as string[]).join(", ")}`;
  if (p.key.startsWith("default_slot:")) return `${p.key.endsWith("short") ? "Shorts" : "Lange video's"} standaard inplannen om ${String(p.value)} (${where})`;
  if (p.key === "hidden_folds" && Array.isArray(p.value)) return `Verborgen onderdelen: ${(p.value as string[]).map((f) => FOLDS[f]?.title ?? f).join(", ") || "geen"}`;
  return null;
};

/** Instellingen: what the Studio learned and Milan applied, each with "Terugdraaien". */
export function StudioPreferences({ prefs, channels, onChanged }: { prefs: Preference[]; channels: Channel[]; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const shown = prefs.map((p) => ({ p, text: describe(p, channels) })).filter((x): x is { p: Preference; text: string } => !!x.text);
  const never = prefs.filter((p) => p.key.startsWith("tip:") && (p.value as { state?: string })?.state === "never");
  return (
    <Section title="Wat de Studio heeft geleerd" intro="Voorkeuren die je via de Studio-tips hebt toegepast. Terugdraaien kan altijd.">
      {shown.length === 0 && never.length === 0 ? (
        <p className="text-sm text-slate-500">Nog niets toegepast.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {shown.map(({ p, text }) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{text}</span>
              <Button variant="ghost" onClick={() => void deletePreference(p.id).then(onChanged, (e) => setError(e instanceof Error ? e.message : String(e)))}>
                Terugdraaien
              </Button>
            </li>
          ))}
          {never.length > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{never.length} {never.length === 1 ? "tip staat" : "tips staan"} op &quot;Nooit meer tonen&quot;</span>
              <Button variant="ghost" onClick={() => void Promise.all(never.map((p) => deletePreference(p.id))).then(onChanged, (e) => setError(e instanceof Error ? e.message : String(e)))}>
                Weer tonen
              </Button>
            </li>
          )}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    </Section>
  );
}

"use client";

// 23-11-2026 (Milan, superprompt V5, fase 11): the briefing with every upload. What happens in the recording, what the
// edit must focus on, the most important event, time marks, mood, output, voice and music. Everything is optional; an
// empty form means "the studio decides itself", exactly as before.

import { Field, inputClass } from "@/components/ui/Dialog";
import { GAMEPLAY_LABEL, GAMEPLAY_TYPES, MOODS, MUSIC_LABEL, MUSIC_PREFS, OUTPUT_LABEL, OUTPUTS, parseBriefing, parseMarks, TYPES_FOR_GAME, VOICE_LABEL, VOICE_PREFS, type Briefing, type BriefMood, type GameplayType, type MusicPref, type Output, type VoicePref } from "@/lib/kivoxel/briefing";

export type BriefingDraft = { gameplay: GameplayType | ""; story: string; editNotes: string; keyEvent: string; marks: string; moods: BriefMood[]; output: Output; shorts: string; voice: VoicePref; music: MusicPref; extra: string };
export const emptyDraft = (): BriefingDraft => ({ gameplay: "", story: "", editNotes: "", keyEvent: "", marks: "", moods: [], output: "auto", shorts: "", voice: "auto", music: "auto", extra: "" });

/** The draft as stored briefing; null when Milan filled in nothing (the studio then decides itself). */
export function draftToBriefing(d: BriefingDraft, game: string | null): Briefing | null {
  const n = Number(d.shorts);
  return parseBriefing({ v: 1, game: game ?? undefined, gameplay: d.gameplay || undefined, story: d.story, editNotes: d.editNotes, keyEvent: d.keyEvent, marks: parseMarks(d.marks).marks, moods: d.moods, output: d.output, shorts: Number.isFinite(n) && n > 0 ? n : undefined, voice: d.voice, music: d.music, extra: d.extra, at: new Date().toISOString() });
}

const area = `${inputClass} min-h-[5.5rem]`;

export function BriefingForm({ draft, game, disabled, onChange }: { draft: BriefingDraft; game: string | null; disabled?: boolean; onChange: (d: BriefingDraft) => void }) {
  const set = (patch: Partial<BriefingDraft>) => onChange({ ...draft, ...patch });
  const types = (game && TYPES_FOR_GAME[game]) || [...GAMEPLAY_TYPES];
  const marks = parseMarks(draft.marks);
  const manyShorts = draft.output === "shorts" || draft.output === "many_shorts" || draft.output === "both";
  return (
    <details className="group rounded-lg border border-slate-200 bg-slate-50/60" open={!!(draft.story || draft.keyEvent || draft.editNotes)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
        <span>
          Briefing voor de montage <span className="font-normal text-slate-500">(optioneel, maar stuurt alles)</span>
        </span>
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        <p className="text-xs text-slate-600">Wat je hier invult gaat mee naar de analyse, de keuze van fragmenten, het script, de stem, de muziek en de controle achteraf. De studio gebruikt het als richting en verzint niets: wat niet in beeld te zien is, wordt gemeld.</p>
        <Field label="Type gameplay">
          <select className={inputClass} value={draft.gameplay} disabled={disabled} onChange={(e) => set({ gameplay: e.target.value as GameplayType | "" })}>
            <option value="">Laat de studio het bepalen</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {GAMEPLAY_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Wat gebeurt er in deze opname?" hint="In je eigen woorden. Gebruik een gamertag, nooit een echte naam.">
          <textarea className={area} value={draft.story} maxLength={2000} disabled={disabled} placeholder="bijv. Hij speelt survival en zoekt een zeldzaam voorwerp. Onderweg wordt hij aangevallen en komt hij bij een bijzondere plek." onChange={(e) => set({ story: e.target.value })} />
        </Field>
        <Field label="Speciale instructies voor de montage">
          <textarea className={area} value={draft.editNotes} maxLength={1500} disabled={disabled} placeholder="bijv. Focus op het moment dat hij bijna doodgaat. Weinig tekst, laat de gameplay spreken." onChange={(e) => set({ editNotes: e.target.value })} />
        </Field>
        <Field label="Welke gebeurtenis is het belangrijkste?" hint="De analyse zoekt dit moment. Wordt het niet gevonden, dan meldt de studio dat en verzint het niet.">
          <input className={inputClass} value={draft.keyEvent} maxLength={300} disabled={disabled} placeholder="bijv. Het vinden van een Pirate Token" onChange={(e) => set({ keyEvent: e.target.value })} />
        </Field>
        <Field label="Tijdcodes (optioneel)" hint="Eén per regel: tijd en een notitie. Deze momenten worden eerst bekeken; de rest van de opname ook.">
          <textarea className={`${inputClass} min-h-[4.5rem] font-mono`} value={draft.marks} disabled={disabled} placeholder={"02:30 grappig moment\n08:45 bijna dood\n14:20 bijzondere ontdekking"} onChange={(e) => set({ marks: e.target.value })} />
        </Field>
        {draft.marks.trim() && (
          <p className={`text-xs ${marks.rejected.length ? "text-amber-800" : "text-slate-600"}`}>
            {marks.marks.length} tijdcode{marks.marks.length === 1 ? "" : "s"} herkend{marks.rejected.length ? `; geen geldige tijd in: “${marks.rejected[0]}”${marks.rejected.length > 1 ? ` (+${marks.rejected.length - 1})` : ""}` : ""}
          </p>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Gewenste sfeer</legend>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => {
              const on = draft.moods.includes(m);
              return (
                <button key={m} type="button" disabled={disabled} aria-pressed={on} onClick={() => set({ moods: on ? draft.moods.filter((x) => x !== m) : [...draft.moods, m] })} className={`min-h-9 rounded-full border px-3 text-sm capitalize ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:bg-slate-50"}`}>
                  {m}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gewenste output">
            <select className={inputClass} value={draft.output} disabled={disabled} onChange={(e) => set({ output: e.target.value as Output })}>
              {OUTPUTS.map((o) => (
                <option key={o} value={o}>
                  {OUTPUT_LABEL[o]}
                </option>
              ))}
            </select>
          </Field>
          {manyShorts && (
            <Field label="Hoeveel Shorts maximaal?">
              <input className={inputClass} type="number" min={1} max={12} value={draft.shorts} disabled={disabled} placeholder={draft.output === "many_shorts" ? "6" : "3"} onChange={(e) => set({ shorts: e.target.value })} />
            </Field>
          )}
          <Field label="Voice-over">
            <select className={inputClass} value={draft.voice} disabled={disabled} onChange={(e) => set({ voice: e.target.value as VoicePref })}>
              {VOICE_PREFS.map((v) => (
                <option key={v} value={v}>
                  {VOICE_LABEL[v]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Muziek">
            <select className={inputClass} value={draft.music} disabled={disabled} onChange={(e) => set({ music: e.target.value as MusicPref })}>
              {MUSIC_PREFS.map((m) => (
                <option key={m} value={m}>
                  {MUSIC_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Extra instructies">
          <textarea className={area} value={draft.extra} maxLength={1500} disabled={disabled} onChange={(e) => set({ extra: e.target.value })} />
        </Field>
      </div>
    </details>
  );
}

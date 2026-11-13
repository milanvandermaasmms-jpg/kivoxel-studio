"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { YouTubeConnection } from "@/components/youtube/YouTubeConnection";
import { CHANNEL_MODE, CHANNEL_STATUS, channelProblem, loadChannels, parseSlots, parseWords, profileProblem, providersText, SAFETY_PROFILE, saveChannel, saveProfile, type Channel, type ChannelEdit, type ProfileEdit } from "@/lib/youtube/channels";

/** Channel administration (migration 032) with a profile per channel (migration 045). */
export function ChannelCard({ studioId, onError }: { studioId: string; onError: (message: string | null) => void }) {
  const [channels, setChannels] = useState<Channel[] | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      setChannels(await loadChannels(studioId));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Kanalen laden lukte niet.");
    }
  }, [studioId, onError]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (channels === undefined)
    return (
      <Section title="Kanaal">
        <p className="text-sm text-slate-500">Laden…</p>
      </Section>
    );
  if (channels === null)
    return (
      <Section title="Kanaal">
        <p className="text-sm text-slate-600">De kanaaladministratie komt er met migratie 032 (nog niet uitgevoerd).</p>
      </Section>
    );
  if (channels.length === 0)
    return (
      <Section title="Kanaal">
        <p className="text-sm text-slate-500">Er is nog geen kanaal. Het eerste kanaal ontstaat vanzelf bij de eerste opname.</p>
      </Section>
    );
  return (
    <Section title={channels.length === 1 ? "Kanaal" : "Kanalen"} intro="Alle opnames, video's, scripts en kosten horen bij een kanaal. Een opname en alles wat eruit komt blijft bij één kanaal, zodat dezelfde video nooit op twee kanalen verschijnt. Elk kanaal heeft een profiel; de stijlgids staat in de map channels/(korte naam).">
      <ul className="space-y-3">
        {channels.map((c) => (
          <ChannelRow
            key={`${c.id}:${c.name}:${c.status}:${c.language}:${c.audience}:${c.brand_color}`}
            channel={c}
            profile={
              c.mode !== undefined ? (
                <ProfileForm
                  key={JSON.stringify([c.slug, c.mode, c.safety_profile, c.made_for_kids, c.synthetic_media, c.banned_words, c.publish_slots, c.concept_auto_approve])}
                  channel={c}
                  onSave={async (p) => {
                    try {
                      onError(null);
                      await saveProfile(c.id, p);
                      await refresh();
                    } catch (e) {
                      onError(e instanceof Error ? e.message : "Opslaan lukte niet.");
                    }
                  }}
                />
              ) : null
            }
            connection={<YouTubeConnection channel={c} anotherLinked={channels.some((o) => o.id !== c.id && !!o.youtube_connected_at)} onChanged={refresh} />}
            onSave={async (edit) => {
              try {
                onError(null);
                await saveChannel(c.id, edit);
                await refresh();
              } catch (e) {
                onError(e instanceof Error ? e.message : "Opslaan lukte niet.");
              }
            }}
          />
        ))}
      </ul>
    </Section>
  );
}

function ChannelRow({ channel, connection, profile, onSave }: { channel: Channel; connection: ReactNode; profile: ReactNode; onSave: (edit: ChannelEdit) => Promise<void> }) {
  const initial: ChannelEdit = { name: channel.name, status: channel.status, language: channel.language, audience: channel.audience, brand_color: channel.brand_color };
  const [draft, setDraft] = useState(initial);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const problem = channelProblem(draft);
  const field = "rounded-md border border-slate-300 bg-transparent px-2 py-1";
  return (
    <li className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="h-3 w-3 rounded-full border border-slate-300" style={{ background: draft.brand_color ?? "transparent" }} />
        <span className="font-medium">{channel.name}</span>
        {channel.is_default && <span className="text-xs text-slate-500">standaardkanaal</span>}
        <span className="text-xs text-slate-500">· {CHANNEL_STATUS[channel.status]}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Naam</span>
          <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Taal van de video&apos;s</span>
          <select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value as ChannelEdit["language"] })} className={field}>
            <option value="en">Engels</option>
            <option value="nl">Nederlands</option>
          </select>
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-slate-500">Doelgroep</span>
          <input value={draft.audience ?? ""} maxLength={300} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} placeholder="bijv. Minecraft-spelers die van spanning houden" className={field} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Merkkleur</span>
          <span className="flex items-center gap-2">
            <input type="color" value={draft.brand_color ?? "#22aa55"} onChange={(e) => setDraft({ ...draft, brand_color: e.target.value })} className="h-8 w-12 rounded border border-slate-300 bg-transparent" />
            {draft.brand_color ? (
              <button type="button" onClick={() => setDraft({ ...draft, brand_color: null })} className="text-xs text-slate-500 underline underline-offset-2">
                Geen kleur
              </button>
            ) : (
              <span className="text-xs text-slate-500">nog geen kleur</span>
            )}
          </span>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Status</span>
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ChannelEdit["status"] })} className={field}>
            {Object.entries(CHANNEL_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {connection}
      {profile}
      {draft.language !== "en" && <p className="text-xs text-amber-800">Let op: de scripts zijn nu nog Engels. Nederlandse scripts volgen later.</p>}
      {changed && problem && <p className="text-xs text-amber-800">{problem}</p>}
      <div className="flex gap-2">
        <Button disabled={!changed || !!problem} onClick={() => void onSave(draft)}>
          Opslaan
        </Button>
        {changed && (
          <Button variant="ghost" onClick={() => setDraft(initial)}>
            Terugzetten
          </Button>
        )}
      </div>
    </li>
  );
}

/** The profile of one channel (migration 045). Which paid services a channel uses is not chosen here: that needs Milan's go-ahead and a budget. */
function ProfileForm({ channel, onSave }: { channel: Channel; onSave: (p: ProfileEdit) => Promise<void> }) {
  const initial: ProfileEdit = {
    slug: channel.slug ?? "",
    mode: channel.mode ?? "upload",
    safety_profile: channel.safety_profile ?? "kids_gaming",
    made_for_kids: channel.made_for_kids ?? null,
    synthetic_media: channel.synthetic_media ?? false,
    banned_words: channel.banned_words ?? [],
    publish_slots: channel.publish_slots ?? [],
    concept_auto_approve: channel.concept_auto_approve ?? false,
  };
  const [draft, setDraft] = useState(initial);
  const [words, setWords] = useState(initial.banned_words.join(", "));
  const [slots, setSlots] = useState(initial.publish_slots.join(", "));
  const next: ProfileEdit = { ...draft, banned_words: parseWords(words), publish_slots: parseSlots(slots) };
  const changed = JSON.stringify(next) !== JSON.stringify(initial);
  const problem = profileProblem(next);
  const field = "rounded-md border border-slate-300 bg-transparent px-2 py-1";
  return (
    <details className="rounded-md border border-slate-200 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Kanaalprofiel</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Korte naam (map channels/…)</span>
          <input value={draft.slug} maxLength={40} onChange={(e) => setDraft({ ...draft, slug: e.target.value.trim().toLowerCase() })} placeholder="bijv. kivoxel" className={field} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Werkwijze</span>
          <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as ProfileEdit["mode"] })} className={field}>
            {Object.entries(CHANNEL_MODE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Veiligheidsprofiel</span>
          <select value={draft.safety_profile} onChange={(e) => setDraft({ ...draft, safety_profile: e.target.value as ProfileEdit["safety_profile"] })} className={field}>
            {Object.entries(SAFETY_PROFILE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-slate-500">Made for Kids (standaard, per video aan te passen)</span>
          <select value={draft.made_for_kids === null ? "" : String(draft.made_for_kids)} onChange={(e) => setDraft({ ...draft, made_for_kids: e.target.value === "" ? null : e.target.value === "true" })} className={field}>
            <option value="">Nog niet gekozen</option>
            <option value="true">Ja, gemaakt voor kinderen</option>
            <option value="false">Nee</option>
          </select>
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={draft.synthetic_media} onChange={(e) => setDraft({ ...draft, synthetic_media: e.target.checked })} />
          <span>AI-label aan bij uploaden (verplicht bij AI-beeld of AI-muziek)</span>
        </label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={draft.concept_auto_approve} onChange={(e) => setDraft({ ...draft, concept_auto_approve: e.target.checked })} className="mt-0.5" />
          <span>
            Concept (Keur 1) vanzelf goedkeuren en de montage meteen starten
            <span className="block text-xs text-slate-500">Alleen als het script schoon is (geen privé-woorden, verboden woorden of persoonsgegevens). De eindversie keur je altijd zelf, en publiceren blijft jouw klik.</span>
          </span>
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-slate-500">Verboden woorden in titels, beschrijvingen en thumbnails (komma tussen elk woord)</span>
          <textarea value={words} rows={2} onChange={(e) => setWords(e.target.value)} placeholder="bijv. geneest, gegarandeerd" className={field} />
        </label>
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-slate-500">Vaste publicatietijden (Nederlandse tijd)</span>
          <input value={slots} onChange={(e) => setSlots(e.target.value)} placeholder="bijv. 19:00, 20:00" className={field} />
        </label>
      </div>
      <p className="mt-3 text-xs text-slate-500">Diensten: {providersText(channel.providers)}. Een betaalde dienst komt er pas na jouw akkoord en een budget.</p>
      {changed && problem && <p className="mt-2 text-xs text-amber-800">{problem}</p>}
      <div className="mt-3 flex gap-2">
        <Button disabled={!changed || !!problem} onClick={() => void onSave(next)}>
          Profiel opslaan
        </Button>
        {changed && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(initial);
              setWords(initial.banned_words.join(", "));
              setSlots(initial.publish_slots.join(", "));
            }}
          >
            Terugzetten
          </Button>
        )}
      </div>
    </details>
  );
}

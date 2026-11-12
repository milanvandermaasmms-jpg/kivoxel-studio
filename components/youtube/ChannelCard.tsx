"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { YouTubeConnection } from "@/components/youtube/YouTubeConnection";
import { CHANNEL_STATUS, channelProblem, loadChannels, saveChannel, type Channel, type ChannelEdit } from "@/lib/youtube/channels";

/** Channel administration (migration 032). Today one channel; more channels come once this one runs well. */
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
    <Section title={channels.length === 1 ? "Kanaal" : "Kanalen"} intro="Alle opnames, video's, scripts en kosten horen bij een kanaal. Een opname en alles wat eruit komt blijft bij één kanaal, zodat dezelfde video nooit op twee kanalen verschijnt. Meer kanalen volgen later.">
      <ul className="space-y-3">
        {channels.map((c) => (
          <ChannelRow
            key={`${c.id}:${c.name}:${c.status}:${c.language}:${c.audience}:${c.brand_color}`}
            channel={c}
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

function ChannelRow({ channel, connection, onSave }: { channel: Channel; connection: ReactNode; onSave: (edit: ChannelEdit) => Promise<void> }) {
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

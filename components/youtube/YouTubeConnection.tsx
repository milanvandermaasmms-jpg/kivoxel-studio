"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/shell/StatusBadge";
import { Button } from "@/components/ui/Dialog";
import type { Channel } from "@/lib/youtube/channels";
import { connectionView, quotaText } from "@/lib/youtube/connection";
import type { WorkerHealth } from "@/lib/youtube/protocol";
import { disconnectYouTube, startYouTubeConnect, workerHealth, youtubeStatus, type YouTubeStatus } from "@/lib/youtube/workerClient";

const dateTime = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * YouTube connection of one channel (fase D1). The worker on the pc signs in with Google and keeps the tokens there;
 * this block only starts it and shows the state the worker wrote to Supabase.
 */
export function YouTubeConnection({ channel, anotherLinked, onChanged }: { channel: Channel; anotherLinked: boolean; onChanged: () => Promise<void> }) {
  const [health, setHealth] = useState<WorkerHealth | null | undefined>(undefined);
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const stop = useRef<number | null>(null);

  const check = useCallback(async () => {
    const h = await workerHealth();
    setHealth(h);
    setStatus(h?.youtube ? await youtubeStatus(h.multiChannel ? channel.id : undefined).catch(() => null) : null);
  }, [channel.id]);
  useEffect(() => {
    void check();
  }, [check]);

  // After opening Google: look every 3 seconds for 10 minutes until the worker has stored the link.
  const linked = !!channel.youtube_connected_at;
  useEffect(() => {
    if (!waiting) return;
    if (linked) {
      setWaiting(false);
      void check();
      return;
    }
    const timer = window.setInterval(() => void onChanged(), 3000);
    stop.current = window.setTimeout(() => setWaiting(false), 10 * 60_000);
    return () => {
      window.clearInterval(timer);
      if (stop.current) window.clearTimeout(stop.current);
    };
  }, [waiting, linked, onChanged, check]);

  if (health === undefined) return <p className="text-xs text-slate-500">YouTube-koppeling: werker nakijken…</p>;
  const view = connectionView(channel, health, status?.connected ? status.channelId : null, anotherLinked && !health?.multiChannel);
  const needsStats = !!status?.connected && !status.scopes.includes("https://www.googleapis.com/auth/yt-analytics.readonly");

  async function connect() {
    setBusy(true);
    setError(null);
    // Open the tab straight away (in the click), otherwise the browser blocks it as a pop-up.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await startYouTubeConnect(channel.id);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setWaiting(true);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Koppelen starten lukte niet.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectYouTube(channel.id);
      setConfirmOff(false);
      await onChanged();
      await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ontkoppelen lukte niet.");
    } finally {
      setBusy(false);
    }
  }

  const connectButton = (label: string) => (
    <Button disabled={busy || waiting} onClick={() => void connect()}>
      {waiting ? "Wachten op Google…" : label}
    </Button>
  );

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 text-xs text-slate-700">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        YouTube-koppeling
        {view.kind === "connected" ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${view.error ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{view.error ? "fout" : "gekoppeld"}</span> : <StatusBadge status="connect" />}
      </p>

      {view.kind === "migration" && <p>De koppeling komt er met migratie 036 (nog niet uitgevoerd).</p>}
      {view.kind === "worker-off" && <p>Start de werker op de pc (worker\start-werker.cmd); de koppeling loopt via de werker, zodat de sleutels van YouTube op de pc blijven.</p>}
      {view.kind === "worker-old" && <p>De werker draait nog een oude versie zonder YouTube. Herstart de werker (venster sluiten en opnieuw starten).</p>}
      {view.kind === "not-configured" && (
        <p>
          De werker mist de OAuth-client. Zet <span className="font-mono">YOUTUBE_CLIENT_ID</span> en <span className="font-mono">YOUTUBE_CLIENT_SECRET</span> in <span className="font-mono">worker\.env.local</span> en herstart de werker (stappen: docs/youtube-koppeling.md).
        </p>
      )}
      {view.kind === "other-linked" && <p>Er is al een ander kanaal gekoppeld. Meer kanalen tegelijk komen later.</p>}
      {view.kind === "ready" && (
        <>
          <p>
            Koppel dit kanaal met YouTube. Er opent een tabblad van Google: log in met het Google-account van <strong>{channel.is_default ? "Kivoxel" : channel.name}</strong>, kies dat YouTube-kanaal en geef toestemming voor uploaden en het beheren van je eigen video&apos;s. Er wordt niets gepubliceerd: dat doe je later altijd zelf met een klik.
          </p>
          <p className="text-slate-500">Zie je &quot;Google heeft deze app niet geverifieerd&quot;? Dat klopt: de app is alleen van jou. Kies Geavanceerd en dan Ga naar Kivoxel Studio.</p>
          {connectButton("YouTube koppelen")}
          {waiting && <p className="text-slate-500">Log in het nieuwe tabblad in. Daarna verschijnt het kanaal hier vanzelf.</p>}
        </>
      )}
      {view.kind === "connected" && (
        <>
          <div className="flex items-center gap-3">
            {channel.youtube_thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element -- the channel picture from Google, shown small
              <img src={channel.youtube_thumbnail_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full border border-slate-200" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{channel.youtube_title ?? "YouTube-kanaal"}</p>
              <p className="truncate font-mono text-slate-500">{channel.youtube_channel_id}</p>
            </div>
          </div>
          <p>
            Gekoppeld op {dateTime(channel.youtube_connected_at!)}
            {channel.youtube_synced_at && <>; laatst gecontroleerd {dateTime(channel.youtube_synced_at)}</>}.
          </p>
          {view.error && <p className="text-red-800">{view.error}</p>}
          {!view.tokensHere && health && <p className="text-amber-800">De werker op deze pc heeft geen sleutels voor dit kanaal. Koppel opnieuw om vanaf deze pc te uploaden.</p>}
          {!health && <p className="text-slate-500">De werker staat uit; de koppeling blijft bewaard op de pc.</p>}
          <p className="text-slate-500">Staat het toestemmingsscherm in Google Cloud op &quot;Testing&quot;, dan vervalt de toestemming na 7 dagen: koppel dan opnieuw vóór {dateTime(view.reconnectBefore)}. Op &quot;In production&quot; blijft hij gewoon werken.</p>
          {status?.connected && <p className="text-slate-500">YouTube-quotum vandaag (Pacific-tijd): {quotaText(status.quota)}.</p>}
          {needsStats && <p className="text-amber-800">Voor de cijfers (fase E) is een extra toestemming nodig: statistieken bekijken (alleen lezen). Klik op Opnieuw koppelen en vink alles aan.</p>}
          <div className="flex flex-wrap gap-2">
            {/* Always available, so a new consent (other permissions, expired test mode) never needs a disconnect first. */}
            {health?.youtube && connectButton("Opnieuw koppelen")}
            {health &&
              (confirmOff ? (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => void disconnect()}>
                    Ja, ontkoppelen
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmOff(false)}>
                    Annuleren
                  </Button>
                </>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmOff(true)}>
                  Ontkoppelen
                </Button>
              ))}
          </div>
          {confirmOff && <p className="text-amber-800">Ontkoppelen trekt de toestemming in bij Google en wist de sleutels op deze pc. Er verandert niets aan je kanaal of video&apos;s.</p>}
        </>
      )}
      {error && <p className="text-red-800">{error}</p>}
    </div>
  );
}

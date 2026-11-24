"use client";

// 24-11-2026: TikTok in the studio. The worker on the pc does the sign-in and keeps the keys; this block shows the status,
// starts the connection, and shows the send line: every new Short for YouTube also goes to Milan's TikTok inbox as a
// draft (he publishes it in the TikTok app). A Short can also be sent by hand from here.
import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { WORKER_URL } from "@/lib/youtube/protocol";

type Status = { configured: boolean; connected: boolean; username: string | null; displayName: string | null; consentedAt: string | null; redirectUri: string };
type Item = { videoId: string; title: string; status: string; error: string | null; addedAt: string };

const STATE_LABEL: Record<string, string> = { wacht: "wacht", bezig: "wordt verstuurd", "in inbox": "in je TikTok-inbox", gepubliceerd: "gepubliceerd", mislukt: "mislukt" };

export function TikTokConnection({ workerOnline }: { workerOnline: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([fetch(`${WORKER_URL}/tiktok/status`, { cache: "no-store" }), fetch(`${WORKER_URL}/tiktok/items`, { cache: "no-store" })]);
      if (s.ok) setStatus((await s.json()) as Status);
      if (i.ok) setItems((await i.json()) as Item[]);
    } catch {
      setError("De werker op de pc is niet bereikbaar.");
    }
  }, []);
  useEffect(() => {
    if (workerOnline) void load();
  }, [workerOnline, load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${WORKER_URL}/tiktok/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "Koppelen kon niet starten");
      window.open(j.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="TikTok" intro="Elke nieuwe Short die naar YouTube gaat, komt ook als concept in je TikTok-inbox. Publiceren doe je zelf in de TikTok-app.">
      {!workerOnline ? (
        <p className="text-sm text-slate-500">Start de werker op de pc om TikTok te koppelen.</p>
      ) : !status ? (
        <p className="text-sm text-slate-500">Laden…</p>
      ) : !status.configured ? (
        <p className="text-sm text-slate-600">Nog niet ingesteld: de TikTok-app wordt aangemaakt op developers.tiktok.com. Daarna verschijnt hier de knop om te koppelen.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {status.connected ? (
              <>
                ✅ Gekoppeld{status.username ? ` met @${status.username}` : ""}
                {status.consentedAt ? ` sinds ${new Date(status.consentedAt).toLocaleDateString("nl-NL")}` : ""}
              </>
            ) : (
              "Nog niet gekoppeld."
            )}
          </p>
          <button type="button" disabled={busy} onClick={() => void connect()} className="min-h-10 rounded-md bg-ink px-4 text-sm font-medium text-ink-fg disabled:opacity-50">
            {status.connected ? "Opnieuw koppelen" : "TikTok koppelen"}
          </button>
          {items.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...items].reverse().slice(0, 30).map((i) => (
                <li key={i.videoId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className={`text-xs ${i.status === "mislukt" ? "text-red-700" : i.status === "gepubliceerd" ? "text-emerald-700" : "text-slate-600"}`}>
                    {STATE_LABEL[i.status] ?? i.status}
                    {i.error && i.status !== "in inbox" ? ` · ${i.error.slice(0, 80)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </Section>
  );
}

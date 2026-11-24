"use client";

// 24-11-2026: TikTok in the studio. The worker on the pc does the sign-in and keeps the keys; this block shows the status,
// starts the connection, and shows the send line: every new Short for YouTube also goes to Milan's TikTok inbox as a
// draft (he publishes it in the TikTok app). A Short can also be sent by hand from here.
import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { CopyCaption } from "@/components/youtube/CopyCaption";

type Status = { configured: boolean; connected: boolean; username: string | null; displayName: string | null; consentedAt: string | null; redirectUri: string };
type Item = { videoId: string; title: string; caption?: string; status: string; error: string | null; addedAt: string };

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

  const [note, setNote] = useState<string | null>(null);
  /** Every approved KIVOXEL Short whose file is still on the pc joins the send line (a few per day, by TikTok's limit). */
  const sendAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${WORKER_URL}/tiktok/all`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await r.json()) as { added?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Lukte niet");
      setNote(j.added ? `${j.added} Shorts staan in de rij naar je TikTok-inbox. Ze gaan een paar per dag.` : "Alle Shorts op de pc staan al in de rij of in je TikTok-inbox.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveApp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const clientKey = String(f.get("clientKey") ?? "").trim();
    const clientSecret = String(f.get("clientSecret") ?? "").trim();
    if (!clientKey || !clientSecret) return setError("Vul allebei de velden in.");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${WORKER_URL}/tiktok/app`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientKey, clientSecret }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Opslaan lukte niet");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <form className="space-y-2" onSubmit={(e) => void saveApp(e)}>
          <p className="text-sm text-slate-600">
            Plak hier één keer de Klantsleutel en het Klantgeheim van de app op developers.tiktok.com (klik daar op het oogje of het kopieer-icoon). Ze worden versleuteld op deze pc bewaard.
          </p>
          <input name="clientKey" autoComplete="off" spellCheck={false} placeholder="Klantsleutel" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input name="clientSecret" type="password" autoComplete="off" placeholder="Klantgeheim" className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy} className="min-h-10 rounded-md bg-ink px-4 text-sm font-medium text-ink-fg disabled:opacity-50">
            Opslaan
          </button>
        </form>
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
          {status.connected && (
            <button type="button" disabled={busy} onClick={() => void sendAll()} className="ml-2 min-h-10 rounded-md border border-slate-300 px-4 text-sm font-medium disabled:opacity-50">
              Alle Shorts op de pc naar TikTok
            </button>
          )}
          {note && <p className="text-sm text-emerald-700">{note}</p>}
          {items.length > 0 && (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...items].reverse().slice(0, 30).map((i) => (
                <li key={i.videoId} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className={`text-xs ${i.status === "mislukt" ? "text-red-700" : i.status === "gepubliceerd" ? "text-emerald-700" : "text-slate-600"}`}>
                    {STATE_LABEL[i.status] ?? i.status}
                    {i.error && i.status !== "in inbox" ? ` · ${i.error.slice(0, 80)}` : ""}
                  </span>
                  {i.caption && i.status !== "mislukt" && <CopyCaption text={i.caption} />}
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

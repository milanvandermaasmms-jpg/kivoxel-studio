"use client";

// 24-11-2026: TikTok for the buttons in the studio. One small shared fetch of the worker's TikTok status and send line,
// so "Naar YouTube + TikTok sturen" and "Naar TikTok" know whether TikTok is connected and what is already sent.
import { useCallback, useEffect, useState } from "react";
import { WORKER_URL } from "@/lib/youtube/protocol";

export type TikTokState = { connected: boolean; sent: Record<string, string> };
const EMPTY: TikTokState = { connected: false, sent: {} };
let cache: { at: number; value: Promise<TikTokState> } | null = null;

async function fetchState(): Promise<TikTokState> {
  try {
    const [s, i] = await Promise.all([fetch(`${WORKER_URL}/tiktok/status`, { cache: "no-store" }), fetch(`${WORKER_URL}/tiktok/items`, { cache: "no-store" })]);
    if (!s.ok || !i.ok) return EMPTY;
    const status = (await s.json()) as { connected?: boolean };
    const items = (await i.json()) as { videoId: string; status: string }[];
    return { connected: !!status.connected, sent: Object.fromEntries(items.map((x) => [x.videoId, x.status])) };
  } catch {
    return EMPTY;
  }
}

function load(force = false) {
  if (force || !cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), value: fetchState() };
  return cache.value;
}

export function useTikTok(workerOnline: boolean) {
  const [state, setState] = useState<TikTokState>(EMPTY);
  const refresh = useCallback(async (force = true) => setState(await load(force)), []);
  useEffect(() => {
    if (workerOnline) void load().then(setState);
  }, [workerOnline]);
  /** Puts one Short in the send line to the TikTok inbox (as a draft). */
  const send = useCallback(
    async (videoId: string) => {
      const r = await fetch(`${WORKER_URL}/tiktok/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Naar TikTok sturen lukte niet");
      await refresh();
    },
    [refresh],
  );
  return { ...state, send, refresh };
}

export const TIKTOK_LABEL: Record<string, string> = { wacht: "TikTok: wacht", bezig: "TikTok: wordt verstuurd", "in inbox": "In TikTok-inbox", gepubliceerd: "Op TikTok", mislukt: "TikTok mislukt" };

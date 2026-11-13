"use client";
// Self-learning Studio in the database (migration 049). Logging never gets in Milan's way: events are sent in small
// batches in the background, and when the table is missing (migration not run) or the network fails, the Studio just
// works on without them.
import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, supabase } from "../supabase";
import { computeTips, type Preference, type SentPublication, type StudioEvent, type Tip } from "./learning";

type Pending = { studio_id: string; channel_id: string | null; action: string; screen: string; metadata: Record<string, unknown> };
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;
const isMissing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || /could not find|does not exist/i.test(e.message);

async function flush() {
  timer = null;
  if (disabled || !queue.length) return;
  const batch = queue.splice(0, 50);
  const { error } = await supabase.from("studio_events").insert(batch);
  if (error && isMissing(error)) disabled = true; // migration 049 not run yet: stop trying for this page load
}

/** Remembers one action of Milan (fase 2.1). Small metadata only: never video files, scripts or personal data. */
export function track(studioId: string, action: string, screen: string, metadata: Record<string, unknown> = {}, channelId: string | null = null) {
  if (disabled || typeof window === "undefined") return;
  queue.push({ studio_id: studioId, channel_id: channelId, action, screen, metadata });
  if (!timer) timer = setTimeout(() => void flush().catch(() => undefined), 3000);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => void flush().catch(() => undefined));

export type LearningState = { ready: true; events: StudioEvent[]; prefs: Preference[]; publications: SentPublication[] } | { ready: false; reason: "migration" | "error"; message?: string };

export async function loadLearning(studioId: string): Promise<LearningState> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [events, prefs, pubs] = await Promise.all([
    supabase.from("studio_events").select("action, screen, at, channel_id, metadata").eq("studio_id", studioId).gte("at", since).order("at", { ascending: false }).limit(3000).returns<StudioEvent[]>(),
    supabase.from("studio_preferences").select("id, channel_id, key, value, updated_at").eq("studio_id", studioId).returns<Preference[]>(),
    supabase.from("yt_publications").select("video_id, channel_id, status, tags, updated_at").eq("studio_id", studioId).order("updated_at", { ascending: false }).limit(100).returns<SentPublication[]>(),
  ]);
  const error = events.error ?? prefs.error;
  if (error) return isMissing(error) ? { ready: false, reason: "migration" } : { ready: false, reason: "error", message: friendlyError(error.message) };
  return { ready: true, events: events.data ?? [], prefs: prefs.data ?? [], publications: pubs.error ? [] : (pubs.data ?? []) };
}

/** Sets one preference (per channel, or for all channels with channelId null). */
export async function setPreference(studioId: string, channelId: string | null, key: string, value: unknown): Promise<void> {
  let q = supabase.from("studio_preferences").select("id").eq("studio_id", studioId).eq("key", key);
  q = channelId ? q.eq("channel_id", channelId) : q.is("channel_id", null);
  const found = await q.maybeSingle<{ id: string }>();
  if (found.error) throw new Error(friendlyError(found.error.message));
  const { error } = found.data ? await supabase.from("studio_preferences").update({ value }).eq("id", found.data.id) : await supabase.from("studio_preferences").insert({ studio_id: studioId, channel_id: channelId, key, value });
  if (error) throw new Error(friendlyError(error.message));
}

export async function deletePreference(id: string): Promise<void> {
  const { error } = await supabase.from("studio_preferences").delete().eq("id", id);
  if (error) throw new Error(friendlyError(error.message));
}

export type TipChoice = "applied" | "ignored" | "never";

/** Toepassen / Negeren / Nooit meer tonen. Toepassen also stores the preference the tip is about. */
export async function answerTip(studioId: string, tip: Tip, choice: TipChoice): Promise<void> {
  if (choice === "applied") await setPreference(studioId, tip.apply.channelId, tip.apply.key, tip.apply.value);
  await setPreference(studioId, null, `tip:${tip.id}`, { state: choice, at: new Date().toISOString() });
  track(studioId, `tip_${choice}`, "tips", { tip: tip.id, kind: tip.kind }, tip.channelId);
}

/** Tips and preferences for the page; reloaded every minute and after every answer. */
export function useLearning(studioId: string, enabled: boolean, channelName: (id: string) => string) {
  const [state, setState] = useState<LearningState | null>(null);
  const last = useRef("");
  const refresh = useCallback(async () => {
    try {
      const s = await loadLearning(studioId);
      const key = JSON.stringify(s);
      if (key === last.current) return;
      last.current = key;
      setState(s);
    } catch (e) {
      setState({ ready: false, reason: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [studioId]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh, enabled]);
  const tips = state?.ready ? computeTips({ events: state.events, prefs: state.prefs, publications: state.publications, channelName }) : [];
  return { state, tips, prefs: state?.ready ? state.prefs : [], refresh };
}

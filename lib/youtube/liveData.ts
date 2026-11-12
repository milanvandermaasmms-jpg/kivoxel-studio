"use client";
// Live Production Center data: steps and their log from Supabase, live via Realtime (migration 033), with a reload
// every 5 seconds as fallback while the live connection is down. A page refresh loses nothing: it is all in the database.
import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError, supabase } from "../supabase";
import type { LiveJob } from "./production";

export type JobEvent = { id: number; job_id: string; at: string; kind: "log" | "milestone" | "note" | "error"; message: string };
export type LiveConnection = "connecting" | "live" | "fallback";

const missing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883" || /could not find|does not exist/i.test(e.message);

export function useLiveJobs(studioId: string, enabled: boolean) {
  const [jobs, setJobs] = useState<LiveJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveConnection>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    // "*": the live columns only exist after migration 033.
    const { data, error: e } = await supabase.from("yt_jobs").select("*").eq("studio_id", studioId).order("created_at", { ascending: false }).limit(60).returns<LiveJob[]>();
    if (e) setError(friendlyError(e.message));
    else {
      setError(null);
      setJobs(data ?? []);
    }
  }, [studioId]);

  useEffect(() => {
    if (!enabled) return;
    const reloadSoon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 250);
    };
    const filter = `studio_id=eq.${studioId}`;
    const channel = supabase
      .channel(`yt-live-${studioId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "yt_jobs", filter }, reloadSoon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "yt_job_events", filter }, reloadSoon)
      .on("system", {}, (message: { extension?: string; status?: string }) => {
        if (message.extension !== "postgres_changes") return;
        setConnection(message.status === "ok" ? "live" : "fallback");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reload();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnection("fallback");
      });
    void reload();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [studioId, enabled, reload]);

  // Fallback: while not live, ask again every 5 seconds; while live, every 30 seconds as a safety net.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void reload(), connection === "live" ? 30_000 : 5_000);
    return () => clearInterval(id);
  }, [enabled, connection, reload]);

  return { jobs, error, connection, reload };
}

/** Log, milestones and notes of some steps, oldest first. null before migration 033. */
export async function loadEvents(jobIds: string[]): Promise<JobEvent[] | null> {
  if (!jobIds.length) return [];
  const { data, error } = await supabase.from("yt_job_events").select("id, job_id, at, kind, message").in("job_id", jobIds).order("at").limit(300).returns<JobEvent[]>();
  if (error) {
    if (missing(error)) return null;
    throw new Error(friendlyError(error.message));
  }
  return data ?? [];
}

/** Cancel: a waiting step at once, a running step via the worker (migration 033). Before 033 only waiting steps. */
export async function cancelLiveJob(id: string): Promise<"cancelled" | "requested" | string> {
  const { data, error } = await supabase.rpc("cancel_yt_job", { p_job: id });
  if (!error) return String(data);
  if (!missing(error)) throw new Error(friendlyError(error.message));
  const old = await supabase.from("yt_jobs").update({ status: "cancelled" }).eq("id", id).eq("status", "queued");
  if (old.error) throw new Error(friendlyError(old.error.message));
  return "cancelled";
}

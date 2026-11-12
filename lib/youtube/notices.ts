// Notifications on the overview (fase F). Only inside the app: nothing is sent anywhere (CLAUDE.md).
// Built from what is already in the database: publications, the YouTube connection, the statistics and the signals.
import { friendlyError, supabase } from "../supabase";
import type { Signal } from "./signals";

export type Notice = { key: string; tone: "error" | "warn" | "info"; text: string; tab: "pipeline" | "stats" | "settings" };
export type NoticeInput = {
  publications: { id: string; title: string; status: string; error: string | null; publish_at: string | null; updated_at: string; is_test: boolean; captions_status?: string | null; thumbnail_status?: string | null }[];
  channel: { youtube_connected_at: string | null; youtube_error: string | null } | null;
  lastSnapshot: { taken_at: string; analytics_error: string | null } | null;
  signals: Signal[];
  now: number;
};

const HOUR = 3_600_000;
const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function notices(input: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const t = (p: { title: string }) => `"${p.title || "zonder titel"}"`;
  for (const p of input.publications) {
    if (p.status === "failed") out.push({ key: `pub-failed:${p.id}`, tone: "error", text: `Publicatie ${t(p)} is mislukt${p.error ? `: ${p.error}` : ""}. Probeer het opnieuw in het publicatiescherm.`, tab: "pipeline" });
    if (p.status === "scheduled" && p.publish_at && Date.parse(p.publish_at) > input.now) out.push({ key: `pub-scheduled:${p.id}`, tone: "info", text: `${t(p)} gaat openbaar op ${when(p.publish_at)}.`, tab: "pipeline" });
    if (p.status === "published" && input.now - Date.parse(p.updated_at) < 48 * HOUR) out.push({ key: `pub-new:${p.id}`, tone: "info", text: `${t(p)} is gepubliceerd. Het prestatierapport (na 24 uur, 72 uur en 7 dagen) staat bij Cijfers.`, tab: "stats" });
    if (p.thumbnail_status?.startsWith("Mislukt")) out.push({ key: `thumb:${p.id}`, tone: "warn", text: `Thumbnail van ${t(p)}: ${p.thumbnail_status.replace(/^Mislukt: /, "")}`, tab: "pipeline" });
    if (p.captions_status?.startsWith("Mislukt")) out.push({ key: `captions:${p.id}`, tone: "warn", text: `Ondertitels van ${t(p)}: ${p.captions_status.replace(/^Mislukt: /, "")}`, tab: "pipeline" });
  }
  const c = input.channel;
  if (c?.youtube_error) out.push({ key: "yt-error", tone: "error", text: `YouTube-koppeling: ${c.youtube_error}`, tab: "settings" });
  if (c?.youtube_connected_at) {
    // In Google's "Testing" mode the consent ends after 7 days; warn two days before.
    const ends = Date.parse(c.youtube_connected_at) + 7 * 24 * HOUR;
    if (ends > input.now && ends - input.now < 2 * 24 * HOUR) out.push({ key: "yt-reconnect", tone: "warn", text: `Staat de app in Google Cloud op "Testing", koppel YouTube dan opnieuw vóór ${when(new Date(ends).toISOString())}.`, tab: "settings" });
    const snap = input.lastSnapshot;
    if (!snap || input.now - Date.parse(snap.taken_at) > 3 * HOUR) out.push({ key: "stats-stale", tone: "warn", text: snap ? `De cijfers zijn sinds ${when(snap.taken_at)} niet bijgewerkt. Draait de werker op de pc?` : "Er zijn nog geen cijfers opgehaald. Start de werker op de pc.", tab: "settings" });
    else if (snap.analytics_error) out.push({ key: "stats-analytics", tone: "warn", text: `Statistieken: ${snap.analytics_error}`, tab: "settings" });
  }
  for (const s of input.signals) out.push({ key: `signal:${s.kind}:${s.videoId ?? s.title}`, tone: s.tone === "good" ? "info" : "warn", text: s.title, tab: "stats" });
  const order = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

const isMissing = (e: { code?: string; message: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || /could not find|does not exist/i.test(e.message);

/** Loads what the notifications need; parts whose migration has not run are simply left out. */
export async function loadNoticeInput(studioId: string, signals: Signal[]): Promise<NoticeInput> {
  const [pubs, ch, snap] = await Promise.all([
    supabase.from("yt_publications").select("*").eq("studio_id", studioId).eq("is_test", false).order("updated_at", { ascending: false }).limit(50).returns<NoticeInput["publications"]>(),
    supabase.from("yt_channels").select("youtube_connected_at, youtube_error").eq("studio_id", studioId).not("youtube_connected_at", "is", null).limit(1).maybeSingle<NonNullable<NoticeInput["channel"]>>(),
    supabase.from("yt_channel_snapshots").select("taken_at, analytics_error").eq("studio_id", studioId).order("taken_at", { ascending: false }).limit(1).maybeSingle<NonNullable<NoticeInput["lastSnapshot"]>>(),
  ]);
  for (const r of [pubs, ch, snap]) if (r.error && !isMissing(r.error)) throw new Error(friendlyError(r.error.message));
  return { publications: pubs.error ? [] : (pubs.data ?? []), channel: ch.error ? null : (ch.data ?? null), lastSnapshot: snap.error ? null : (snap.data ?? null), signals, now: Date.now() };
}

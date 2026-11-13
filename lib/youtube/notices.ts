// Notifications on the overview (fase F). Only inside the app: nothing is sent anywhere (CLAUDE.md).
// Built from what is already in the database: publications, the YouTube connection, the statistics and the signals.
import { friendlyError, supabase } from "../supabase";
import type { Signal } from "./signals";

/**
 * Opschonen 13-11-2026: only notices Milan has to act on. Informational ones are gone (a video that is published,
 * a time that is planned: those are visible in Live and Ingepland). Equal notices are grouped ("3 thumbnails").
 * A notice disappears by itself when its cause is gone, because it is computed from the data every time.
 * signature: changes when a new case joins the group, so "Negeren" does not hide a new problem.
 */
export type Notice = { key: string; tone: "error" | "warn"; text: string; action: { label: string; tab?: "action" | "live" | "insights" | "settings"; href?: string }; signature: string };
export type NoticeInput = {
  publications: { id: string; title: string; status: string; error: string | null; publish_at: string | null; updated_at: string; is_test: boolean; captions_status?: string | null; thumbnail_status?: string | null }[];
  channel: { youtube_connected_at: string | null; youtube_error: string | null } | null;
  lastSnapshot: { taken_at: string; analytics_error: string | null } | null;
  signals: Signal[];
  now: number;
};

const HOUR = 3_600_000;
const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const quote = (p: { title: string }) => `"${p.title || "zonder titel"}"`;
const reason = (status: string) => status.replace(/^Mislukt: /, "");

/** Same cause, one notice: "bij 3 video's" with the titles behind it. */
function group<T extends { id: string; title: string }>(items: T[], one: (t: T) => string, many: (n: number) => string): { text: string; signature: string } | null {
  if (!items.length) return null;
  return { text: items.length === 1 ? one(items[0]) : many(items.length), signature: items.map((i) => i.id).sort().join(",") };
}

export function notices(input: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const pubs = input.publications;

  const failed = group(pubs.filter((p) => p.status === "failed"), (p) => `Publicatie ${quote(p)} is mislukt${p.error ? `: ${p.error}` : ""}.`, (n) => `${n} publicaties zijn mislukt.`);
  if (failed) out.push({ key: "pub-failed", tone: "error", ...failed, action: { label: "Bekijken", tab: "action" } });

  // One cause for all of them (the channel is not verified yet): one notice with the fix.
  const thumbs = pubs.filter((p) => p.thumbnail_status?.startsWith("Mislukt"));
  const unverified = thumbs.filter((p) => /verifie/i.test(p.thumbnail_status ?? ""));
  const v = group(unverified, (p) => `Eigen thumbnail lukt niet bij ${quote(p)}: verifieer je YouTube-kanaal (eenmalig).`, (n) => `Eigen thumbnails lukken niet bij ${n} video's: verifieer je YouTube-kanaal (eenmalig).`);
  if (v) out.push({ key: "thumb-verify", tone: "warn", ...v, action: { label: "Kanaal verifiëren", href: "https://www.youtube.com/verify" } });
  const otherThumbs = group(thumbs.filter((p) => !unverified.includes(p)), (p) => `Thumbnail van ${quote(p)}: ${reason(p.thumbnail_status!)}`, (n) => `Thumbnail mislukt bij ${n} video's.`);
  if (otherThumbs) out.push({ key: "thumb-failed", tone: "warn", ...otherThumbs, action: { label: "Bekijken", tab: "live" } });
  const captions = group(pubs.filter((p) => p.captions_status?.startsWith("Mislukt")), (p) => `Ondertitels van ${quote(p)}: ${reason(p.captions_status!)}`, (n) => `Ondertitels mislukt bij ${n} video's.`);
  if (captions) out.push({ key: "captions-failed", tone: "warn", ...captions, action: { label: "Bekijken", tab: "live" } });

  const c = input.channel;
  if (c?.youtube_error) out.push({ key: "yt-error", tone: "error", text: `YouTube-koppeling: ${c.youtube_error}`, signature: c.youtube_error, action: { label: "Naar instellingen", tab: "settings" } });
  if (c?.youtube_connected_at) {
    // In Google's "Testing" mode the consent ends after 7 days; warn two days before.
    const ends = Date.parse(c.youtube_connected_at) + 7 * 24 * HOUR;
    if (ends > input.now && ends - input.now < 2 * 24 * HOUR) out.push({ key: "yt-reconnect", tone: "warn", text: `Staat de app in Google Cloud op "Testing", koppel YouTube dan opnieuw vóór ${when(new Date(ends).toISOString())}.`, signature: c.youtube_connected_at, action: { label: "Naar instellingen", tab: "settings" } });
    const snap = input.lastSnapshot;
    if (!snap || input.now - Date.parse(snap.taken_at) > 3 * HOUR) out.push({ key: "stats-stale", tone: "warn", text: snap ? `De cijfers zijn sinds ${when(snap.taken_at)} niet bijgewerkt. Draait de werker op de pc?` : "Er zijn nog geen cijfers opgehaald. Start de werker op de pc.", signature: snap?.taken_at ?? "none", action: { label: "Naar instellingen", tab: "settings" } });
    else if (snap.analytics_error) out.push({ key: "stats-analytics", tone: "warn", text: `Statistieken: ${snap.analytics_error}`, signature: snap.analytics_error, action: { label: "Naar instellingen", tab: "settings" } });
  }
  // Only signals that ask for attention; the good news stays in Inzichten.
  const watch = input.signals.filter((s) => s.tone === "watch");
  if (watch.length) out.push({ key: "signals", tone: "warn", text: watch.length === 1 ? watch[0].title : `${watch.length} video's vragen aandacht in de cijfers.`, signature: watch.map((s) => `${s.kind}:${s.videoId ?? s.title}`).sort().join(","), action: { label: "Bekijken", tab: "insights" } });

  const order = { error: 0, warn: 1 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** Notices Milan chose to ignore, until a new case joins (other signature). */
export const visibleNotices = (list: Notice[], dismissed: Record<string, string>) => list.filter((n) => dismissed[n.key] !== n.signature);

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

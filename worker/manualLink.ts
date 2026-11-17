// Zelf geüpload (17-11-2026): Milan uploaded a video by hand in YouTube Studio (for example when the API quota was used
// up). He pastes the YouTube link in the Studio and the worker links it to the video, so it shows under Ingepland or Live
// like any other upload and is never uploaded a second time. Reads one videos.list (1 unit); changes nothing on YouTube.

/** The 11-character YouTube id from a link (watch, youtu.be, shorts, live, Studio) or from the bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === "youtu.be") return ok(u.pathname.split("/")[1]);
  if (host === "youtube.com") {
    if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
    const m = /^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname);
    return ok(m?.[1]);
  }
  if (host === "studio.youtube.com") return ok(/^\/video\/([^/?#]+)/.exec(u.pathname)?.[1]);
  return null;
}

export type YouTubeVideoInfo = { id: string; channelId: string; title: string; privacyStatus: "private" | "unlisted" | "public"; publishAt: string | null; publishedAt: string | null; madeForKids: boolean; containsSyntheticMedia: boolean };

/** What the Studio stores for a linked video, from what YouTube says about it now. */
export function linkState(v: YouTubeVideoInfo, nowMs: number) {
  const scheduled = v.privacyStatus === "private" && !!v.publishAt && Date.parse(v.publishAt) > nowMs;
  if (scheduled) return { pub: { status: "scheduled", visibility: "private", publish_at: v.publishAt }, video: { status: "scheduled", privacy_status: "private", scheduled_at: v.publishAt } } as const;
  const status = v.privacyStatus === "private" ? "uploaded" : "published";
  return {
    pub: { status, visibility: v.privacyStatus, publish_at: null },
    video: { status: "published", privacy_status: v.privacyStatus, scheduled_at: null, published_at: v.publishAt ?? v.publishedAt ?? new Date(nowMs).toISOString() },
  } as const;
}

/** Quota guard (17-11-2026): the day's YouTube quota or upload limit is used up (our own counter or YouTube itself). */
export const isQuotaError = (message: string) => /quotum|uploadlimiet|quotaExceeded|uploadLimitExceeded/i.test(message);
export const QUOTA_BACK = "YouTube-quotum van vandaag is op: terug naar Klaar voor YouTube. Verstuur hem morgen na 09:00 opnieuw, of upload hem zelf.";

/** A title YouTube and the database accept (at most 100 characters, no < or >). */
export const safeTitle = (t: string) => t.replace(/[<>]/g, "").slice(0, 100);

/** videos.list (1 unit) with the channel's own sign-in; null when YouTube does not know the id (or it is not visible to us). */
export async function lookupVideo(token: string, id: string, http: typeof fetch = fetch): Promise<YouTubeVideoInfo | null> {
  const res = await http(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; items?: { id: string; snippet?: { channelId?: string; title?: string; publishedAt?: string }; status?: { privacyStatus?: string; publishAt?: string; madeForKids?: boolean; selfDeclaredMadeForKids?: boolean; containsSyntheticMedia?: boolean } }[] };
  if (!res.ok) throw new Error(`YouTube gaf geen antwoord over deze video: ${json.error?.message ?? res.status}`);
  const item = json.items?.[0];
  if (!item) return null;
  const p = item.status?.privacyStatus;
  return {
    id: item.id,
    channelId: item.snippet?.channelId ?? "",
    title: item.snippet?.title ?? "",
    privacyStatus: p === "public" || p === "unlisted" ? p : "private",
    publishAt: item.status?.publishAt ?? null,
    publishedAt: item.snippet?.publishedAt ?? null,
    madeForKids: item.status?.madeForKids ?? item.status?.selfDeclaredMadeForKids ?? false,
    containsSyntheticMedia: item.status?.containsSyntheticMedia ?? false,
  };
}

// Self-learning Studio (fase 2): spots patterns in what Milan does and turns them into tips he can apply, ignore or
// switch off. Pure functions, shared by the dashboard (tips) and the worker (learning AI suggestions). No browser
// imports here: the worker loads this file too.
import { amsterdamToIso, isoToAmsterdam } from "./publication.ts";

export type StudioEvent = { action: string; screen: string; at: string; channel_id: string | null; metadata: Record<string, unknown> };
export type Preference = { id: string; channel_id: string | null; key: string; value: unknown; updated_at: string };
/** What the tips need of a publication: only the ones Milan really sent to YouTube count. */
export type SentPublication = { video_id: string; channel_id: string; status: string; tags: string[]; updated_at: string };

export type TipKind = "default_tag" | "default_slot" | "hide_fold";
export type Tip = {
  id: string;
  kind: TipKind;
  channelId: string | null;
  text: string;
  /** Why the Studio thinks so, in plain Dutch. */
  because: string;
  apply: { key: string; channelId: string | null; value: unknown };
};

export const FORMAT_WORD: Record<"short" | "long", string> = { short: "Shorts", long: "lange video's" };
const SENT = ["queued", "uploading", "processing", "uploaded", "scheduled", "published"];
const DAY = 86_400_000;
const IGNORE_DAYS = 14;

/** "18:00" in Amsterdam for an ISO time. */
export const amsterdamHhmm = (iso: string) => isoToAmsterdam(iso).slice(11, 16);

/** The next moment at hh:mm in Amsterdam that is at least 15 minutes away (YouTube needs that for scheduling). */
export function nextSlot(hhmm: string, now = Date.now()): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  for (let d = 0; d < 3; d++) {
    const day = isoToAmsterdam(new Date(now + d * DAY).toISOString()).slice(0, 10);
    const iso = amsterdamToIso(`${day}T${hhmm}`);
    if (iso && Date.parse(iso) >= now + 15 * 60_000) return iso;
  }
  return null;
}

// ---- Preferences as the rest of the Studio reads them ----

const prefOf = (prefs: Preference[], key: string, channelId: string | null) => prefs.find((p) => p.key === key && p.channel_id === channelId)?.value;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Default tags for a channel: the ones for all channels first, then the channel's own. */
export function defaultTags(prefs: Preference[], channelId: string | null): string[] {
  const all = [...strings(prefOf(prefs, "default_tags", null)), ...(channelId ? strings(prefOf(prefs, "default_tags", channelId)) : [])];
  const seen = new Set<string>();
  return all.filter((t) => !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase()));
}

/** Default publish time ("18:00") for Shorts or long videos of a channel; null = none (stays Privé without a time). */
export function defaultSlot(prefs: Preference[], channelId: string | null, kind: "short" | "long"): string | null {
  const v = (channelId ? prefOf(prefs, `default_slot:${kind}`, channelId) : undefined) ?? prefOf(prefs, `default_slot:${kind}`, null);
  return typeof v === "string" ? v : null;
}

export const hiddenFolds = (prefs: Preference[]) => strings(prefOf(prefs, "hidden_folds", null));

type TipState = { state: "applied" | "ignored" | "never"; at: string };
function tipState(prefs: Preference[], id: string): TipState | null {
  const v = prefOf(prefs, `tip:${id}`, null) as TipState | undefined;
  return v && typeof v === "object" && "state" in v ? v : null;
}

/** A tip is shown unless it was applied, switched off for good, or ignored less than 14 days ago. */
export function isOpen(prefs: Preference[], id: string, now = Date.now()): boolean {
  const s = tipState(prefs, id);
  if (!s) return true;
  if (s.state === "ignored") return now - Date.parse(s.at) > IGNORE_DAYS * DAY;
  return false;
}

// ---- Spotting patterns ----

/** "Je voegt altijd tag X toe": a tag in at least 4 of the last 5 (or all of the last 3-4) sent videos of a channel. */
function tagTips(pubs: SentPublication[], prefs: Preference[], channelName: (id: string) => string): Tip[] {
  const out: Tip[] = [];
  for (const channelId of new Set(pubs.map((p) => p.channel_id))) {
    const last = pubs.filter((p) => p.channel_id === channelId && SENT.includes(p.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);
    if (last.length < 3) continue;
    const have = new Set(defaultTags(prefs, channelId).map((t) => t.toLowerCase()));
    const counts = new Map<string, { tag: string; n: number }>();
    for (const p of last) for (const t of new Set(p.tags.map((x) => x.trim()).filter(Boolean))) {
      const k = t.toLowerCase();
      counts.set(k, { tag: counts.get(k)?.tag ?? t, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    const needed = last.length >= 5 ? 4 : last.length;
    for (const [k, { tag, n }] of counts) {
      if (n < needed || have.has(k)) continue;
      out.push({
        id: `default_tag:${channelId}:${k}`,
        kind: "default_tag",
        channelId,
        text: `Je voegt altijd de tag "${tag}" toe. Standaard maken?`,
        because: `In ${n} van je laatste ${last.length} video's op ${channelName(channelId)}.`,
        apply: { key: "default_tags", channelId, value: [...strings(prefOf(prefs, "default_tags", channelId)), tag] },
      });
    }
  }
  return out;
}

/** "Je zet Shorts altijd op Openbaar om 18:00": the last 3+ sends of a kind on a channel went public at the same time. */
function slotTips(events: StudioEvent[], prefs: Preference[], channelName: (id: string) => string): Tip[] {
  const out: Tip[] = [];
  const sends = events.filter((e) => e.action === "publish_sent" && e.channel_id && (e.metadata.kind === "short" || e.metadata.kind === "long"));
  const groups = new Map<string, StudioEvent[]>();
  for (const e of sends) groups.set(`${e.channel_id}|${e.metadata.kind}`, [...(groups.get(`${e.channel_id}|${e.metadata.kind}`) ?? []), e]);
  for (const [key, list] of groups) {
    const [channelId, kind] = key.split("|") as [string, "short" | "long"];
    const last = list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
    if (last.length < 3) continue;
    // The moment it went public: the planned time, or the moment of the click for "Nu publiceren" openbaar.
    const moments = last.map((e) => (e.metadata.action === "schedule" && typeof e.metadata.publish_at === "string" ? amsterdamHhmm(e.metadata.publish_at) : e.metadata.action === "publish" && e.metadata.visibility === "public" ? amsterdamHhmm(e.at).slice(0, 2) + ":00" : null));
    if (moments.some((m) => !m) || new Set(moments).size !== 1) continue;
    const hhmm = moments[0]!;
    if (defaultSlot(prefs, channelId, kind) === hhmm) continue;
    out.push({
      id: `default_slot:${channelId}:${kind}:${hhmm}`,
      kind: "default_slot",
      channelId,
      text: `Je zet ${FORMAT_WORD[kind]} altijd op Openbaar om ${hhmm}. Inplannen als standaard?`,
      because: `Je laatste ${last.length} ${FORMAT_WORD[kind]} op ${channelName(channelId)} gingen om ${hhmm} openbaar. Een nieuwe video krijgt dan alvast dat tijdstip; versturen blijft jouw klik.`,
      apply: { key: `default_slot:${kind}`, channelId, value: hhmm },
    });
  }
  return out;
}

/** Parts of the Studio that can be folded away, with the tab they are on (fase 2.2 "verbergen"). */
export const FOLDS: Record<string, { title: string; screen: string }> = {
  "upload.local": { title: "Opnames op de pc", screen: "upload" },
  "upload.maker": { title: "AI Video Maker", screen: "upload" },
  "production.queue": { title: "Wachtrij van de werker", screen: "production" },
  "live.calendar": { title: "Contentkalender", screen: "live" },
  "live.all": { title: "Alle publicaties", screen: "live" },
  "insights.today": { title: "Vandaag in de Studio", screen: "insights" },
  "insights.steps": { title: "Stand van de productielijn", screen: "insights" },
  "insights.formats": { title: "Formats om te testen", screen: "insights" },
};

/** "Je slaat stap Y altijd over": a part on a tab Milan opened at least 8 times in 30 days, but never unfolded. */
function foldTips(events: StudioEvent[], prefs: Preference[], now: number): Tip[] {
  const recent = events.filter((e) => now - Date.parse(e.at) < 30 * DAY);
  const hidden = new Set(hiddenFolds(prefs));
  const out: Tip[] = [];
  for (const [id, fold] of Object.entries(FOLDS)) {
    if (hidden.has(id)) continue;
    const visits = recent.filter((e) => e.action === "tab_opened" && e.screen === fold.screen).length;
    const opened = events.some((e) => e.action === "fold_opened" && e.metadata.fold === id);
    if (visits < 8 || opened) continue;
    out.push({
      id: `hide_fold:${id}`,
      kind: "hide_fold",
      channelId: null,
      text: `Je slaat "${fold.title}" altijd over. Verbergen?`,
      because: `Je opende dit tabblad ${visits} keer in 30 dagen, maar klapte dit onderdeel nooit open. Terugzetten kan bij Instellingen.`,
      apply: { key: "hidden_folds", channelId: null, value: [...hidden, id] },
    });
  }
  return out;
}

export function computeTips(input: { events: StudioEvent[]; prefs: Preference[]; publications: SentPublication[]; channelName: (id: string) => string; now?: number }): Tip[] {
  const now = input.now ?? Date.now();
  return [...tagTips(input.publications, input.prefs, input.channelName), ...slotTips(input.events, input.prefs, input.channelName), ...foldTips(input.events, input.prefs, now)].filter((t) => isOpen(input.prefs, t.id, now));
}

// ---- Learning for the AI suggestions (worker) ----

export type TagHistory = { offered: string[]; final: string[] }[];

/**
 * What Milan did with earlier AI suggestions: tags he kept (liked) and tags he left out or removed (disliked).
 * A tag counts as disliked only when he left it out at least twice and never kept it.
 */
export function learnTags(history: TagHistory, events: StudioEvent[]): { liked: string[]; disliked: string[] } {
  const kept = new Map<string, number>();
  const dropped = new Map<string, number>();
  const bump = (m: Map<string, number>, t: string) => m.set(t.toLowerCase(), (m.get(t.toLowerCase()) ?? 0) + 1);
  for (const h of history) {
    const final = new Set(h.final.map((t) => t.toLowerCase()));
    for (const t of h.offered) bump(final.has(t.toLowerCase()) ? kept : dropped, t);
  }
  for (const e of events) {
    const tags = typeof e.metadata.tag === "string" ? [e.metadata.tag] : strings(e.metadata.tags);
    for (const t of tags) {
      if (e.action === "ai_tag_accepted" || e.action === "tag_added") bump(kept, t);
      if (e.action === "ai_tag_removed" || e.action === "tag_removed") bump(dropped, t);
    }
  }
  const liked = [...kept.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const disliked = [...dropped.entries()].filter(([t, n]) => n >= 2 && !kept.has(t)).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { liked, disliked };
}

/** Titles Milan picked from the AI before: examples of the style he likes. */
export const likedTitles = (events: StudioEvent[]) => [...new Set(events.filter((e) => e.action === "ai_title_used" && typeof e.metadata.title === "string").map((e) => e.metadata.title as string))].slice(0, 5);

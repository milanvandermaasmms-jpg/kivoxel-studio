// Glue between the YouTube sign-in (worker/youtube.ts) and the channel row in Supabase (migration 036).
// Supabase only gets the state of the connection (channel ID, name, picture, times, error), never a token.
import { createClient } from "@supabase/supabase-js";
import type { YouTubeRoutes } from "./server.ts";
import type { ChannelInfo, YouTube } from "./youtube.ts";

export type ChannelRow = { id: string; youtube_channel_id: string | null; youtube_connected_at: string | null; is_default?: boolean };
export type LinkFields = {
  youtube_channel_id?: string | null;
  youtube_title?: string | null;
  youtube_thumbnail_url?: string | null;
  youtube_connected_at?: string | null;
  youtube_synced_at?: string | null;
  youtube_error?: string | null;
};
/** The two database actions this needs; index.ts uses Supabase, the tests a fake. */
export type ChannelDb = {
  get: (id: string) => Promise<ChannelRow | null>;
  connected: () => Promise<ChannelRow | null>;
  update: (id: string, fields: LinkFields) => Promise<void>;
  /** Every linked channel (several channels, fase 0.5); optional so older fakes keep working. */
  connectedAll?: () => Promise<ChannelRow[]>;
};

const MIGRATION_HINT = "Migratie 036 is nog niet uitgevoerd; daarna werkt koppelen.";

export function supabaseChannelDb(url: string, serviceKey: string): ChannelDb {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fail = (message: string): never => {
    throw new Error(/youtube_(title|connected_at|error)|column/i.test(message) ? MIGRATION_HINT : `Database: ${message}`);
  };
  const cols = "id, youtube_channel_id, youtube_connected_at, is_default";
  return {
    async get(id) {
      const { data, error } = await db.from("yt_channels").select(cols).eq("id", id).maybeSingle<ChannelRow>();
      if (error) fail(error.message);
      return data;
    },
    async connected() {
      const { data, error } = await db.from("yt_channels").select(cols).not("youtube_connected_at", "is", null).limit(1).maybeSingle<ChannelRow>();
      if (error) fail(error.message);
      return data;
    },
    async connectedAll() {
      const { data, error } = await db.from("yt_channels").select(cols).not("youtube_connected_at", "is", null).returns<ChannelRow[]>();
      if (error) fail(error.message);
      return data ?? [];
    },
    async update(id, fields) {
      const { error } = await db.from("yt_channels").update(fields).eq("id", id);
      if (!error) return;
      if (error.code === "23505") throw new Error("Dit YouTube-kanaal is al aan een ander kanaal in YouTube Studio gekoppeld.");
      fail(error.message);
    },
  };
}

/** Dutch reason for an error, with what Milan can do about it. */
export function linkError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/invalid_grant/.test(m)) return "De toestemming van Google is verlopen of ingetrokken (in de testmodus na 7 dagen). Klik op Opnieuw koppelen.";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(m)) return "Google is niet bereikbaar. Is er internet? Probeer het later opnieuw.";
  return m;
}

const fields = (c: ChannelInfo, now: string): LinkFields => ({ youtube_channel_id: c.id, youtube_title: c.title.slice(0, 100), youtube_thumbnail_url: c.thumbnail, youtube_synced_at: now, youtube_error: null });

/**
 * forChannel (fase 0.5, only with FEATURE_DREAMNEST): one YouTube sign-in per channel. The default channel (KIVOXEL)
 * keeps `yt` and its existing token file; every other channel gets its own instance (own token file). Without it,
 * exactly one channel can be linked, as before.
 */
export function createYouTubeLink(yt: YouTube, supabase: { url: string; serviceKey: string } | null, dbOverride?: ChannelDb, now = () => new Date().toISOString(), forChannel?: (channelRowId: string) => YouTube): YouTubeRoutes & { sync: () => Promise<string | null>; tokensChannelId: (channelRowId: string) => Promise<string | null>; youtubeFor: (channelRowId: string) => Promise<YouTube> } {
  const db = dbOverride ?? (supabase ? supabaseChannelDb(supabase.url, supabase.serviceKey) : null);
  const pick = (row: ChannelRow): YouTube => (forChannel && !row.is_default ? forChannel(row.id) : yt);
  /** Which instance handed out a sign-in (state from the Google address), so the callback lands in the right one. */
  const signIns = new Map<string, YouTube>();
  /** Does another sign-in on this pc hold tokens for this YouTube channel? (One Google account, several channels.) */
  async function heldElsewhere(inst: YouTube, youtubeChannelId: string): Promise<boolean> {
    if (!forChannel) return false;
    const holders = new Set<YouTube>([yt]);
    for (const r of (await db?.connectedAll?.().catch(() => [] as ChannelRow[])) ?? []) holders.add(pick(r));
    holders.delete(inst);
    for (const h of holders) if ((await h.status()).channelId === youtubeChannelId) return true;
    return false;
  }
  /** Removes a sign-in; never revokes a Google grant another channel still uses. */
  async function drop(inst: YouTube, youtubeChannelId: string | null) {
    if (youtubeChannelId && (await heldElsewhere(inst, youtubeChannelId))) await inst.forget();
    else await inst.disconnect();
  }
  const needDb = () => {
    if (!db) throw new Error("De werker heeft geen Supabase-sleutel; zonder wachtrij kan hij de koppeling niet bewaren.");
    return db;
  };

  return {
    async connect(channelRowId) {
      const d = needDb();
      const row = await d.get(channelRowId);
      if (!row) throw new Error("Dit kanaal bestaat niet (meer).");
      if (!forChannel) {
        const other = await d.connected();
        if (other && other.id !== channelRowId) throw new Error("Er is al een ander kanaal gekoppeld. Meer kanalen tegelijk komen later; ontkoppel dat kanaal eerst.");
        return yt.start(channelRowId);
      }
      const inst = pick(row);
      const url = inst.start(channelRowId);
      const state = new URL(url).searchParams.get("state");
      if (state) signIns.set(state, inst);
      return url;
    },
    async callback(query) {
      try {
        const d = needDb();
        const state = query.get("state") ?? "";
        const inst = signIns.get(state) ?? yt;
        signIns.delete(state);
        const { channelRowId, channel } = await inst.callback(query);
        const row = await d.get(channelRowId);
        if (!row) throw new Error("Dit kanaal bestaat niet (meer).");
        if (forChannel && (await heldElsewhere(inst, channel.id))) {
          await inst.forget();
          throw new Error(`Je koos het YouTube-kanaal "${channel.title}", maar dat hoort al bij een ander kanaal in de Studio. Niets gekoppeld. Klik opnieuw op YouTube koppelen en kies in het scherm van Google het juiste kanaal (heeft je Google-account meer kanalen, dan vraagt Google welk kanaal).`);
        }
        if (row.youtube_channel_id && row.youtube_channel_id !== channel.id) {
          await drop(inst, channel.id);
          throw new Error(`Je logde in met het kanaal "${channel.title}", maar dit kanaal in YouTube Studio hoort bij een ander YouTube-kanaal. Kies bij het inloggen het juiste kanaal.`);
        }
        try {
          const t = now();
          await d.update(channelRowId, { ...fields(channel, t), youtube_connected_at: t });
        } catch (e) {
          await drop(inst, channel.id); // nothing half-linked: without the database row the tokens are not kept either
          throw e;
        }
        return { ok: true, message: `Gekoppeld met het YouTube-kanaal "${channel.title}" (${channel.id}).` };
      } catch (e) {
        return { ok: false, message: linkError(e) };
      }
    },
    async status(channelRowId?: string) {
      if (!forChannel || !channelRowId || !db) return yt.status();
      const row = await db.get(channelRowId);
      return (row ? pick(row) : yt).status();
    },
    /** Fase 5: the sign-in of this channel (KIVOXEL's own for the default channel). */
    async youtubeFor(channelRowId: string): Promise<YouTube> {
      const row = db ? await db.get(channelRowId) : null;
      return row ? pick(row) : yt;
    },
    async tokensChannelId(channelRowId) {
      const row = forChannel && db ? await db.get(channelRowId) : null;
      return (await (row ? pick(row) : yt).status()).channelId;
    },
    async disconnect(channelRowId) {
      const row = forChannel && db ? await db.get(channelRowId) : null;
      const inst = row ? pick(row) : yt;
      await drop(inst, (await inst.status()).channelId);
      // Before anything is published the channel may be linked to another YouTube channel; publications (D2+) keep their own video IDs.
      await needDb().update(channelRowId, { youtube_channel_id: null, youtube_title: null, youtube_thumbnail_url: null, youtube_connected_at: null, youtube_synced_at: null, youtube_error: null });
    },
    /** At start: check the connection still works and refresh name and picture (1 quota unit). */
    async sync() {
      if (forChannel && db?.connectedAll && yt.configured) {
        const rows = await db.connectedAll().catch(() => [] as ChannelRow[]);
        const out: string[] = [];
        for (const row of rows) out.push((await syncOne(pick(row), row)) ?? "");
        return out.filter(Boolean).join("; ") || null;
      }
      if (!db || !yt.configured || !(await yt.status()).connected) return null;
      const row = await db.connected().catch(() => null);
      if (!row) return null;
      return syncOne(yt, row);
    },
  };

  async function syncOne(inst: YouTube, row: ChannelRow): Promise<string | null> {
      if (!db || !(await inst.status()).connected) return null;
      try {
        const channel = await inst.myChannel();
        if (row.youtube_channel_id && row.youtube_channel_id !== channel.id) throw new Error("De tokens horen bij een ander YouTube-kanaal dan gekoppeld. Ontkoppel en koppel opnieuw.");
        await db.update(row.id, fields(channel, now()));
        return `gekoppeld met "${channel.title}"`;
      } catch (e) {
        const message = linkError(e);
        await db.update(row.id, { youtube_error: message.slice(0, 500) }).catch(() => undefined);
        return `koppeling werkt niet: ${message}`;
      }
  }
}

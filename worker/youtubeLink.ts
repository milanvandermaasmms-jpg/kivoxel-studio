// Glue between the YouTube sign-in (worker/youtube.ts) and the channel row in Supabase (migration 036).
// Supabase only gets the state of the connection (channel ID, name, picture, times, error), never a token.
import { createClient } from "@supabase/supabase-js";
import type { YouTubeRoutes } from "./server.ts";
import type { ChannelInfo, YouTube } from "./youtube.ts";

export type ChannelRow = { id: string; youtube_channel_id: string | null; youtube_connected_at: string | null };
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
};

const MIGRATION_HINT = "Migratie 036 is nog niet uitgevoerd; daarna werkt koppelen.";

export function supabaseChannelDb(url: string, serviceKey: string): ChannelDb {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fail = (message: string): never => {
    throw new Error(/youtube_(title|connected_at|error)|column/i.test(message) ? MIGRATION_HINT : `Database: ${message}`);
  };
  const cols = "id, youtube_channel_id, youtube_connected_at";
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

export function createYouTubeLink(yt: YouTube, supabase: { url: string; serviceKey: string } | null, dbOverride?: ChannelDb, now = () => new Date().toISOString()): YouTubeRoutes & { sync: () => Promise<string | null> } {
  const db = dbOverride ?? (supabase ? supabaseChannelDb(supabase.url, supabase.serviceKey) : null);
  const needDb = () => {
    if (!db) throw new Error("De werker heeft geen Supabase-sleutel; zonder wachtrij kan hij de koppeling niet bewaren.");
    return db;
  };

  return {
    async connect(channelRowId) {
      const d = needDb();
      if (!(await d.get(channelRowId))) throw new Error("Dit kanaal bestaat niet (meer).");
      const other = await d.connected();
      if (other && other.id !== channelRowId) throw new Error("Er is al een ander kanaal gekoppeld. Meer kanalen tegelijk komen later; ontkoppel dat kanaal eerst.");
      return yt.start(channelRowId);
    },
    async callback(query) {
      try {
        const d = needDb();
        const { channelRowId, channel } = await yt.callback(query);
        const row = await d.get(channelRowId);
        if (!row) throw new Error("Dit kanaal bestaat niet (meer).");
        if (row.youtube_channel_id && row.youtube_channel_id !== channel.id) {
          await yt.disconnect();
          throw new Error(`Je logde in met het kanaal "${channel.title}", maar dit kanaal in YouTube Studio hoort bij een ander YouTube-kanaal. Kies bij het inloggen het juiste kanaal.`);
        }
        try {
          const t = now();
          await d.update(channelRowId, { ...fields(channel, t), youtube_connected_at: t });
        } catch (e) {
          await yt.disconnect(); // nothing half-linked: without the database row the tokens are not kept either
          throw e;
        }
        return { ok: true, message: `Gekoppeld met het YouTube-kanaal "${channel.title}" (${channel.id}).` };
      } catch (e) {
        return { ok: false, message: linkError(e) };
      }
    },
    async status() {
      return yt.status();
    },
    async disconnect(channelRowId) {
      await yt.disconnect();
      // Before anything is published the channel may be linked to another YouTube channel; publications (D2+) keep their own video IDs.
      await needDb().update(channelRowId, { youtube_channel_id: null, youtube_title: null, youtube_thumbnail_url: null, youtube_connected_at: null, youtube_synced_at: null, youtube_error: null });
    },
    /** At start: check the connection still works and refresh name and picture (1 quota unit). */
    async sync() {
      if (!db || !yt.configured || !(await yt.status()).connected) return null;
      const row = await db.connected().catch(() => null);
      if (!row) return null;
      try {
        const channel = await yt.myChannel();
        if (row.youtube_channel_id && row.youtube_channel_id !== channel.id) throw new Error("De tokens horen bij een ander YouTube-kanaal dan gekoppeld. Ontkoppel en koppel opnieuw.");
        await db.update(row.id, fields(channel, now()));
        return `gekoppeld met "${channel.title}"`;
      } catch (e) {
        const message = linkError(e);
        await db.update(row.id, { youtube_error: message.slice(0, 500) }).catch(() => undefined);
        return `koppeling werkt niet: ${message}`;
      }
    },
  };
}

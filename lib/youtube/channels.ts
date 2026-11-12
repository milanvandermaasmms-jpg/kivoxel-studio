// Channels (migration 032): the base for several YouTube channels later. Today one channel, PixelRush.
import { friendlyError, supabase } from "../supabase";

export type Channel = {
  id: string;
  name: string;
  is_default: boolean;
  status: "active" | "paused" | "planned";
  language: "en" | "nl";
  audience: string | null;
  brand_color: string | null;
  youtube_channel_id: string | null;
  /** Migration 036; undefined while it has not run. Only the worker writes these. */
  youtube_title?: string | null;
  youtube_thumbnail_url?: string | null;
  youtube_connected_at?: string | null;
  youtube_synced_at?: string | null;
  youtube_error?: string | null;
};
export type ChannelEdit = Pick<Channel, "name" | "status" | "language" | "audience" | "brand_color">;

export const CHANNEL_STATUS: Record<Channel["status"], string> = { active: "Actief", paused: "Gepauzeerd", planned: "Gepland" };

/** null while migration 032 has not run. */
export async function loadChannels(studioId: string): Promise<Channel[] | null> {
  const { data, error } = await supabase
    .from("yt_channels")
    .select("*")
    .eq("studio_id", studioId)
    .order("is_default", { ascending: false })
    .order("created_at")
    .returns<Channel[]>();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /could not find|does not exist/i.test(error.message)) return null;
    throw new Error(friendlyError(error.message));
  }
  return data ?? [];
}

/** Checks the fields before saving; returns a Dutch message, or null when all is well. */
export function channelProblem(c: ChannelEdit): string | null {
  if (!c.name.trim() || c.name.trim().length > 60) return "Geef het kanaal een naam van 1 tot 60 tekens.";
  if (c.audience && c.audience.length > 300) return "De doelgroep mag hoogstens 300 tekens zijn.";
  if (c.brand_color && !/^#[0-9a-fA-F]{6}$/.test(c.brand_color)) return "Kies een merkkleur zoals #22aa55.";
  return null;
}

export async function saveChannel(id: string, c: ChannelEdit): Promise<void> {
  const problem = channelProblem(c);
  if (problem) throw new Error(problem);
  const { error } = await supabase
    .from("yt_channels")
    .update({ name: c.name.trim(), status: c.status, language: c.language, audience: c.audience?.trim() || null, brand_color: c.brand_color || null })
    .eq("id", id);
  if (error) throw new Error(friendlyError(error.message));
}

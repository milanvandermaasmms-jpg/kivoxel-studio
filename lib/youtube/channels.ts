// Channels (migration 032) with a profile per channel (migration 045): KIVOXEL, Dreamnest NL and later more.
import { friendlyError, supabase } from "../supabase";

export type ChannelMode = "upload" | "generate" | "hybrid";
export type SafetyProfile = "kids_gaming" | "infant_sleep" | "general";
export type Providers = { llm?: string; tts?: string; music?: string; video?: string };

export type Channel = {
  id: string;
  name: string;
  is_default: boolean;
  status: "active" | "paused" | "planned";
  language: "en" | "nl";
  audience: string | null;
  brand_color: string | null;
  youtube_channel_id: string | null;
  made_for_kids?: boolean | null;
  /** Migration 036; undefined while it has not run. Only the worker writes these. */
  youtube_title?: string | null;
  youtube_thumbnail_url?: string | null;
  youtube_connected_at?: string | null;
  youtube_synced_at?: string | null;
  youtube_error?: string | null;
  /** Migration 045; undefined while it has not run. providers is only changed by the server. */
  slug?: string | null;
  mode?: ChannelMode;
  safety_profile?: SafetyProfile;
  banned_words?: string[];
  synthetic_media?: boolean;
  concept_auto_approve?: boolean;
  publish_slots?: string[];
  providers?: Providers;
};
export type ChannelEdit = Pick<Channel, "name" | "status" | "language" | "audience" | "brand_color">;
export type ProfileEdit = { slug: string; mode: ChannelMode; safety_profile: SafetyProfile; made_for_kids: boolean | null; synthetic_media: boolean; banned_words: string[]; publish_slots: string[]; concept_auto_approve: boolean };

export const CHANNEL_STATUS: Record<Channel["status"], string> = { active: "Actief", paused: "Gepauzeerd", planned: "Gepland" };
export const CHANNEL_MODE: Record<ChannelMode, string> = { upload: "Upload (eigen opnames)", generate: "Genereren (volledig AI)", hybrid: "Allebei" };
export const SAFETY_PROFILE: Record<SafetyProfile, string> = { kids_gaming: "Kinderen en gaming", infant_sleep: "Baby's en slapen", general: "Algemeen" };
const PROVIDER_LABEL: Record<string, string> = { gemini: "Gemini", google: "Google-stem", none: "uit", claude: "Claude", elevenlabs: "ElevenLabs", suno: "Suno", kling: "Kling", veo: "Veo", runway: "Runway" };

/** "Denken: Gemini · Stem: Google-stem · Muziek: uit · Video: uit". */
export function providersText(p: Providers | undefined): string {
  const name = (v: string | undefined) => (v ? (PROVIDER_LABEL[v] ?? v) : "uit");
  return `Denken: ${name(p?.llm)} · Stem: ${name(p?.tts)} · Muziek: ${name(p?.music)} · Video: ${name(p?.video)}`;
}

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

export type NewChannel = { name: string; slug: string; language: "en" | "nl"; safety_profile: SafetyProfile };

/** What is wrong with a new channel, or null. The slug becomes its address (/studio/<slug>) and folder name. */
export function newChannelProblem(c: NewChannel, existing: { name: string; slug?: string | null }[]): string | null {
  if (!c.name.trim() || c.name.trim().length > 60) return "Geef het kanaal een naam (hoogstens 60 tekens).";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug) || c.slug.length > 40) return "De korte naam mag alleen kleine letters, cijfers en streepjes hebben.";
  if (["kivoxel", "dreamnest"].includes(c.slug) || existing.some((e) => e.slug === c.slug)) return "Deze korte naam is al in gebruik.";
  if (existing.some((e) => e.name.trim().toLowerCase() === c.name.trim().toLowerCase())) return "Er is al een kanaal met deze naam.";
  return null;
}

/** "+ Kanaal" (fase 0.5): a new channel starts as planned, without YouTube link; a sleep channel is made for kids. */
export async function addChannel(studioId: string, c: NewChannel, existing: Channel[]): Promise<void> {
  const problem = newChannelProblem(c, existing);
  if (problem) throw new Error(problem);
  const sleep = c.safety_profile === "infant_sleep";
  const { error } = await supabase.from("yt_channels").insert({
    studio_id: studioId,
    name: c.name.trim(),
    slug: c.slug,
    status: "planned",
    language: c.language,
    mode: sleep ? "generate" : "upload",
    safety_profile: c.safety_profile,
    made_for_kids: c.safety_profile === "general" ? null : true,
    synthetic_media: sleep,
  });
  if (error) throw new Error(friendlyError(error.message));
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

/** "geneest, IQ\ntherapie" -> ["geneest", "IQ", "therapie"]; empty parts and doubles (any case) are dropped. */
export function parseWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const w = raw.trim().replace(/\s+/g, " ");
    if (w && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w);
  }
  return out;
}

/** "19:00, 8.30" -> ["08:30", "19:00"]; a part that is no time of day stays as typed, so profileProblem names it. */
export function parseSlots(text: string): string[] {
  const out = text
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((s) => {
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
      return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : s;
    });
  return [...new Set(out)].sort();
}

/** Same rules as the database (migration 045); a Dutch message or null. */
export function profileProblem(p: ProfileEdit): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > 40) return "De korte naam (map) mag alleen kleine letters, cijfers en streepjes hebben, bijvoorbeeld dreamnest-nl.";
  if (p.banned_words.length > 100) return "Hoogstens 100 verboden woorden.";
  if (p.banned_words.join("|").length > 3000) return "De verboden woorden zijn samen te lang.";
  if (p.publish_slots.length > 6) return "Hoogstens 6 publicatietijden.";
  const wrong = p.publish_slots.find((s) => !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s));
  if (wrong) return `"${wrong}" is geen tijd. Schrijf bijvoorbeeld 19:00.`;
  return null;
}

export async function saveProfile(id: string, p: ProfileEdit): Promise<void> {
  const problem = profileProblem(p);
  if (problem) throw new Error(problem);
  const { error } = await supabase.from("yt_channels").update(p).eq("id", id);
  if (error) throw new Error(error.code === "23505" ? "Een ander kanaal heeft deze korte naam al." : friendlyError(error.message));
}

/** The words of a channel's banned list that appear in a text (whole words, any case). */
export function bannedIn(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  return words.filter((w) => {
    const escaped = w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(lower);
  });
}

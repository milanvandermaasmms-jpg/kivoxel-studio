// KIVOXEL fase 1: all "taste" (audio modes, lengths, hooks, persona) lives in config/kivoxel/*.json, not in code.
// This module reads those files (bundled as JSON imports), merges a preset over the base and checks the values,
// so a typo in a config file shows up as a clear Dutch message instead of a strange montage.
import presetsJson from "../../config/kivoxel/presets.json" with { type: "json" };
import hooksJson from "../../config/kivoxel/hooks.json" with { type: "json" };
import personaJson from "../../config/kivoxel/voice_persona.json" with { type: "json" };

/** KIVOXEL video content is English, always (Milan, 16-11-2026). Only the Studio UI is Dutch. */
export type Language = "en";
export const VIDEO_LANGUAGE: Language = "en";
export const AUDIO_MODES = ["vo_muziek", "muziek_geen_vo", "alleen_game"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];
export const EVENT_TYPES = ["fail", "bijna_dood", "geluk", "bouw", "grap", "jumpscare"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type AudioModeSpec = { label: string; voice: boolean; music: boolean; game: boolean; game_db: number; music_db: number | null; duck_db: number | null; storytelling: string; /** Story as text in the picture when there is no voice (default true). */ text_story?: boolean; /** Sound effects layer (default true). */ sfx?: boolean };
export type LengthBucket = { key: string; label: string; min_ms: number; max_ms: number; needs_buildup?: boolean };
export type Settings = {
  audio_mode: AudioMode;
  audio_modes: Record<AudioMode, AudioModeSpec>;
  sync: { lead_min_ms: number; lead_max_ms: number; peak_quiet_ms: number; max_speed: number; max_attempts: number };
  mix: { target_lufs: number; lufs_tolerance: number; true_peak_db: number; voice_chain: { highpass_hz: number; presence_db: number; compress_ratio: number; room_reverb_mix: number } };
  shorts: { width: number; height: number; fps: "source" | number; safe_zone: { top_px: number; bottom_px: number; right_px: number; left_px: number }; length_buckets: LengthBucket[]; no_same_bucket_in_a_row: boolean; first_action_max_ms: number };
  long: { width: number; height: number; chapters: boolean; visual_reset_ms: [number, number] };
  hooks: { max_words: number; min_words: number; no_repeat_within: number; pop_in_ms: number; shake_on_payoff: boolean };
  features: {
    hook_first_second: boolean; payoff_tease: boolean; cut_dead_air: boolean; max_pause_ms: number; pattern_interrupts: boolean;
    interrupt_every_ms: [number, number]; interrupts: string[]; word_captions: boolean; loop_ending: boolean; sfx_layer: boolean; cold_open: boolean; kids_reactions: boolean;
  };
  variation: { zoom_styles: string[]; caption_styles: string[]; transitions: string[]; music_no_repeat_within: number; sfx_no_repeat_within: number; opener_no_repeat_within: number };
  voice: { local_order: ("kokoro" | "piper" | "windows")[]; kokoro_voice: string; /** Cloned voice (Chatterbox): first choice when `use`; `boost` makes it livelier. */ clone: { use: boolean; shorts_only: boolean; boost: number; /** Google voice that speaks the line first (American pronunciation); its voice colour then becomes the kid's. Empty = Chatterbox speaks itself. */ pronunciation?: string } };
  music: { library_dir: string; beat_sync: boolean; fade_in_ms: number; fade_out_ms: number };
  sfx: { library_dir: string };
};
export type PresetFile = { version: number; channel_default: { preset: string; audio_mode: AudioMode; engine: "auto" | "free" }; base: Settings; presets: Record<string, { label: string } & Record<string, unknown>> };
export type HookFile = { version: number; event_types: Record<EventType, { label: string; from_moments: string[] }>; hooks: Record<EventType, string[]>; /** Only when the player really dies (otherwise clickbait). */ death_only?: string[] };
export type Persona = typeof personaJson;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Objects merge key by key; everything else (numbers, lists) is replaced as a whole. Keys starting with "$" are comments. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith("$")) continue;
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export const presetFile = presetsJson as unknown as PresetFile;
export const hookFile = hooksJson as unknown as HookFile;
export const persona: Persona = personaJson;

export const presetNames = () => Object.keys(presetFile.presets);

/** The settings of one preset (unknown name: the channel default), optionally with a different audio mode for one video. */
export function resolveSettings(preset?: string | null, audioMode?: AudioMode | null, file: PresetFile = presetFile): Settings & { preset: string } {
  const name = preset && file.presets[preset] ? preset : file.channel_default.preset;
  const { label: _label, ...over } = file.presets[name] ?? { label: name };
  const merged = deepMerge(file.base, over);
  return { ...merged, audio_mode: audioMode && AUDIO_MODES.includes(audioMode) ? audioMode : merged.audio_mode, preset: name };
}

export const words = (text: string) => text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** Every problem in the config files, in Dutch. Empty = all good. Runs in the tests and when the worker starts. */
export function configProblems(file: PresetFile = presetFile, hooks: HookFile = hookFile): string[] {
  const out: string[] = [];
  if (!file.presets[file.channel_default.preset]) out.push(`Standaard-preset "${file.channel_default.preset}" bestaat niet.`);
  for (const name of Object.keys(file.presets)) {
    const s = resolveSettings(name, null, file);
    const where = `Preset "${name}"`;
    if (!AUDIO_MODES.includes(s.audio_mode)) out.push(`${where}: onbekende audio-modus "${s.audio_mode}".`);
    for (const m of AUDIO_MODES) {
      const spec = s.audio_modes[m];
      if (!spec) out.push(`${where}: audio-modus "${m}" ontbreekt.`);
      else if (spec.music && spec.music_db === null) out.push(`${where}: "${m}" heeft muziek maar geen music_db.`);
    }
    if (s.sync.lead_min_ms >= s.sync.lead_max_ms) out.push(`${where}: lead_min_ms moet kleiner zijn dan lead_max_ms.`);
    if (s.sync.max_speed > 1.08) out.push(`${where}: de stem mag niet sneller dan 1,08x.`);
    const b = s.shorts.length_buckets;
    for (let i = 0; i < b.length; i++) {
      if (b[i].min_ms >= b[i].max_ms) out.push(`${where}: lengte-bucket "${b[i].key}" heeft min >= max.`);
      if (i && b[i].min_ms <= b[i - 1].max_ms) out.push(`${where}: lengte-buckets "${b[i - 1].key}" en "${b[i].key}" overlappen.`);
    }
    if (b.length && b[b.length - 1].max_ms > 59_000) out.push(`${where}: een Short mag niet langer dan 59 s.`);
    const [lo, hi] = s.features.interrupt_every_ms;
    if (!(lo > 0 && lo <= hi)) out.push(`${where}: interrupt_every_ms moet [laag, hoog] zijn.`);
  }
  for (const t of EVENT_TYPES) {
    const list = hooks.hooks[t] ?? [];
    if (!Array.isArray(list)) out.push(`Hooks "${t}": moet één Engelse lijst zijn.`);
    else {
      // Never more than once per 10 Shorts: so at least that many hooks per type.
      // With the last N used blocked there must still be one left, also without the death-only hooks.
      const need = file.base.hooks.no_repeat_within + 1;
      const usable = list.filter((h) => !(hooks.death_only ?? []).includes(h)).length;
      if (usable < need) out.push(`Hooks "${t}": minstens ${need} nodig zonder de dood-hooks (nu ${usable}), anders komt dezelfde hook binnen ${need - 1} Shorts terug.`);
      for (const h of list) {
        const n = words(h).length;
        const { min_words: lo, max_words: hi } = file.base.hooks;
        if (n < lo || n > hi) out.push(`Hook "${h}" heeft ${n} woorden (${lo}-${hi}).`);
        if (h !== h.toUpperCase()) out.push(`Hook "${h}" staat niet in HOOFDLETTERS.`);
        if (looksDutch(h)) out.push(`Hook "${h}" lijkt Nederlands: video's zijn altijd Engels.`);
      }
      if (new Set(list).size !== list.length) out.push(`Hooks "${t}" bevatten een dubbele.`);
    }
  }
  return out;
}

/** A guard against Dutch slipping into video content: common Dutch words that never appear in English hooks or lines. */
const DUTCH = /\b(de|het|een|niet|wacht|hij|zijn|dit|dat|nog|maar|geen|echt|kijk|oké|nee|ik|je|wat|hoe|waarom|bijna|hartjes?|fout|dood|hierop)\b/i;
export const looksDutch = (text: string) => DUTCH.test(text);

/** Which hook type fits a moment kind from the analysis (yt_moments.kind). */
export function eventTypeForMoment(kind: string, hooks: HookFile = hookFile): EventType {
  for (const t of EVENT_TYPES) if (hooks.event_types[t]?.from_moments.includes(kind)) return t;
  return "bijna_dood";
}

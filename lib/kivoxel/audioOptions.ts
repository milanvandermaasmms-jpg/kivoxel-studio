// 23-11-2026 (Milan, superprompt V6, fase 31): three audio options for every video and Short, really playable, plus his
// own combination of voice, music and sound effects. A preview is the same montage (same script, same picture) with
// other audio, rendered as a separate file on the pc: no new version, no status change, no place in the voice split.
// Choosing one makes the real version with that audio. Configurable per channel (Dreamnest has its own set). Pure, tested.

export type VoiceChoice = "A" | "B" | "C" | "geen";
export type MusicChoice = "A" | "B" | "C" | "geen";
export type SfxChoice = "subtiel" | "gebalanceerd" | "dynamisch";
export type AudioChoice = { voice: VoiceChoice; music: MusicChoice; sfx: SfxChoice };
export type Variant = "A" | "B" | "C" | "eigen";

/** Per channel: what voice A/B/C and music A/B/C mean. */
export type AudioSet = {
  voices: Record<"A" | "B" | "C", { label: string; payload: { voice: "kloon" | "google"; voice_name?: string } }>;
  music: Record<"A" | "B" | "C", { label: string; pick: "auto" | "energiek" | "rustig" }>;
  variants: Record<"A" | "B" | "C", { label: string; why: string; choice: AudioChoice }>;
};

export const GAMING_SET: AudioSet = {
  voices: {
    A: { label: "Stem A: eigen stem (kloon)", payload: { voice: "kloon" } },
    B: { label: "Stem B: Fenrir (enthousiast)", payload: { voice: "google", voice_name: "en-US-Chirp3-HD-Fenrir" } },
    C: { label: "Stem C: Charon (rustig)", payload: { voice: "google", voice_name: "en-US-Chirp3-HD-Charon" } },
  },
  music: {
    A: { label: "Muziek A: past bij de momenten (automatisch)", pick: "auto" },
    B: { label: "Muziek B: energiek", pick: "energiek" },
    C: { label: "Muziek C: rustig", pick: "rustig" },
  },
  variants: {
    A: { label: "A · Aanbevolen", why: "Wat de studio het best vindt passen: stem volgens de stemverdeling, muziek die meewisselt met de momenten, gebalanceerde effecten.", choice: { voice: "A", music: "A", sfx: "gebalanceerd" } },
    B: { label: "B · Energiek", why: "Meer energie: enthousiaste stem, energieke muziek, sterkere effecten op de hoogtepunten.", choice: { voice: "B", music: "B", sfx: "dynamisch" } },
    C: { label: "C · Naturel", why: "Meer gamegeluid: geen stem, rustige muziek op de achtergrond, weinig effecten.", choice: { voice: "geen", music: "C", sfx: "subtiel" } },
  },
};

/** "A · Aanbevolen" follows the automatic voice split: the voice is then decided by the worker. */
export const AUTO_VOICE = "auto";

/** The render job payload for a choice (preview or final). */
export function audioPayload(set: AudioSet, c: AudioChoice, variant: Variant | null, opts: { autoVoice?: boolean } = {}): Record<string, unknown> {
  const noVoice = c.voice === "geen";
  const noMusic = c.music === "geen";
  const audio_mode = noVoice ? (noMusic ? "alleen_game" : "muziek_geen_vo") : "vo_muziek";
  return {
    ...(variant ? { preview: variant } : {}),
    // "A" with autoVoice: let the worker's voice split decide (no audio_mode), exactly like a normal montage.
    ...(opts.autoVoice && variant === "A" ? {} : { audio_mode }),
    ...(noVoice ? {} : set.voices[c.voice as "A" | "B" | "C"].payload),
    music_pick: noMusic ? "none" : set.music[c.music as "A" | "B" | "C"].pick,
    sfx_level: c.sfx,
    audio_choice: c,
  };
}

/** What the worker does with sfx_level: how many effects are kept and how loud. */
export function sfxAdjust<T extends { db: number }>(cues: T[], level: SfxChoice | undefined): T[] {
  if (level === "subtiel") return [...cues].sort((a, b) => b.db - a.db).slice(0, Math.max(1, Math.ceil(cues.length / 2))).map((c) => ({ ...c, db: c.db - 4 }));
  if (level === "dynamisch") return cues.map((c) => ({ ...c, db: c.db + 3 }));
  return cues;
}

/** What the worker does with music_pick: the library narrowed to energetic or calm tracks (the whole library if none fit). */
export function musicPick<T extends { energy: number; moods: readonly string[] }>(library: T[], pick: string | undefined): { tracks: T[]; note: string | null } {
  if (pick === "energiek") {
    const t = library.filter((x) => x.energy >= 4 || x.moods.some((m) => m === "hype" || m === "epic"));
    return t.length ? { tracks: t, note: `Muziek B (energiek): ${t.length} tracks` } : { tracks: library, note: "Geen energieke track in de bibliotheek; automatische keuze" };
  }
  if (pick === "rustig") {
    const t = library.filter((x) => x.energy <= 2 || x.moods.includes("chill"));
    return t.length ? { tracks: t, note: `Muziek C (rustig): ${t.length} tracks` } : { tracks: library, note: "Geen rustige track in de bibliotheek; automatische keuze" };
  }
  return { tracks: library, note: null };
}

export const choiceLabel = (set: AudioSet, c: AudioChoice) => [c.voice === "geen" ? "geen stem" : set.voices[c.voice].label.split(":")[0], c.music === "geen" ? "geen muziek" : set.music[c.music].label.split(":")[0], `effecten ${c.sfx}`].join(" · ");

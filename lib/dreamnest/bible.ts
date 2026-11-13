// Dreamnest fase 1: character bible, scene packs and shots. Pure functions, tested.
// The files live in content/dreamnest/ (characters/*.json, sets/*.json, shots/*.json).

export type Character = {
  id: string;
  name: string;
  pronouns: string;
  /** Fixed description that goes into every prompt with this character, word for word. */
  prompt_dna: string;
  palette: Record<string, string>;
  proportions: string;
  expressions: string[];
  never: string[];
  /** Paths relative to content/dreamnest/characters/. Empty until Milan approved a design. */
  reference_images: string[];
};

export type SetPack = {
  id: string;
  name: string;
  prompt_dna: string;
  layers: { background: string; middle: string; foreground: string };
  lights: string[];
  ambient_motion: string[];
  sounds: string[];
  palette: Record<string, string>;
  /** Paths relative to content/dreamnest/sets/: the approved set plate, sent along with keyframes in this set. */
  reference_images?: string[];
};

export type Shot = {
  id: string;
  /** "a": designs (bible, set plate); "b": keyframes that need approved designs first. */
  stage: "a" | "b";
  kind: "character_sheet" | "set_plate" | "keyframe";
  characters: string[];
  set: string | null;
  description: string;
  aspect: "1:1" | "16:9" | "9:16";
  size: "1K" | "2K";
  variants: number;
};

/** The house style every Dreamnest image shares: soft, round, slow, never scary. */
export const STYLE_DNA =
  "Warm cinematic 3D animation still, soft felt and plush textures, gentle volumetric light, warm rim light, cosy bedtime mood, " +
  "rounded friendly shapes, low contrast, soft muted saturation, no harsh shadows, nothing scary, child-safe, no text, no letters, no logos, no watermark.";

export function buildPrompt(shot: Shot, characters: Character[], set: SetPack | null): string {
  const cast = shot.characters.map((id) => {
    const c = characters.find((x) => x.id === id);
    if (!c) throw new Error(`Onbekend personage: ${id}`);
    return `${c.name}: ${c.prompt_dna} Never: ${c.never.join("; ")}.`;
  });
  const parts = [STYLE_DNA, shot.description];
  if (set) parts.push(`Setting: ${set.prompt_dna} Background: ${set.layers.background}. Middle: ${set.layers.middle}. Foreground: ${set.layers.foreground}.`);
  if (cast.length) parts.push(`Characters (match the reference images exactly in shape, colour and proportions):\n${cast.join("\n")}`);
  return parts.join("\n\n");
}

/** Character consistency: accept at or above the threshold, otherwise retry up to maxAttempts, then Milan decides. */
export function consistencyDecision(score: number, attempt: number, threshold = 80, maxAttempts = 3): "accept" | "retry" | "to_milan" {
  if (score >= threshold) return "accept";
  return attempt < maxAttempts ? "retry" : "to_milan";
}

/** Worst case cost of a shot list in cents: every variant may need every attempt. */
export function worstCaseCents(shots: Shot[], centsPerImage: (size: Shot["size"]) => number, maxAttempts = 3): number {
  return shots.reduce((sum, s) => sum + s.variants * (s.characters.length ? maxAttempts : 1) * centsPerImage(s.size), 0);
}

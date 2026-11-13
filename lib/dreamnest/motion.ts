// Dreamnest fase 2: clip plan from the chosen keyframes, and the baby-safe checks on a finished clip.
// Pure functions, tested. The worker measures with FFmpeg; these rules decide.

export type Clip = {
  id: string;
  kind: "story" | "loop";
  first: string;
  /** Story: the next keyframe. Loop: the same frame as first, so the clip repeats seamlessly. */
  last: string;
  durationS: number;
  prompt: string;
};

/** Every Dreamnest clip: slow lullaby tempo, almost still camera, nothing sudden. */
export const MOTION_DNA =
  "Very slow, gentle, soothing motion at lullaby tempo. The camera is almost still (at most a very slow drift). No cuts, no flashes, " +
  "no sudden or fast movement, no flickering lights, no camera shake, constant soft lighting. Characters move softly and breathe slowly. " +
  "Keep every character exactly as in the images. No text. Quiet: no dialogue, no music.";

/** First/last-frame mode of Gemini Omni allows 3-10 s (docs 13-11-2026). */
export const FRAME_MODE_MAX_S = 10;

export function planClips(keyframes: { shot: string; motion: string; loop?: string }[], storyS = 8, loopS = 8): Clip[] {
  const clips: Clip[] = [];
  keyframes.forEach((k, i) => {
    const next = keyframes[i + 1];
    if (next) clips.push({ id: `story-${k.shot}`, kind: "story", first: k.shot, last: next.shot, durationS: clamp(storyS), prompt: `${MOTION_DNA}\n\nFrom the first image to the last image: ${k.motion} Then ease gently into the scene of the last image.` });
    if (k.loop) clips.push({ id: `loop-${k.shot}`, kind: "loop", first: k.shot, last: k.shot, durationS: clamp(loopS), prompt: `${MOTION_DNA}\n\nA seamless loop that starts and ends on exactly this image: ${k.loop}` });
  });
  return clips;
}
const clamp = (s: number) => Math.max(3, Math.min(FRAME_MODE_MAX_S, Math.round(s)));

export type ClipMeasure = {
  durationS: number;
  /** Average luma per frame, 0-255. */
  luma: number[];
  fps: number;
  /** SSIM between the first and the last frame (1 = identical); only for loops. */
  seamSsim: number | null;
};

export type SafetyResult = { ok: boolean; problems: string[]; maxJump: number; flashesPerSecond: number };

/**
 * Baby-safe rules (megaprompt §4), stricter than the usual photosensitivity guideline (max 3 flashes per second):
 * - a "flash" is a luma change of more than 10% (25 of 255) between two frames; none allowed at all;
 * - average brightness stays soft (no frame above 200 of 255);
 * - a loop's last frame matches its first (SSIM >= 0.95), otherwise the seam is visible.
 */
export function judgeClip(m: ClipMeasure, kind: Clip["kind"]): SafetyResult {
  const problems: string[] = [];
  let maxJump = 0;
  let flashes = 0;
  for (let i = 1; i < m.luma.length; i++) {
    const jump = Math.abs(m.luma[i] - m.luma[i - 1]);
    maxJump = Math.max(maxJump, jump);
    if (jump > 25) flashes++;
  }
  const flashesPerSecond = m.durationS > 0 ? flashes / m.durationS : 0;
  if (flashes > 0) problems.push(`${flashes} flits(en): helderheid springt tot ${Math.round(maxJump)} van 255 tussen twee beelden`);
  if (m.luma.some((l) => l > 200)) problems.push("te fel: een beeld is helderder dan 200 van 255");
  if (kind === "loop") {
    if (m.seamSsim === null) problems.push("naad niet gemeten");
    else if (m.seamSsim < 0.95) problems.push(`zichtbare naad: begin en eind lijken ${Math.round(m.seamSsim * 100)}% op elkaar (minimaal 95%)`);
  }
  if (m.durationS < 2.5) problems.push(`te kort: ${m.durationS.toFixed(1)} s`);
  return { ok: problems.length === 0, problems, maxJump, flashesPerSecond };
}

/** Price per second in cents (Gemini Omni 1.2 Flash, docs 13-11-2026), rounded up per clip. */
export const OMNI_CENTS_PER_S: Record<"720p" | "1080p", number> = { "720p": 7, "1080p": 10.4 };
export const clipCents = (durationS: number, res: "720p" | "1080p") => Math.ceil(durationS * OMNI_CENTS_PER_S[res]);

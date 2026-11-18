// KIVOXEL fase 1, sections 2 and 3: the audio of a montage per audio mode.
// - Voice: high-pass, a bit of presence, gentle compression and a subtle room, so it sits IN the video instead of dry on top.
// - Music: from the local royalty-free library, faded, ducked under the voice (sidechain); without a voice it ducks
//   lightly under the game sound so the peaks still hit.
// - Game sound stays audible in every mode; SFX on cuts, peaks and fails.
// - The whole mix: limiter, then loudness to about -14 LUFS with true peak <= -1 dB.
import type { AudioMode, AudioModeSpec, Settings } from "./config.ts";

/** One stretch of music in the video (Milan, 16-11-2026: busy for action, calm for searching and farming). */
export type MusicPartIn = { file: string; atMs: number; durMs: number; startMs: number; kind: "action" | "calm"; title: string };
export type MusicChoice = { file: string; startMs: number; title: string; /** When set: several stretches that cross-fade, instead of one track for the whole video. */ parts?: MusicPartIn[] };
/** Cross-fade between two music stretches. */
export const MUSIC_XFADE_MS = 1600;
export type SfxCue = { file: string; atMs: number; db: number; kind: string };

/**
 * At most this many sound effects as separate inputs of the final render (18-11-2026). A long part has a whoosh on every
 * cut: 100+ little files opened at once ran FFmpeg out of memory. Above this, sfxBeds mixes them first, in portions.
 */
export const MAX_SFX_INPUTS = 16;

/**
 * Mixes many SFX cues into a few full-length tracks ("beds"), MAX_SFX_INPUTS cues per FFmpeg run. Each bed is a lossless
 * FLAC track of the whole video (mostly silence, so a few MB) with the effects at their place and level; the final render
 * then uses the beds as cues at 0 ms and 0 dB. Few cues: no beds needed (empty result).
 */
export function sfxBeds(cues: SfxCue[], durationMs: number, fileFor: (k: number) => string): { args: string[]; cue: SfxCue }[] {
  if (cues.length <= MAX_SFX_INPUTS) return [];
  const out: { args: string[]; cue: SfxCue }[] = [];
  for (let k = 0; k * MAX_SFX_INPUTS < cues.length; k++) {
    const part = cues.slice(k * MAX_SFX_INPUTS, (k + 1) * MAX_SFX_INPUTS);
    const file = fileFor(k);
    const f = part.map((c, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${db(c.db)},adelay=${Math.round(c.atMs)}|${Math.round(c.atMs)}[b${i}]`);
    f.push(`${part.map((_, i) => `[b${i}]`).join("")}amix=inputs=${part.length}:normalize=0:duration=longest,apad=whole_dur=${ms(durationMs)},atrim=0:${ms(durationMs)}[bed]`);
    out.push({ args: ["-hide_banner", "-loglevel", "error", "-y", ...part.flatMap((c) => ["-i", c.file]), "-filter_complex", f.join(";"), "-map", "[bed]", "-c:a", "flac", file], cue: { file, atMs: 0, db: 0, kind: "bed" } });
  }
  return out;
}
export type MixPlan = { mode: AudioMode; spec: AudioModeSpec; music: MusicChoice | null; sfx: SfxCue[]; voiceChain: boolean };

const db = (v: number) => `${v.toFixed(1)}dB`;
const ms = (v: number) => (Math.max(0, v) / 1000).toFixed(3);

/** The extra FFmpeg inputs (after the montage pieces and the voice clips): music (looped) and every SFX. */
export function mixInputs(plan: MixPlan): string[] {
  const out: string[] = [];
  if (plan.music?.parts?.length) for (const p of plan.music.parts) out.push("-stream_loop", "-1", "-ss", ms(p.startMs), "-i", p.file);
  else if (plan.music) out.push("-stream_loop", "-1", "-ss", ms(plan.music.startMs), "-i", plan.music.file);
  for (const s of plan.sfx) out.push("-i", s.file);
  return out;
}

/** Ratio of the sidechain compressor for a wanted dip (duck_db -12 -> about 8:1). */
export const duckRatio = (duckDb: number | null) => Math.min(20, Math.max(2, Math.abs(duckDb ?? 6) / 1.5));

/**
 * The audio part of the filter graph. `game` is the joined game sound ("[ac]"), voice clips are inputs
 * `firstVoice`..`firstVoice + voices - 1`, music and SFX follow. Ends in `[aout]`.
 */
export function mixFilters(input: { plan: MixPlan; settings: Settings; durationMs: number; voices: { index: number; atMs: number }[]; firstExtra: number; loudnorm: string }): string[] {
  const { plan, settings } = input;
  const spec = plan.spec;
  const f: string[] = [];
  const mixIn: string[] = [];
  const voiceOn = spec.voice && input.voices.length > 0;
  const musicOn = !!plan.music && spec.music && spec.music_db !== null;

  f.push(`[ac]volume=${db(spec.game_db)}[game0]`);

  if (voiceOn) {
    input.voices.forEach((v, k) => f.push(`[${v.index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(v.atMs)}|${Math.round(v.atMs)}[n${k}]`));
    const source = input.voices.length > 1 ? `${input.voices.map((_, k) => `[n${k}]`).join("")}amix=inputs=${input.voices.length}:normalize=0:duration=longest,` : "[n0]";
    const c = settings.mix.voice_chain;
    const chain = plan.voiceChain
      ? `highpass=f=${c.highpass_hz},equalizer=f=3200:t=q:w=1.2:g=${c.presence_db},acompressor=threshold=-20dB:ratio=${c.compress_ratio}:attack=5:release=120:makeup=3,aecho=0.8:0.88:28|47:${c.room_reverb_mix.toFixed(2)}|${(c.room_reverb_mix * 0.6).toFixed(2)},`
      : "";
    f.push(`${source}${chain}apad=whole_dur=${ms(input.durationMs)}[vo]`);
    // One copy for the mix, one to duck the game, and one to duck the music when there is music.
    f.push(musicOn ? `[vo]asplit=3[vo_mix][vo_sc_g][vo_sc_m]` : `[vo]asplit=2[vo_mix][vo_sc_g]`);
    // The game sound dips a little under the voice, but stays audible.
    f.push(`[game0][vo_sc_g]sidechaincompress=threshold=0.05:ratio=2.5:attack=20:release=300[game]`);
    mixIn.push("[game]", "[vo_mix]");
  } else if (musicOn) {
    f.push(`[game0]asplit=2[game][game_sc]`);
    mixIn.push("[game]");
  } else {
    f.push(`[game0]anull[game]`);
    mixIn.push("[game]");
  }

  let next = input.firstExtra;
  if (musicOn) {
    const fadeOut = settings.music.fade_out_ms;
    const parts = plan.music!.parts ?? [];
    let source = `[${next}:a]`;
    if (parts.length > 1) {
      // Each stretch overlaps its neighbours by half a cross-fade on both sides, fades in and out, and sits at its place.
      const X = MUSIC_XFADE_MS;
      parts.forEach((p, k) => {
        const lead = k > 0 ? X / 2 : 0, tail = k < parts.length - 1 ? X / 2 : 0;
        const len = p.durMs + lead + tail;
        const at = Math.max(0, Math.round(p.atMs - lead));
        f.push(`[${next + k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${ms(len)},asetpts=PTS-STARTPTS${k > 0 ? `,afade=t=in:d=${ms(X)}` : ""}${tail ? `,afade=t=out:st=${ms(len - X)}:d=${ms(X)}` : ""},adelay=${at}|${at}[mp${k}]`);
      });
      f.push(`${parts.map((_, k) => `[mp${k}]`).join("")}amix=inputs=${parts.length}:normalize=0:duration=longest[mpart]`);
      source = "[mpart]";
    }
    f.push(
      `${source}aresample=48000,aformat=channel_layouts=stereo,atrim=0:${ms(input.durationMs)},asetpts=PTS-STARTPTS,volume=${db(spec.music_db!)},afade=t=in:d=${ms(settings.music.fade_in_ms)},afade=t=out:st=${ms(Math.max(0, input.durationMs - fadeOut))}:d=${ms(fadeOut)}[mus0]`,
    );
    // With a voice: music ducks under the voice. Without: lightly under the game peaks, so the action hits.
    f.push(voiceOn ? `[mus0][vo_sc_m]sidechaincompress=threshold=0.02:ratio=${duckRatio(spec.duck_db).toFixed(1)}:attack=15:release=350[mus]` : `[mus0][game_sc]sidechaincompress=threshold=0.08:ratio=${duckRatio(spec.duck_db).toFixed(1)}:attack=10:release=250[mus]`);
    mixIn.push("[mus]");
    next += Math.max(1, parts.length);
  }

  plan.sfx.forEach((s, k) => {
    const d = Math.round(s.atMs);
    f.push(`[${next + k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${db(s.db)},adelay=${d}|${d}[s${k}]`);
    mixIn.push(`[s${k}]`);
  });

  f.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:duration=first:normalize=0,alimiter=limit=0.89:level=false,${input.loudnorm}[aout]`);
  return f;
}

/** Section 9: the chosen audio mode was really applied (checked on the plan, before rendering). */
export function modeCheck(plan: MixPlan, voiceClips: number): { ok: boolean; value: string; note: string } {
  const problems: string[] = [];
  if (plan.spec.voice && voiceClips === 0) problems.push("stem verwacht, maar geen stem");
  if (!plan.spec.voice && voiceClips > 0) problems.push("stem gevonden in een modus zonder stem");
  if (plan.spec.music && !plan.music) problems.push("muziek verwacht, maar geen track in de bibliotheek");
  if (!plan.spec.music && plan.music) problems.push("muziek in een modus zonder muziek");
  return { ok: problems.length === 0, value: plan.spec.label, note: problems.join("; ") || `${plan.music ? `muziek: ${plan.music.title}` : "geen muziek"}, ${plan.sfx.length} SFX` };
}

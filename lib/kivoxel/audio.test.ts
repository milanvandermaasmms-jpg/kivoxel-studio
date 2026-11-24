import { describe, expect, it } from "vitest";
import type { Segment } from "../youtube/analysis";
import { renderArgs } from "../youtube/render";
import { resolveSettings, type AudioMode } from "./config";
import type { EventTimeline, GameEvent } from "./events";
import { beatStart, cutTimes, pickTrack, planSfx, trackProblems, type Sfx, type Track } from "./media";
import { duckRatio, mixFilters, modeCheck, type MixPlan } from "./mix";
import { readMs, textOverlays } from "./textStory";
import { seeded, type VoLine } from "./voiceScript";

const settings = resolveSettings("standaard");
const plan = (mode: AudioMode, music = true, sfx = 2): MixPlan => ({
  mode,
  // Voice + music is still possible in a preset (the mix is tested with it); the default option 1 has no music (Milan, 16-11-2026).
  spec: mode === "vo_muziek" && music ? { ...settings.audio_modes[mode], music: true, music_db: -20, duck_db: -12 } : settings.audio_modes[mode],
  music: music ? { file: "m.wav", startMs: 1200, title: "T" } : null,
  sfx: Array.from({ length: sfx }, (_, i) => ({ file: `s${i}.wav`, atMs: 1000 * (i + 1), db: -6, kind: "whoosh" })),
  voiceChain: true,
});
const filters = (p: MixPlan, voices = 2) => mixFilters({ plan: p, settings, durationMs: 20_000, voices: Array.from({ length: voices }, (_, k) => ({ index: 3 + k, atMs: k * 4000 })), firstExtra: 3 + voices, loudnorm: "loudnorm=I=-14:TP=-1" });
/** Every [label] is made once and used once, so it appears exactly twice ([ac] comes from the video part, [aout] goes to -map). */
function labelsBalanced(f: string[]) {
  const counts = new Map<string, number>();
  for (const m of f.join(";").matchAll(/\[([a-z_0-9]+)\]/gi)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return [...counts.entries()].filter(([k, n]) => (k === "ac" || k === "aout" ? n !== 1 : n !== 2)).map(([k]) => k);
}

describe("audio modes and mix", () => {
  it("vo_muziek: voice chain, music ducked under the voice, game stays, SFX, loudness at the end", () => {
    const f = filters(plan("vo_muziek"));
    const all = f.join(";");
    expect(all).toContain("highpass=f=90");
    expect(all).toMatch(/acompressor/);
    expect(all).toMatch(/aecho/);
    expect(all).toMatch(/\[mus0\]\[vo_sc_m\]sidechaincompress/);
    expect(all).toMatch(/\[game0\]\[vo_sc_g\]sidechaincompress/);
    expect(f.at(-1)).toMatch(/amix=inputs=5:.*alimiter.*loudnorm=I=-14:TP=-1\[aout\]$/);
    expect(labelsBalanced(f)).toEqual([]);
  });
  it("muziek_geen_vo: no voice, music ducks lightly under the game peaks", () => {
    const f = filters(plan("muziek_geen_vo"), 0);
    const all = f.join(";");
    expect(all).not.toMatch(/highpass/);
    expect(all).toMatch(/\[mus0\]\[game_sc\]sidechaincompress/);
    expect(labelsBalanced(f)).toEqual([]);
  });
  it("alleen_game: game at full level, no music, SFX louder", () => {
    const f = filters(plan("alleen_game", false), 0);
    expect(f[0]).toContain("volume=0.0dB");
    expect(f.join(";")).not.toMatch(/mus/);
    expect(labelsBalanced(f)).toEqual([]);
  });
  it("checks that the chosen mode was really applied", () => {
    expect(modeCheck(plan("vo_muziek"), 3).ok).toBe(true);
    expect(modeCheck(plan("muziek_geen_vo", false), 0).note).toMatch(/geen track/);
    // Option 1 (Milan, 16-11-2026): voice, game sound and captions, no music.
    expect(settings.audio_modes.vo_muziek.music).toBe(false);
    expect(modeCheck(plan("vo_muziek", false), 3).ok).toBe(true);
    expect(modeCheck(plan("alleen_game", false), 2).note).toMatch(/stem gevonden/);
  });
  it("a stronger duck gives a stronger ratio", () => {
    expect(duckRatio(-12)).toBeGreaterThan(duckRatio(-6));
  });
  it("renderArgs adds music (looped, from the beat) and SFX as inputs only with a mix plan", () => {
    const segs: Segment[] = [{ part: "build", src_start_ms: 0, src_end_ms: 10_000, out_start_ms: 0, speed: 1, effects: [], note: "" }];
    const base = { recording: "r.webm", recordingMs: 60_000, hasAudio: true, segments: segs, size: { width: 1080, height: 1920 }, assFile: "s.ass", voice: [{ file: "vo0.mp3", atMs: 0 }], gameVolume: 0.3, output: "o.mp4" };
    const old = renderArgs(base).args.join(" ");
    expect(old).not.toContain("-stream_loop");
    const mixed = renderArgs({ ...base, mix: { plan: plan("vo_muziek", true, 1), settings } }).args.join(" ");
    expect(mixed).toContain("-stream_loop -1 -ss 1.200 -i m.wav");
    expect(mixed).toContain("-i s0.wav");
    expect(mixed).toMatch(/\[2:a\]aresample.*\[mus0\]/);
  });
});

describe("music and SFX library", () => {
  const t = (file: string, moods: Track["moods"], energy: number, test = false): Track => ({ file, title: file, source: "YouTube Audio Library", license: "free", energy, moods, bpm: 120, beat_offset_ms: 0, test });
  const lib = [t("hype.mp3", ["hype"], 5), t("tense.mp3", ["tense"], 4), t("chill.mp3", ["chill"], 2), t("gen.wav", ["hype"], 5, true)];
  it("picks on mood and energy, never a test track for a real video, and rotates", () => {
    expect(pickTrack(lib, "bijna_dood", 4, [], seeded("a"))!.file).toBe("tense.mp3");
    expect(pickTrack(lib, "bouw", 2, [], seeded("a"))!.file).toBe("chill.mp3");
    expect(pickTrack(lib, "fail", 5, [], seeded("a"))!.file).toBe("hype.mp3");
    expect(pickTrack(lib, "fail", 5, ["hype.mp3"], seeded("a"))!.file).not.toBe("hype.mp3");
    expect(pickTrack([t("gen.wav", ["hype"], 5, true)], "fail", 5, [], seeded("a"))).toBeNull();
    expect(pickTrack([t("gen.wav", ["hype"], 5, true)], "fail", 5, [], seeded("a"), 6, true)!.file).toBe("gen.wav");
  });
  it("starts the music so a downbeat lands on the payoff", () => {
    const bar = (4 * 60_000) / 120; // 2000 ms
    const start = beatStart({ bpm: 120, beat_offset_ms: 250 }, 7300);
    expect((start + 7300 - 250) % bar).toBe(0);
    expect(start).toBeGreaterThanOrEqual(0);
  });
  it("refuses music without source and licence", () => {
    expect(trackProblems({ file: "x.mp3", energy: 3, moods: ["hype"], bpm: 120 }).join(" ")).toMatch(/licentie/);
    expect(trackProblems(t("ok.mp3", ["hype"], 3))).toEqual([]);
  });
  it("puts a whoosh on cuts, an impact on big peaks and a scratch on a death, rotating variants", () => {
    const segs: Segment[] = [
      { part: "build", src_start_ms: 0, src_end_ms: 5000, out_start_ms: 0, speed: 1, effects: [], note: "" },
      { part: "payoff", src_start_ms: 9000, src_end_ms: 15_000, out_start_ms: 5000, speed: 1, effects: [], note: "" },
    ];
    expect(cutTimes(segs)).toEqual([5000]);
    const library: Sfx[] = [{ file: "w1", kind: "whoosh" }, { file: "w2", kind: "whoosh" }, { file: "i1", kind: "impact" }, { file: "s1", kind: "scratch" }];
    const cues = planSfx({ segments: segs, peaks: [{ atMs: 9000, payoff: 90, death: true }, { atMs: 2000, payoff: 20, death: false }], library, recent: ["w1"], rnd: seeded("x"), withVoice: true, durationMs: 11_000 });
    expect(cues.map((c) => c.kind)).toEqual(["whoosh", "impact", "scratch"]);
    expect(cues[0].file).toBe("w2");
    expect(cues[0].atMs).toBe(4820);
  });
  it("a long video: no whoosh on every cut, only a softer impact on big moments, 20 s apart (18-11-2026)", () => {
    const segs: Segment[] = [
      { part: "chapter", src_start_ms: 0, src_end_ms: 100_000, out_start_ms: 0, speed: 1, effects: [], note: "" },
      { part: "chapter", src_start_ms: 200_000, src_end_ms: 300_000, out_start_ms: 100_000, speed: 1, effects: [], note: "" },
    ];
    const cues = planSfx({ segments: segs, peaks: [{ atMs: 50_000, payoff: 90, death: true }, { atMs: 60_000, payoff: 95, death: false }, { atMs: 150_000, payoff: 60, death: false }], library: [{ file: "w1", kind: "whoosh" }, { file: "i1", kind: "impact" }, { file: "s1", kind: "scratch" }], recent: [], rnd: seeded("z"), withVoice: false, durationMs: 200_000 });
    expect(cues.map((c) => c.kind)).toEqual(["impact"]);
    expect(cues[0].db).toBe(-7);
  });
  it("follows the kind of moment: pop on a joke, a riser whose hit lands on a find, a harder impact on a jumpscare (24-11-2026)", () => {
    const segs: Segment[] = [{ part: "build", src_start_ms: 0, src_end_ms: 30_000, out_start_ms: 0, speed: 1, effects: [], note: "" }];
    const library: Sfx[] = [{ file: "i1", kind: "impact" }, { file: "p1", kind: "pop" }, { file: "r1", kind: "riser", hit_ms: 1500 }];
    const cues = planSfx({ segments: segs, peaks: [{ atMs: 4000, payoff: 70, death: false, type: "grap" }, { atMs: 12_000, payoff: 80, death: false, type: "geluk" }, { atMs: 22_000, payoff: 90, death: false, type: "jumpscare" }], library, recent: [], rnd: seeded("k"), withVoice: false, durationMs: 30_000 });
    expect(cues.map((c) => [c.kind, c.atMs])).toEqual([["pop", 3980], ["riser", 10_500], ["impact", 21_970]]);
    expect(cues[2].db).toBe(1); // -3 without voice, +4 for a jumpscare
  });
  it("steps back where the game is already loud, and never clutters (24-11-2026)", () => {
    const segs: Segment[] = [
      { part: "build", src_start_ms: 0, src_end_ms: 5000, out_start_ms: 0, speed: 1, effects: [], note: "" },
      { part: "payoff", src_start_ms: 9000, src_end_ms: 15_000, out_start_ms: 5000, speed: 1, effects: [], note: "" },
    ];
    const library: Sfx[] = [{ file: "w1", kind: "whoosh" }, { file: "i1", kind: "impact" }, { file: "s1", kind: "scratch" }];
    // A moment right on the cut: its impact stays, the whoosh 150 ms away gives way.
    const cues = planSfx({ segments: segs, peaks: [{ atMs: 5000, payoff: 90, death: false, loudGame: true }], library, recent: [], rnd: seeded("q"), withVoice: false, durationMs: 11_000 });
    expect(cues.map((c) => c.kind)).toEqual(["impact"]);
    expect(cues[0].db).toBe(-4); // -3 base, +2 impact, -3 loud game
    // Many moments close together: at most four effects in any 10 seconds.
    const many = planSfx({ segments: [segs[0]], peaks: [1000, 2000, 3000, 4000, 5000, 6000].map((atMs) => ({ atMs, payoff: 80, death: false })), library, recent: [], rnd: seeded("m"), withVoice: false, durationMs: 9000 });
    expect(many.length).toBe(4);
  });
  it("a Short that opens on its climax gets an impact on that climax in the first second (18-11-2026)", () => {
    const segs: Segment[] = [
      { part: "teaser", src_start_ms: 99_600, src_end_ms: 100_900, out_start_ms: 0, speed: 1, effects: [], note: "" },
      { part: "build", src_start_ms: 96_000, src_end_ms: 100_900, out_start_ms: 1300, speed: 1, effects: [], note: "" },
    ];
    const cues = planSfx({ segments: segs, peaks: [], library: [{ file: "i1", kind: "impact" }], recent: [], rnd: seeded("y"), withVoice: false, durationMs: 6200 });
    expect(cues[0]).toMatchObject({ kind: "impact", atMs: 370 });
  });
});

describe("story as text without a voice", () => {
  const segs: Segment[] = [{ part: "build", src_start_ms: 100_000, src_end_ms: 120_000, out_start_ms: 0, speed: 1, effects: [], note: "" }];
  const ev: GameEvent = { id: "e", kind: "death", type: "fail", t_start: 110_000, t_peak: 116_000, t_end: 118_000, intensity: 1, payoff: 95, description: "", t_thumb: 115_000, sources: [] };
  const tl: EventTimeline = { version: 1, durationMs: 200_000, generatedAt: "", engine: "free", events: [ev], dead: [], health: [] };
  it("shows the shortest version in capitals before the action, nothing during the peak, the hook not twice", () => {
    const lines: VoLine[] = [
      { at_ms: 0, text: "He has NO idea what's coming.", kind: "hook" },
      { at_ms: 13_000, text: "One wrong step and it's ALL gone…", kind: "anticipation", event_src_ms: 116_000, alts: ["Here it comes!"] },
      { at_ms: 16_300, text: "NOOO!", kind: "reaction", event_src_ms: 116_000 },
    ];
    const { overlays } = textOverlays(lines, segs, tl, 20_000, settings);
    expect(overlays.map((o) => o.text)).toEqual(["HERE IT COMES!", "NOOO!"]);
    expect(overlays[0].endMs).toBeLessThanOrEqual(16_000 - 300);
    expect(overlays[1].startMs).toBeGreaterThanOrEqual(16_250);
    expect(readMs("ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN")).toBe(2600);
  });
});

import { describe, expect, it } from "vitest";
import type { Segment } from "../youtube/analysis";
import { configProblems, hookFile, looksDutch, persona, resolveSettings } from "./config";
import type { EventTimeline, GameEvent } from "./events";
import { anticipationPrompt, parseAnticipation } from "./scriptPrompt";
import { estimateMs, fill, freeScript, pick, runGate, seeded, sourceToOut, syncGate, templates, type VoLine } from "./voiceScript";
import { evidenceFacts } from "../youtube/grounding";

const settings = resolveSettings("standaard");
// The montage shows the recording from 100 s to 125 s; the event peaks at 118 s in the recording = 18 s in the video.
const segs: Segment[] = [{ part: "build", src_start_ms: 100_000, src_end_ms: 125_000, out_start_ms: 0, speed: 1, effects: [], note: "" }];
const ev = (peak: number, payoff = 80, type: GameEvent["type"] = "fail", description = "Dood: GAME OVER-scherm"): GameEvent => ({ id: `e${peak}`, kind: "death", type, t_start: peak - 5000, t_peak: peak, t_end: peak + 2000, intensity: 1, payoff, description, t_thumb: peak - 500, sources: [] });
const timeline = (events: GameEvent[]): EventTimeline => ({ version: 1, durationMs: 200_000, generatedAt: "", engine: "free", events, dead: [], health: [] });

describe("timing helpers", () => {
  it("maps the recording to the montage, skipping a cold open that repeats the peak", () => {
    const withCold: Segment[] = [{ part: "cold_open", src_start_ms: 118_000, src_end_ms: 120_000, out_start_ms: 0, speed: 1, effects: [], note: "" }, ...segs.map((s) => ({ ...s, out_start_ms: 2000 }))];
    expect(sourceToOut(segs, 118_000)).toBe(18_000);
    expect(sourceToOut(withCold, 118_000)).toBe(20_000);
    expect(sourceToOut(segs, 10_000)).toBeNull();
  });
  it("estimates spoken length with pauses", () => {
    expect(estimateMs("Wait… wait…")).toBeGreaterThan(estimateMs("Wait wait"));
    expect(estimateMs("One two three four five six")).toBeGreaterThan(1800);
  });
  it("rotates phrases and is the same for the same seed", () => {
    expect(pick(["a", "b"], ["a"], seeded("x"))).toBe("b");
    expect(pick(["a", "b", "c"], [], seeded("v1"))).toBe(pick(["a", "b", "c"], [], seeded("v1")));
  });
  it("fills in the hearts in English", () => {
    expect(fill("{hearts} hearts left", ev(1, 50, "bijna_dood", "Nog maar 3,5 hartjes"))).toBe("3.5 hearts left");
  });
  it("the templates have every event type", () => {
    expect(configProblems()).toEqual([]);
    for (const t of ["fail", "bijna_dood", "geluk", "bouw", "grap", "jumpscare"] as const) expect(templates.anticipation[t].length).toBeGreaterThanOrEqual(3);
  });
  it("NO Dutch anywhere in video content (Milan, 16-11-2026: English only, always)", () => {
    const all = [
      ...Object.values(templates.opener).flat(), ...Object.values(templates.anticipation).flat(), ...templates.open_loop, ...templates.bridge, ...templates.loop_end,
      ...Object.values(hookFile.hooks).flat(),
      ...Object.values(persona.expressions).flat(),
    ];
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter(looksDutch)).toEqual([]);
  });
  // 23-11-2026 (Milan): "the voice sounds like someone who knows the game": reactions are short and natural, no shouting
  // in CAPS and none of the generic phrases that fit any clip.
  it("reactions are short and natural, and no opener uses a banned generic phrase", () => {
    for (const l of persona.expressions.reaction) {
      expect(l.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(l).not.toMatch(/[A-Z]{3,}/);
    }
    for (const banned of persona.banned_phrases) expect([...Object.values(templates.opener).flat()].join(" ").toLowerCase()).not.toContain(banned);
  });
});

describe("free script engine (no AI)", () => {
  const script = (seed: string, recent: string[] = []) => freeScript({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, seed, recent, short: true });

  it("hook first, anticipation before the peak, one reaction after it, loop at the end", () => {
    const s = script("video-1");
    expect(s.lines[0]).toMatchObject({ at_ms: 0, kind: "hook" });
    const ant = s.lines.find((l) => l.kind === "anticipation")!;
    expect(ant.event_src_ms).toBe(118_000);
    expect(ant.at_ms + estimateMs(ant.text)).toBeLessThanOrEqual(18_000 - 300);
    const reactions = s.lines.filter((l) => l.kind === "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0].at_ms).toBeGreaterThanOrEqual(18_250);
    expect(s.lines.at(-1)!.kind).toBe("loop");
    expect(s.mainType).toBe("fail");
  });

  it("never describes: no line in the past tense about the peak before it happens", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      for (const l of script(seed).lines.filter((x) => x.kind === "anticipation")) expect(templates.anticipation.fail.includes(l.text)).toBe(true);
    }
  });

  it("different videos get different words; recent phrases are avoided", () => {
    const a = script("video-1");
    const b = script("video-2", a.used);
    expect(b.used.filter((u) => a.used.includes(u)).length).toBeLessThan(a.used.length);
  });
});

describe("sync gate", () => {
  const anticipation = (text: string, alts: string[] = []): VoLine => ({ at_ms: 15_000, text, kind: "anticipation", event_src_ms: 118_000, alts });

  it("puts a line so it ends 0.3-1.5 s before the peak", () => {
    const g = syncGate([anticipation("Oh nee.")], [900], segs, timeline([ev(118_000)]), 25_000, settings);
    expect(g.ok).toBe(true);
    const end = g.items[0].atMs + g.items[0].ms;
    expect(end).toBeLessThanOrEqual(18_000 - 300);
    expect(end).toBeGreaterThanOrEqual(18_000 - 1500);
  });

  it("speeds up at most 1.08x, otherwise the line is too long", () => {
    const hook: VoLine = { at_ms: 0, text: "Hook", kind: "hook" };
    // The hook takes until 13 s; the anticipation line needs 4.4 s but has 4.58 s until 17.7 s: fits only at 1.08x... not needed here.
    const fits = syncGate([hook, anticipation("x")], [13_000, 4_900], segs, timeline([ev(118_000)]), 25_000, settings);
    expect(fits.items[1].ok).toBe(true);
    expect(fits.items[1].speed).toBeGreaterThan(1);
    expect(fits.items[1].speed).toBeLessThanOrEqual(1.08);
    const tooLong = syncGate([hook, anticipation("x")], [13_000, 6_000], segs, timeline([ev(118_000)]), 25_000, settings);
    expect(tooLong.items[1].reason).toMatch(/te lang/);
  });

  it("keeps 0.5 s of silence around a big peak and puts the reaction after it", () => {
    const talkOver: VoLine = { at_ms: 17_500, text: "praat door", kind: "bridge" };
    expect(syncGate([talkOver], [1000], segs, timeline([ev(118_000)]), 25_000, settings).items[0].reason).toMatch(/stilte/);
    const reaction: VoLine = { at_ms: 0, text: "NEEE!", kind: "reaction", event_src_ms: 118_000 };
    expect(syncGate([reaction], [600], segs, timeline([ev(118_000)]), 25_000, settings).items[0]).toMatchObject({ ok: true, atMs: 18_250 });
  });

  it("the loop line moves earlier when the real voice is longer, so it ends on the last frame", () => {
    // Estimated at 1.2 s (at 23.4 s), really spoken in 2.4 s: before 20-11-2026 it ran over the end and was dropped.
    const loop: VoLine = { at_ms: 23_400, text: "Watch that again!", kind: "loop" };
    const item = syncGate([loop], [2400], segs, null, 25_000, settings).items[0];
    expect(item).toMatchObject({ ok: true, atMs: 22_600 });
    // Room enough: it stays where the script put it.
    expect(syncGate([{ ...loop, at_ms: 20_000 }], [2400], segs, null, 25_000, settings).items[0]).toMatchObject({ ok: true, atMs: 20_000 });
  });

  it("the first word comes within 0.5 s", () => {
    expect(syncGate([{ at_ms: 900, text: "laat", kind: "hook" }], [500], segs, null, 25_000, settings).items[0].reason).toMatch(/0,5 s/);
  });

  it("rewrites shorter (with real audio lengths) and drops what still does not fit, then flags", async () => {
    const hook: VoLine = { at_ms: 0, text: "Hook", kind: "hook" };
    const lengths: Record<string, number> = { Hook: 13_000, "heel lange zin": 6000, "korte zin": 2500, "nog een lange": 6000 };
    const spoken: string[] = [];
    const run = await runGate({
      lines: [hook, anticipation("heel lange zin", ["korte zin"])],
      segments: segs,
      timeline: timeline([ev(118_000)]),
      targetMs: 25_000,
      settings,
      speak: async (l) => (spoken.push(l.text), lengths[l.text]),
    });
    expect(run.gate.ok).toBe(true);
    expect(run.lines[1].text).toBe("korte zin");
    expect(run.attempts).toBe(2);
    expect(spoken).toEqual(["Hook", "heel lange zin", "korte zin"]);
    expect(run.flagged).toBe(false);

    const stuck = await runGate({ lines: [hook, anticipation("nog een lange")], segments: segs, timeline: timeline([ev(118_000)]), targetMs: 25_000, settings, speak: async (l) => lengths[l.text] });
    expect(stuck.flagged).toBe(true);
    expect(stuck.dropped).toEqual(["nog een lange"]);
    expect(stuck.lines.map((l) => l.text)).toEqual(["Hook"]);
  });
});

describe("AI script (Gemini) with the same rules", () => {
  it("gives the model the timeline and the anticipation rule", () => {
    const { prompt, ids } = anticipationPrompt({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, short: true });
    expect(prompt).toContain("E1: peak at 18.0s");
    expect(prompt).toMatch(/END 0\.3-1\.5 s BEFORE its peak/);
    expect(prompt).toContain("Write ONLY in English");
    expect(prompt).not.toMatch(/Dutch/);
    expect(ids.get("E1")).toBe(118_000);
  });
  it("adds what the frames show (section 1a) without dropping the anticipation rule", () => {
    const facts = evidenceFacts({ frames: [{ i: 0, light: "day", health: "low", mobs: ["creeper"], action: "running", events: ["damage"] }], summary: "A creeper chase.", uncertain: [] }, [{ index: 0, srcMs: 110_000, outMs: 10_000, segment: 0 }]);
    const { prompt } = anticipationPrompt({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, short: true, evidence: facts });
    expect(prompt).toContain("mobs creeper");
    expect(prompt).toContain("A creeper chase.");
    expect(prompt).toMatch(/END 0\.3-1\.5 s BEFORE its peak/);
    expect(facts).not.toMatch(/6-14 words/);
  });
  it("reads the answer, links lines to events and keeps only shorter alternatives", () => {
    const { ids } = anticipationPrompt({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, short: true });
    const r = parseAnticipation({ lines: [{ kind: "hook", text: "One heart. One!", style: "spannend" }, { event: "E1", kind: "anticipation", text: "Okay… one wrong step…", shorter: ["One wrong step…", "This is way longer than the line itself"], style: "spannend" }, { event: "E1", kind: "reaction", text: "NOOO!", style: "schreeuw" }] }, ids, segs, 25_000, timeline([ev(118_000)]));
    expect("lines" in r).toBe(true);
    if (!("lines" in r)) return;
    expect(r.lines.map((l) => l.kind)).toEqual(["hook", "anticipation", "reaction"]);
    expect(r.lines[1].event_src_ms).toBe(118_000);
    expect(r.lines[1].alts).toEqual(["One wrong step…"]);
    expect(parseAnticipation({ lines: [] }, ids, segs, 25_000, null)).toEqual({ error: "geen regels" });
  });
});

describe("no long silences in a Short", () => {
  it("fills a long build-up with tension lines, never more than ~6 s without a word before the moment", () => {
    const long: Segment[] = [{ part: "build", src_start_ms: 100_000, src_end_ms: 128_000, out_start_ms: 0, speed: 1, effects: [], note: "" }];
    const s = freeScript({ segments: long, targetMs: 28_000, timeline: timeline([ev(125_000)]), settings, seed: "gap", short: true });
    const sorted = [...s.lines].sort((a, b) => a.at_ms - b.at_ms);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].at_ms - (sorted[i - 1].at_ms + estimateMs(sorted[i - 1].text))).toBeLessThanOrEqual(7000);
    expect(sorted.some((l) => templates.build.includes(l.text) || /…$/.test(l.text))).toBe(true);
  });
  it("a hit the player survives never gets a 'he is gone' line", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g"]) {
      const hit = { ...ev(118_000), kind: "damage" as const };
      const r = freeScript({ segments: segs, targetMs: 25_000, timeline: timeline([hit]), settings, seed, short: true }).lines.find((l) => l.kind === "reaction")!;
      expect(persona.expressions.after_fail).not.toContain(r.text);
    }
  });
});

describe("reactions fit the event", () => {
  it("a death never gets a hyped reaction, a lucky find never a shocked one", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const fail = freeScript({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, seed, short: true }).lines.find((l) => l.kind === "reaction")!;
      expect(persona.expressions.reaction_good).not.toContain(fail.text);
      const luck = freeScript({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000, 80, "geluk", "Diamant")]), settings, seed, short: true }).lines.find((l) => l.kind === "reaction")!;
      expect(persona.expressions.reaction).not.toContain(luck.text);
    }
  });
});

describe("AI script safety", () => {
  it("fills a long silence in an AI script and drops lines that send viewers away", async () => {
    const { anticipationPrompt, parseAnticipation } = await import("./scriptPrompt");
    const { ids } = anticipationPrompt({ segments: segs, targetMs: 25_000, timeline: timeline([ev(118_000)]), settings, short: true });
    const r = parseAnticipation({ lines: [{ kind: "hook", text: "Watch this!" }, { event: "E1", kind: "anticipation", text: "Turn down your speakers!", shorter: ["Loud incoming!"] }, { kind: "bridge", text: "Subscribe now", shorter: [] }] }, ids, segs, 25_000, timeline([ev(118_000)]));
    if (!("lines" in r)) throw new Error("parse");
    expect(r.lines.map((l) => l.text)).toEqual(["Watch this!", "Loud incoming!"]);
    // A bare list (without {"lines": …}) is accepted too.
    const bare = parseAnticipation([{ kind: "hook", text: "Watch this!" }], ids, segs, 25_000, null);
    expect("lines" in bare && bare.lines[0].text).toBe("Watch this!");
    const { fillSilences, pick, seeded: sd } = await import("./voiceScript");
    const rnd = sd("f");
    const filled = fillSilences(r.lines, (o) => pick(o, [], rnd), rnd);
    expect(filled.length).toBeGreaterThan(r.lines.length);
  });
  it("never repeats a filler in a long video; the game sound carries the rest (Milan 17-11-2026: 'gekke tekst!')", async () => {
    const { fillSilences, pick, seeded: sd } = await import("./voiceScript");
    const rnd = sd("long");
    const filled = fillSilences([{ at_ms: 0, text: "GO!", kind: "hook", style: "schreeuw" }, { at_ms: 500_000, text: "THAT WAS INSANE!", kind: "reaction", style: "schreeuw" }], (o) => pick(o, [], rnd), rnd);
    const texts = filled.map((l) => l.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(filled.length).toBeGreaterThan(5);
    // Spread over the whole video, not all in the first minute and a half.
    const bridges = filled.filter((l) => l.kind === "bridge").map((l) => l.at_ms);
    expect(Math.max(...bridges)).toBeGreaterThan(400_000);
    expect(Math.min(...bridges)).toBeLessThan(60_000);
  });
  it("also fills the stretch after the last line when it knows the video length", async () => {
    const { fillSilences, pick, seeded: sd } = await import("./voiceScript");
    const rnd = sd("tail");
    const filled = fillSilences([{ at_ms: 0, text: "GO!", kind: "hook", style: "schreeuw" }], (o) => pick(o, [], rnd), rnd, 300_000);
    expect(filled.length).toBeGreaterThan(5);
    expect(filled.every((l) => l.at_ms < 300_000)).toBe(true);
    expect(fillSilences([{ at_ms: 0, text: "GO!", kind: "hook", style: "schreeuw" }], (o) => pick(o, [], rnd), rnd)).toHaveLength(1);
  });
});

describe("the AI only gets English", () => {
  it("translates the Dutch event notes before they go into the prompt", async () => {
    const { englishDescription, anticipationPrompt } = await import("./scriptPrompt");
    expect(englishDescription(ev(1, 50, "fail", "Schade: van 10 naar 8 hartjes"))).toBe("the player dies (hardcore GAME OVER screen)");
    expect(englishDescription({ ...ev(1, 50, "fail", "Schade: van 8,5 naar 7,5 hartjes"), kind: "damage" })).toBe("the player takes a big hit: from 8.5 to 7.5 hearts");
    const { prompt } = anticipationPrompt({ segments: segs, targetMs: 25_000, timeline: timeline([{ ...ev(118_000, 60, "bijna_dood", "Nog maar 3,5 hartjes"), kind: "low_health" }]), settings, short: true });
    expect(prompt).toContain("only 3.5 hearts left");
    expect(prompt).not.toMatch(/hartjes|Schade|Nog maar/);
  });
});

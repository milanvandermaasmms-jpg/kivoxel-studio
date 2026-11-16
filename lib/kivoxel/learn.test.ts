import { describe, expect, it } from "vitest";
import { hookFile, resolveSettings } from "./config";
import { genericLine, learnFrom, withLearned } from "./learn";
import { freeScript, seeded } from "./voiceScript";

const failHook = hookFile.hooks.fail[0];

describe("learning from approved scripts (section 8)", () => {
  it("keeps lines that fit any video, drops ones tied to one video or not English", () => {
    expect(genericLine("Okay… one wrong move and it's OVER")).toBe(true);
    expect(genericLine("That creeper is RIGHT behind him")).toBe(false);
    expect(genericLine("He has 3 hearts left")).toBe(false);
    expect(genericLine("Wacht even, dit gaat fout")).toBe(false);
  });
  it("sorts the lines by kind and by the Short's event type (from its hook)", () => {
    const l = learnFrom([
      { top_line: failHook, lines: [{ kind: "anticipation", text: "He has NO idea what's coming…" }, { kind: "reaction", text: "NOT LIKE THIS!" }, { kind: "hook", text: "Watch THIS!" }] },
      { top_line: null, lines: "broken" },
    ]);
    expect(l.anticipation.fail).toEqual(["He has NO idea what's coming…"]);
    expect(l.reaction_bad).toEqual(["NOT LIKE THIS!"]);
    expect(l.from).toBe(1);
  });
  it("approved lines count double in the pool", () => {
    expect(withLearned(["a"], ["b"])).toEqual(["a", "b", "b"]);
    expect(withLearned(["a"], undefined)).toEqual(["a"]);
  });
  it("the free engine really uses them", () => {
    const learned = learnFrom([{ top_line: failHook, lines: Array.from({ length: 20 }, (_, i) => ({ kind: "anticipation", text: `Approved line number ${"x".repeat(i + 1)}… watch` })) }]);
    learned.anticipation.fail = ["He has NO idea what's coming…"];
    const settings = resolveSettings(null);
    const seg = [{ src_start_ms: 100_000, src_end_ms: 125_000, speed: 1, out_start_ms: 0, part: "main", note: "", effects: [] }] as never;
    const ev = { id: "e1", kind: "death", type: "fail", t_start: 110_000, t_peak: 118_000, t_end: 121_000, intensity: 1, payoff: 95, description: "", sources: [], t_thumb: 117_000 };
    const timeline = { version: 1, durationMs: 200_000, generatedAt: "", engine: "free", events: [ev], dead: [], health: [] } as never;
    let hits = 0;
    for (let i = 0; i < 20; i++) if (freeScript({ segments: seg, targetMs: 25_000, timeline, settings, seed: `s${i}`, short: true, learned }).lines.some((l) => l.text === "He has NO idea what's coming…")) hits++;
    expect(hits).toBeGreaterThan(0);
    expect(seeded("x")()).toBeGreaterThanOrEqual(0);
  });
});

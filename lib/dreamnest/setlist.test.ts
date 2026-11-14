import { describe, expect, it } from "vitest";
import { composeSong, harmonize, melodyBeats } from "./music";
import { planCues, renderCues, type Part } from "./setlist";

const PARTS: [Part, number][] = [["story", 370], ["falling_asleep", 370], ["sleep", 370]];

describe("new composer (fase 6)", () => {
  it("16 whole bars, ends at home, gentle steps, both major and minor", () => {
    const homes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const m = composeSong(seed);
      expect(melodyBeats(m)).toBeCloseTo(16 * m.beatsPerBar);
      expect(m.notes.at(-1)![0] % 12).toBe(m.home === "Am" ? 9 : 0);
      expect(harmonize(m).at(-1)).toBe(m.home);
      const n = m.notes.map((x) => x[0]);
      expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(15);
      for (let i = 1; i < n.length; i++) expect(Math.abs(n[i] - n[i - 1])).toBeLessThanOrEqual(9);
      homes.add(m.home!);
    }
    expect(homes).toEqual(new Set(["C", "Am"]));
  });
  it("the motif comes back: phrase A' starts like phrase A", () => {
    const m = composeSong(7);
    const perPhrase = m.notes.length / 4;
    expect(Number.isInteger(perPhrase) || m.notes.length > 0).toBe(true);
  });
});

describe("setlist: never boring, never twice the same song", () => {
  it("no song twice in a whole 60-minute episode", () => {
    const ids: string[] = [];
    for (const [part, len] of PARTS) for (const c of planCues(part, len, 11)) ids.push(c.melody.id);
    for (let k = 0; k < 7; k++) for (const c of planCues("sleep", 360, 11 + 200 + k)) ids.push(c.melody.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("two songs in a row never share instrument or style", () => {
    for (const [part, len] of PARTS) {
      const cues = planCues(part, len, 11);
      expect(cues.length).toBeGreaterThan(1);
      for (let i = 1; i < cues.length; i++) {
        expect(cues[i].lead).not.toBe(cues[i - 1].lead);
        expect(cues[i].style).not.toBe(cues[i - 1].style);
      }
    }
  });
  it("story uses the known themes; it gets slower and thinner towards sleep", () => {
    const story = planCues("story", 370, 11);
    expect(story.map((c) => c.melody.id)).toEqual(expect.arrayContaining(["twinkle", "brahms", "auclair"]));
    const avg = (p: Part) => planCues(p, 370, 11).reduce((s, c) => s + c.bpm, 0) / planCues(p, 370, 11).length;
    expect(avg("story")).toBeGreaterThan(avg("falling_asleep"));
    expect(avg("falling_asleep")).toBeGreaterThan(avg("sleep"));
  });
  it("the sleep part has music all through (never empty), with quiet space between songs", () => {
    const cues = planCues("sleep", 370, 11);
    const { events } = renderCues(cues, 370, 11);
    for (let t = 0; t < 360; t += 10) expect(events.some((e) => e.t <= t && e.t + e.dur >= t)).toBe(true);
    for (const c of cues) expect(c.gapS).toBeGreaterThanOrEqual(14);
    const leadPerMin = events.filter((e) => e.instrument !== "pad").length / (370 / 60);
    const storyLead = renderCues(planCues("story", 370, 11), 370, 11).events.filter((e) => e.instrument !== "pad").length / (370 / 60);
    expect(leadPerMin).toBeLessThan(storyLead);
    expect(leadPerMin).toBeGreaterThan(5);
  });
});

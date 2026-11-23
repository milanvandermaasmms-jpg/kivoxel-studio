import { describe, expect, it } from "vitest";
import { aiForViral, contentPrompt, parseContentCheck } from "./contentCheck";
import type { ViralResult } from "./viralScore";

describe("AI-inhoudscheck", () => {
  it("asks only for what is seen and heard, with Dutch evidence and time codes", () => {
    const p = contentPrompt({ kind: "short", game: "Minecraft", script: ["He hears the hiss behind him"], briefing: "Horror, val van grote hoogte" });
    expect(p).toMatch(/Never guess/);
    expect(p).toMatch(/IN DUTCH with time codes/);
    expect(p).toMatch(/He hears the hiss/);
    expect(p).toMatch(/val van grote hoogte/);
  });

  it("accepts a score only with evidence; clamps; unclear stays open", () => {
    const c = parseContentCheck({ hook: { score: 8.46, evidence: "0:00 creeper sist achter de speler" }, fragment: { score: 12, evidence: "0:05 val" }, verhaal: { score: 7 }, originaliteit: { score: null, evidence: "Onduidelijk" }, summary: "Spannend." }, "gemini-x");
    expect(c.parts.hook.score).toBe(8.5);
    expect(c.parts.fragment.score).toBe(10);
    expect(c.parts.verhaal.score).toBeNull();
    expect(c.parts.originaliteit.score).toBeNull();
  });

  it("fills only open parts; Milan's judgement and measured parts stay", () => {
    const v = { parts: [{ key: "hook", score: 9, source: "gemeten" }, { key: "originaliteit", score: null, source: null }, { key: "verhaal", score: 6, source: "Milan" }] } as unknown as ViralResult;
    const c = parseContentCheck({ hook: { score: 5, evidence: "x" }, originaliteit: { score: 8, evidence: "0:03 grappige val" }, verhaal: { score: 9, evidence: "y" } }, "m");
    expect(aiForViral(v, c)).toEqual({ originaliteit: 8 });
  });
});

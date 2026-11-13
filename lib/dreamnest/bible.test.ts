import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPrompt, consistencyDecision, worstCaseCents, type Character, type SetPack, type Shot } from "./bible";

const dir = "content/dreamnest";
const characters = readdirSync(`${dir}/characters`).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${dir}/characters/${f}`, "utf8")) as Character);
const sets = readdirSync(`${dir}/sets`).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${dir}/sets/${f}`, "utf8")) as SetPack);
const shots = JSON.parse(readFileSync(`${dir}/shots/fase1.json`, "utf8")) as Shot[];

describe("character bible", () => {
  it("Lumi is always Lumi van Dreamnest, with her nightcap and Twinkle", () => {
    const lumi = characters.find((c) => c.id === "lumi")!;
    expect(lumi.name).toBe("Lumi van Dreamnest");
    expect(lumi.prompt_dna).toMatch(/nightcap/);
    expect(lumi.prompt_dna).toMatch(/Twinkle/);
    expect(lumi.expressions).toHaveLength(6);
    expect(lumi.reference_images.length).toBeGreaterThan(0);
  });
  it("every colour is a hex code", () => {
    for (const p of [...characters.map((c) => c.palette), ...sets.map((s) => s.palette)]) for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe("shots for fase 1", () => {
  it("only use known characters and sets, and every keyframe waits for approved designs", () => {
    for (const s of shots) {
      expect(() => buildPrompt(s, characters, sets.find((x) => x.id === s.set) ?? null)).not.toThrow();
      if (s.set) expect(sets.some((x) => x.id === s.set)).toBe(true);
      if (s.kind === "keyframe") expect(s.stage).toBe("b");
    }
    expect(shots.filter((s) => s.kind === "keyframe")).toHaveLength(10);
  });
  it("fit the budget of 10 euro even in the worst case", () => {
    expect(worstCaseCents(shots, (size) => (size === "2K" ? 11 : 7))).toBeLessThanOrEqual(1000);
  });
  it("never ask the image model for text", () => {
    const lumi = shots.find((s) => s.characters.includes("lumi"))!;
    expect(buildPrompt(lumi, characters, null)).toMatch(/no text/);
  });
});

describe("consistency check", () => {
  it("accepts at 80, retries below, and hands over to Milan after 3 attempts", () => {
    expect(consistencyDecision(85, 1)).toBe("accept");
    expect(consistencyDecision(70, 1)).toBe("retry");
    expect(consistencyDecision(70, 3)).toBe("to_milan");
  });
});

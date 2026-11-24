import { describe, expect, it } from "vitest";
import { checkLine, lineCheckQc, repairLines, soften } from "./lineCheck";

const failed = (text: string, kind?: string) => checkLine({ text, kind }).points.filter((p) => !p.ok).map((p) => p.key);

describe("stem: controle per zin (7 punten)", () => {
  it("passes a calm, specific English line", () => {
    expect(checkLine({ text: "He has two hearts left and the creeper is right behind him.", kind: "anticipation" }).score).toBe(7);
  });

  it("finds each broken rule", () => {
    expect(failed("Hij springt van de klif")).toContain("english");
    expect(failed("He jumps off the cliff and then he runs to the cave and then he finds a chest and a sword")).toContain("one_job");
    expect(failed("Oh my god!")).toContain("specific");
    expect(failed("Watch, he survives this fall.", "anticipation")).toContain("no_spoiler");
    expect(failed("He survived that fall.", "reaction")).toEqual([]); // after the moment the outcome may be said
    expect(failed("NO WAY THAT HAPPENED!!!")).toContain("natural");
    expect(failed("He kills the zombie with one hit.")).toContain("kid_safe");
    expect(checkLine({ text: "Too long here." }, { ok: false, reason: "zin loopt over het einde van de video" }).points.find((p) => p.key === "timing")!.ok).toBe(false);
  });

  it("keeps game words in capitals (TNT, PVP)", () => {
    expect(failed("The TNT is already lit under the PVP arena.")).toEqual([]);
    expect(soften("NO WAY, the TNT!!!")).toBe("No way, the TNT!");
  });

  it("repairs before speaking: softens shouting, takes a passing shorter version, or leaves the line out", () => {
    const { lines, changes } = repairLines([
      { text: "THIS IS GOING TO BE CLOSE!!" },
      { text: "Watch, he survives this.", kind: "anticipation", alts: ["Watch the edge of the cliff."] },
      { text: "He kills it.", alts: ["Gone."] },
      { text: "Two hearts left." },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["This is going to be close!", "Watch the edge of the cliff.", "Gone.", "Two hearts left."]);
    expect(changes).toHaveLength(3);
    expect(repairLines([{ text: "He kills it." }]).lines).toEqual([]);
    // A passing line keeps only shorter versions that pass too.
    expect(repairLines([{ text: "Two hearts left.", alts: ["He kills it.", "Two left."] }]).lines[0].alts).toEqual(["Two left."]);
  });

  it("sums up for the QC list", () => {
    expect(lineCheckQc([checkLine({ text: "Two hearts left." }), checkLine({ text: "Wow!" })])).toMatchObject({ level: "orange", value: "1 van 2 zinnen 7/7" });
    expect(lineCheckQc([checkLine({ text: "He kills it." })]).level).toBe("red");
  });
});

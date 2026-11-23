import { describe, expect, it } from "vitest";
import { lessonPrompt, lessonSentence, lessonsFrom } from "./lessons";

const r = (title: string, note: string, at = "2026-11-21T10:00:00Z") => ({ title, note, at });

describe("leren van Milans afkeuringen", () => {
  it("a mistake seen twice becomes a rule, once stays a hypothesis; system notes do not count", () => {
    const l = lessonsFrom([
      r("Netherite Trim Armor Box", "geen goede content"),
      r("Epic Sky Fall Clutch", "er gebeurt niks", "2026-11-22T10:00:00Z"),
      r("Iron Golem Part 2", "gekke tekst!"),
      r("Old one", "Niet gebruikt: in beeld gebeurt te weinig"),
      r("Gate", "Producer: AFGEKEURD — menu"),
    ]);
    const actie = l.find((x) => x.key === "geen_actie")!;
    expect(actie).toMatchObject({ count: 2, status: "regel" });
    expect(actie.examples[0].title).toBe("Epic Sky Fall Clutch");
    expect(l.find((x) => x.key === "tekst_klopt_niet")).toMatchObject({ count: 1, status: "hypothese" });
    expect(lessonPrompt(l)).toHaveLength(1);
  });

  it("says in one sentence which lesson was applied and where it comes from", () => {
    const [l] = lessonsFrom([r("A", "er gebeurt niks"), r("B", "geen content")]);
    expect(lessonSentence(l)).toMatch(/Er gebeurt te weinig \(2× afgekeurd\): bij "A" schreef Milan "er gebeurt niks"\. Deze versie kreeg die les mee/);
  });
});

import { describe, expect, it } from "vitest";
import { amsterdamToIso, descriptionSuggestion, draftAdvice, draftProblems, EMPTY_DRAFT, hashtags, isoToAmsterdam, parseTags, tagsLength, titleSuggestions, uploadProblems, utf8Bytes } from "./publication";

const ok = { ...EMPTY_DRAFT("en"), title: "Minecraft: creeper blows up my base", made_for_kids: false, contains_synthetic_media: false };

describe("YouTube limits", () => {
  it("counts tags the way YouTube does", () => {
    expect(tagsLength(["minecraft", "hardcore"])).toBe(9 + 1 + 8);
    expect(tagsLength(["minecraft hardcore"])).toBe(18 + 2);
    expect(tagsLength([])).toBe(0);
    expect(parseTags("minecraft, #Hardcore , minecraft,  creeper   farm ,")).toEqual(["minecraft", "Hardcore", "creeper farm"]);
  });

  it("counts the description in bytes, not letters", () => {
    expect(utf8Bytes("é")).toBe(2);
    expect(draftProblems({ ...ok, description: "é".repeat(2501) })[0]).toMatch(/5002 bytes/);
    expect(draftProblems({ ...ok, description: "é".repeat(2500) })).toEqual([]);
  });

  it("refuses long titles, angle brackets and too many tag characters", () => {
    expect(draftProblems({ ...ok, title: "x".repeat(101) })[0]).toMatch(/101 tekens/);
    expect(draftProblems({ ...ok, title: "a <b>" })).toContain("De titel mag geen < of > bevatten.");
    expect(draftProblems({ ...ok, tags: Array.from({ length: 60 }, (_, i) => `minecraft${i}`) })[0]).toMatch(/tags zijn samen/);
  });

  it("only schedules a private video", () => {
    expect(draftProblems({ ...ok, visibility: "public", publish_at: "2026-11-20T17:30:00.000Z" })[0]).toMatch(/alleen met zichtbaarheid Privé/);
  });
});

describe("before an upload", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("asks Milan to choose audience and AI notice himself", () => {
    const p = uploadProblems({ ...EMPTY_DRAFT("en") }, now);
    expect(p).toEqual(["Vul een titel in.", "Kies zelf of de video voor kinderen gemaakt is (verplicht bij YouTube).", "Kies zelf of de video realistische AI-inhoud bevat."]);
    expect(uploadProblems(ok, now)).toEqual([]);
  });

  it("plans at least a quarter of an hour ahead", () => {
    expect(uploadProblems({ ...ok, publish_at: "2026-11-12T12:10:00Z" }, now)[0]).toMatch(/kwartier/);
    expect(uploadProblems({ ...ok, publish_at: "2026-11-12T13:00:00Z" }, now)).toEqual([]);
  });

  it("gives advice without blocking", () => {
    expect(hashtags("#a #b #c #d #e #f mail#nope")).toBe(6);
    expect(draftAdvice({ ...ok, description: "#a #b #c #d #e #f" }, "long")[0]).toMatch(/6 hashtags/);
    expect(draftAdvice({ ...ok, title: "Creeper blows up my base" }, "long")[0]).toMatch(/trefwoord/);
    expect(draftAdvice(ok, "short")).toEqual([]);
  });
});

describe("suggestions from the chosen hook", () => {
  it("puts Minecraft first and invents nothing", () => {
    expect(titleSuggestions({ first_line: "This close to losing everything.", overlay: "NO WAY OUT" })).toEqual([
      "Minecraft: This close to losing everything",
      "Minecraft: No way out",
      "No way out in Minecraft (This close to losing everything)",
    ]);
    expect(titleSuggestions(null)).toEqual([]);
    expect(descriptionSuggestion({ first_line: "Watch left." }, "short")).toBe("Watch left.\n\n#minecraft #gaming #shorts");
  });
});

describe("Amsterdam times", () => {
  it("converts both ways, in winter and summer time", () => {
    expect(amsterdamToIso("2026-11-20T18:30")).toBe("2026-11-20T17:30:00.000Z");
    expect(amsterdamToIso("2026-07-01T18:30")).toBe("2026-07-01T16:30:00.000Z");
    expect(isoToAmsterdam("2026-11-20T17:30:00.000Z")).toBe("2026-11-20T18:30");
    expect(isoToAmsterdam("2026-07-01T16:30:00Z")).toBe("2026-07-01T18:30");
    expect(amsterdamToIso("")).toBeNull();
    expect(isoToAmsterdam(null)).toBe("");
  });
});

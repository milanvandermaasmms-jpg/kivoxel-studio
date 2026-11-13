import { describe, expect, it } from "vitest";
import { addTag, splitTagInput, parseSuggestions, readSuggestions, removeTag, suggestPrompt, testSuggestions } from "./suggest";

describe("parseSuggestions", () => {
  it("cleans tags, removes doubles, hashtags and forbidden words", () => {
    const r = parseSuggestions({ tags: ["#Minecraft", "minecraft", " creeper ", "Maes", 3, "<b>"], titles: ["Minecraft: bijna dood", "Maes redt me"], description: "Kijk mee.\n\n#minecraft" }, ["maes"]);
    if ("error" in r) throw new Error(r.error);
    expect(r.tags).toEqual(["minecraft", "creeper", "b"]);
    expect(r.titles).toEqual(["Minecraft: bijna dood"]);
    expect(r.description).toBe("Kijk mee.\n\n#minecraft");
  });

  it("keeps at most 15 tags under YouTube's 500 characters", () => {
    const r = parseSuggestions({ tags: Array.from({ length: 30 }, (_, i) => `tag nummer ${i} met wat extra tekst`), titles: [] });
    if ("error" in r) throw new Error(r.error);
    expect(r.tags.length).toBeLessThanOrEqual(15);
    expect(r.tags.reduce((s, t) => s + t.length + 3, 0)).toBeLessThan(500);
  });

  it("reports an unusable answer instead of failing silently", () => {
    expect(parseSuggestions(null)).toEqual({ error: "geen JSON-object" });
    expect("error" in parseSuggestions({ tags: [], titles: [] })).toBe(true);
  });
});

describe("prompt and helpers", () => {
  it("puts the transcript, earlier tags and forbidden words in the prompt", () => {
    const p = suggestPrompt({ language: "nl", kind: "short", channel: { name: "Kivoxel", audience: "kinderen 8-12" }, title: "", description: "", narration: ["Hij springt!"], hook: "Bijna dood", usedTags: ["minecraft"], forbidden: ["geheim"] });
    expect(p).toContain("Dutch");
    expect(p).toContain("Hij springt!");
    expect(p).toContain("minecraft");
    expect(p).toContain("geheim");
    expect(p).toContain("#shorts");
  });

  it("test suggestions are marked as test and readable back", () => {
    const t = testSuggestions({ kind: "short" });
    expect(t.source).toBe("test");
    expect(readSuggestions(t)).toEqual(t);
    expect(readSuggestions({})).toBeNull();
  });

  it("adds and removes tags without doubles", () => {
    expect(addTag(["Minecraft"], "#minecraft")).toEqual(["Minecraft"]);
    expect(addTag(["a"], " b ")).toEqual(["a", "b"]);
    expect(removeTag(["A", "b"], "a")).toEqual(["b"]);
  });
});

describe("splitTagInput", () => {
  it("splits on commas and on a space before a hashtag, never inside a word", () => {
    const tags = splitTagInput("minecraft #gaming #shorts, survival tips").reduce(addTag, [] as string[]);
    expect(tags).toEqual(["minecraft", "gaming", "shorts", "survival tips"]);
  });
});

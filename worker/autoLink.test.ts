import { describe, expect, it } from "vitest";
import { matchUploads, normalizeTitle } from "./autoLink.ts";

const up = (videoId: string, title: string) => ({ videoId, title, publishedAt: "2026-11-17T22:00:00Z" });

describe("normalizeTitle", () => {
  it("ignores hashtags, capitals, emoji and punctuation", () => {
    expect(normalizeTitle("Hidden TNT Trap Goes Off Instantly!  #minecraft #minecraftsurvivalseriesepisode1 #gaming")).toBe("hidden tnt trap goes off instantly");
    expect(normalizeTitle("HIDDEN tnt trap — goes off instantly 😱")).toBe("hidden tnt trap goes off instantly");
  });
});

describe("matchUploads", () => {
  const waiting = [
    { videoId: "v1", titles: ["Minecraft Secret Room TNT Explosion Trap", "Hidden TNT Trap Goes Off Instantly!"] },
    { videoId: "v2", titles: ["Minecraft Elytra Flight Past A Hidden TNT Trap"] },
  ];
  it("links an upload whose title matches exactly one waiting video (the TNT case)", () => {
    expect(matchUploads([up("TOMJccz_CHI", "Hidden TNT Trap Goes Off Instantly!  #minecraft #gaming")], waiting, new Set())).toEqual([{ videoId: "v1", youtubeId: "TOMJccz_CHI", title: "Hidden TNT Trap Goes Off Instantly!  #minecraft #gaming" }]);
  });
  it("never guesses: no partial matches, no already linked uploads, no title shared by two videos", () => {
    expect(matchUploads([up("a", "Hidden TNT Trap")], waiting, new Set())).toEqual([]);
    expect(matchUploads([up("TOMJccz_CHI", "Hidden TNT Trap Goes Off Instantly!")], waiting, new Set(["TOMJccz_CHI"]))).toEqual([]);
    const twins = [...waiting, { videoId: "v3", titles: ["Hidden TNT Trap Goes Off Instantly!"] }];
    expect(matchUploads([up("x", "Hidden TNT Trap Goes Off Instantly!")], twins, new Set())).toEqual([]);
  });
  it("the same title uploaded twice is left for Milan to choose", () => {
    expect(matchUploads([up("a1", "Hidden TNT Trap Goes Off Instantly!"), up("a2", "Hidden TNT Trap Goes Off Instantly!")], waiting, new Set())).toEqual([]);
  });
  it("very short titles are never matched", () => {
    expect(matchUploads([up("p", "Part 2")], [{ videoId: "v9", titles: ["Part 2"] }], new Set())).toEqual([]);
  });
});

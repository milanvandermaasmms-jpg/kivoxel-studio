import { describe, expect, it } from "vitest";
import { BASE_TAGS, standardDescription, standardTags, standardTitle } from "./standardMeta";
import { draftProblems, TAGS_MAX } from "./publication";
import { looksDutch } from "../kivoxel/config";

describe("standard YouTube texts (free, 18-11-2026)", () => {
  it("tags: the fixed KIVOXEL set plus topics from the title, within YouTube's limits", () => {
    const tags = standardTags({ kind: "short", texts: ["Minecraft Giant TNT Tower Explosion Challenge", "HOW IS HE ALIVE?!"] });
    for (const t of BASE_TAGS) expect(tags).toContain(t);
    expect(tags).toEqual(expect.arrayContaining(["minecraft shorts", "minecraft tnt", "minecraft build"]));
    expect(tags.length).toBeLessThanOrEqual(15);
    expect(tags.join(",").length).toBeLessThanOrEqual(TAGS_MAX);
    expect(new Set(tags).size).toBe(tags.length);
  });
  it("long videos get series tags instead of Shorts tags", () => {
    const tags = standardTags({ kind: "long", texts: ["Minecraft Survival Part 2: Creepers in the Snow"] });
    expect(tags).toEqual(expect.arrayContaining(["minecraft lets play", "minecraft creeper", "minecraft snow", "minecraft series"]));
    expect(tags).not.toContain("shorts");
  });
  it("description: the hook, the KIVOXEL block and 3 hashtags, in English", () => {
    const d = standardDescription({ kind: "short", title: "Minecraft Giant TNT Tower Explosion Challenge", hookLine: "Boom! That massive TNT tower just blew up!" });
    expect(d.startsWith("Boom! That massive TNT tower just blew up!")).toBe(true);
    expect(d).toContain("Subscribe");
    expect(d.endsWith("#minecraft #gaming #shorts")).toBe(true);
    expect(looksDutch(d)).toBe(false);
  });
  it("title: the first title the script already wrote, else the hook", () => {
    expect(standardTitle({ scriptTitles: ["", "Minecraft Secret Room TNT Explosion Trap"], hookLine: "x" })).toBe("Minecraft Secret Room TNT Explosion Trap");
    expect(standardTitle({ scriptTitles: null, hookLine: "Boom <b>!" })).toBe("Boom b!");
  });
  it("a draft made only of standard texts passes the YouTube checks", () => {
    const title = standardTitle({ scriptTitles: ["Minecraft Mace Wind Burst Cliff Jump in Badlands"] });
    const draft = { title, description: standardDescription({ kind: "short", title }), tags: standardTags({ kind: "short", texts: [title] }), category_id: "20", language: "en" as const, made_for_kids: false, contains_synthetic_media: false, visibility: "private" as const, publish_at: null };
    expect(draftProblems(draft)).toEqual([]);
  });
});

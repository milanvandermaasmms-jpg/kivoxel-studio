import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chaptersFrom, DN_FIXED, episodeText, fitTags, planShorts, publishProblem, shortText, stamp, thumbLines } from "./package";
import { buildTimeline, type Asset } from "./timeline";

const ids = ["b01-welcome-exterior", "b02-lumi-rocking-chair", "b03-pip-arrives", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep"];
const loops = ["b02-lumi-rocking-chair", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b08-blanket-together", "b09-lumi-falls-asleep", "b10-sleep-loop-base"];
const assets: Asset[] = [...ids.map((k) => ({ id: `story-${k}`, kind: "story" as const, lengthS: 14 })), ...loops.map((k) => ({ id: `loop-${k}`, kind: "loop" as const, lengthS: 8.75 }))];
const segs = buildTimeline(assets, 60);

describe("chapters from the timeline", () => {
  const ch = chaptersFrom(segs);
  it("follow YouTube's rules: first at 0:00, at least 3, each at least 10 s, rising", () => {
    expect(ch[0]).toEqual({ atS: 0, title: "Welcome to Lumi's cozy cottage" });
    expect(ch.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ch.length; i++) expect(ch[i].atS - ch[i - 1].atS).toBeGreaterThanOrEqual(10);
  });
  it("name the story scenes, falling asleep, the sleep views and the quiet end", () => {
    const titles = ch.map((c) => c.title);
    expect(titles).toContain("Pip comes to visit");
    expect(titles).toContain("Drifting off to sleep");
    expect(titles.filter((t) => t.startsWith("Sleep music ·")).length).toBeGreaterThan(3);
    expect(titles.at(-1)).toBe("Gentle fade into quiet");
  });
  it("formats times as YouTube reads them", () => {
    expect(stamp(0)).toBe("0:00");
    expect(stamp(725)).toBe("12:05");
    expect(stamp(3725)).toBe("1:02:05");
  });
  it("works on the real timeline of episode 1 when it is on this pc", () => {
    const f = join(homedir(), "FamilieMK-YouTube", "dreamnest", "fase4", "60min", "timeline.json");
    if (!existsSync(f)) return;
    const real = chaptersFrom(JSON.parse(readFileSync(f, "utf8")).segments);
    expect(real[0].atS).toBe(0);
    for (let i = 1; i < real.length; i++) expect(real[i].atS - real[i - 1].atS).toBeGreaterThanOrEqual(10);
  });
});

describe("title, description and tags", () => {
  const t = episodeText({ title: "Lumi's Cozy Fireplace Night", minutes: 60, chapters: chaptersFrom(segs) });
  it("fit YouTube's limits and are honest about AI and music", () => {
    expect(t.title.length).toBeLessThanOrEqual(100);
    expect(t.title).toMatch(/1 Hour Baby Sleep Music/);
    expect(t.description).toMatch(/0:00 Welcome/);
    expect(t.description).toMatch(/AI tools/);
    expect(t.description).toMatch(/public domain/);
    expect(t.description).not.toMatch(/[<>]/);
    expect(t.tags.join(",").length).toBeLessThanOrEqual(500);
    expect(publishProblem({ kind: "long", ...t, publishAt: null, qcOk: true, channelLinked: true })).toBeNull();
  });
  it("never says Lumi alone, always Lumi van Dreamnest in running text", () => {
    expect(t.description).toMatch(/Lumi van Dreamnest/);
  });
  it("drops tags that would pass 500 characters", () => {
    expect(fitTags(Array.from({ length: 100 }, (_, i) => `tag number ${i}`)).join(",").length).toBeLessThanOrEqual(500);
  });
});

describe("Shorts and thumbnail text", () => {
  it("3 Shorts of 20-30 s from story loops, never across a cut", () => {
    const shorts = planShorts(segs);
    expect(shorts).toHaveLength(3);
    for (const s of shorts) {
      expect(s.lengthS).toBeGreaterThanOrEqual(20);
      expect(s.lengthS).toBeLessThanOrEqual(30);
      const seg = segs.find((x) => x.asset === s.id.replace("short-", "loop-") && x.part === "story")!;
      expect(s.fromS).toBeGreaterThanOrEqual(seg.startS);
      expect(s.fromS + s.lengthS).toBeLessThanOrEqual(seg.startS + seg.lengthS);
      expect(shortText(s, "Lumi's Cozy Fireplace Night").title).toMatch(/#shorts/);
    }
  });
  it("puts the title on at most two lines", () => {
    expect(thumbLines("Lumi's Cozy Fireplace Night")).toEqual(["Lumi's Cozy", "Fireplace Night"]);
    expect(thumbLines("Sleep")).toEqual(["Sleep"]);
  });
});

describe("publish rules", () => {
  const base = { kind: "long" as const, title: "T", description: "D", tags: [], publishAt: null, qcOk: true, channelLinked: true };
  it("never without QC, a linked channel or a moment at least an hour ahead", () => {
    expect(publishProblem({ ...base, qcOk: false })).toMatch(/QC/);
    expect(publishProblem({ ...base, kind: "short", qcOk: false })).toBeNull();
    expect(publishProblem({ ...base, channelLinked: false })).toMatch(/niet aan YouTube gekoppeld/);
    expect(publishProblem({ ...base, publishAt: new Date(Date.now() + 10 * 60_000).toISOString() })).toMatch(/uur/);
    expect(publishProblem({ ...base, publishAt: new Date(Date.now() + 3 * 3600_000).toISOString() })).toBeNull();
    expect(publishProblem({ ...base, title: "x".repeat(101) })).toMatch(/100/);
  });
  it("always Made for Kids and the AI label", () => {
    expect(DN_FIXED).toMatchObject({ made_for_kids: true, contains_synthetic_media: true });
  });
});

describe("our own text layers", () => {
  it("thumbnail: title and subtitle as text, a drawn cloud, no stray ASS codes from the title", async () => {
    const { dnThumbAss, dnShortAss, assColour } = await import("./package");
    const a = dnThumbAss(["Lumi's Cozy", "Fireplace {Night}"], "1 Hour Sleep Music");
    expect(a).toMatch(/PlayResX: 1280/);
    expect(a).toContain(String.raw`Lumi's Cozy\NFireplace Night`);
    expect(a).toContain(String.raw`\p1}m `);
    expect(assColour("#F3D98B")).toBe("&H008BD9F3");
    const s = dnShortAss("Lumi falls asleep", 30);
    expect(s).toMatch(/PlayResY: 1920/);
    expect(s).toMatch(/0:00:30.00,Top/);
  });
});

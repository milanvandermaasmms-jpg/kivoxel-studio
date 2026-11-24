import { describe, expect, it } from "vitest";
import { blocking, publishCheck, type PublishFacts } from "./publishCheck";
import { EMPTY_DRAFT, type PublicationDraft } from "./publication";

const draft = (over: Partial<PublicationDraft> = {}): PublicationDraft => ({ ...EMPTY_DRAFT("en"), title: "Minecraft Cliff Fall Survival Challenge", description: "He jumps from the snow cliff. #minecraft", tags: ["minecraft", "survival", "cliff", "snow", "fall"], made_for_kids: false, contains_synthetic_media: false, ...over });
const facts = (over: Partial<PublishFacts> = {}): PublishFacts => ({ videoStatus: "approved", kind: "short", gameName: "Minecraft", exportOk: true, durationMs: 13_000, thumbnailChosen: false, thumbnailsAvailable: 3, channel: { name: "KIVOXEL", linked: true }, music: [{ file: "a.mp3", licensed: true, credit: "" }], clonedVoice: false, ...over });

describe("publicatiecheck (10 punten)", () => {
  it("a complete Short passes; only the title fit and the playlist stay for Milan", () => {
    const items = publishCheck(draft(), facts());
    expect(items).toHaveLength(10);
    expect(blocking(items)).toEqual([]);
    expect(items.find((i) => i.key === "title")!.status).toBe("zelf kijken");
  });

  it("blocks what may never go out: not approved, Dutch title, no audience choice, unlicensed music, missing export", () => {
    const keys = (d: Partial<PublicationDraft>, f: Partial<PublishFacts>) => blocking(publishCheck(draft(d), facts(f))).map((i) => i.key);
    expect(keys({}, { videoStatus: "review" })).toEqual(["approved"]);
    expect(keys({ title: "Minecraft Horror Nacht in de Sneeuw" }, {})).toEqual(["title"]);
    expect(keys({ made_for_kids: null }, {})).toEqual(["audience"]);
    // 24-11-2026 (Milan): the AI label is his choice: with the cloned voice and the label off (or not chosen) only a note.
    expect(keys({ contains_synthetic_media: false }, { clonedVoice: true })).toEqual([]);
    expect(keys({ contains_synthetic_media: null }, { clonedVoice: true })).toEqual([]);
    expect(publishCheck(draft({ contains_synthetic_media: false }), facts({ clonedVoice: true })).find((i) => i.key === "audience")!.status).toBe("let op");
    expect(keys({}, { music: [{ file: "x.mp3", licensed: false, credit: "" }] })).toEqual(["music"]);
    expect(keys({}, { exportOk: false })).toEqual(["export"]);
  });

  it("a viral score below the norm warns but never blocks Milan's choice", () => {
    const items = publishCheck(draft(), facts({ viralStatus: "onder 8,0" }));
    expect(items.find((i) => i.key === "viral")!.status).toBe("let op");
    expect(blocking(items)).toEqual([]);
  });
});

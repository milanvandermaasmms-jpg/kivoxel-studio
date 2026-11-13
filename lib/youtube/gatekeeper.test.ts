import { describe, expect, it } from "vitest";
import { hasRed, personalData, postcode, publicationGate, termHit, videoGate } from "./gatekeeper";

const kivoxel = { name: "KIVOXEL", safety_profile: "kids_gaming" as const, banned_words: [], synthetic_media: false };
const dreamnest = { name: "Dreamnest NL", safety_profile: "infant_sleep" as const, banned_words: ["geneest", "IQ"], synthetic_media: true };
const script = (hook: string) => ({ top_line: "BIJNA DOOD", hook, lines: [{ text: "Hij rent weg." }] });
const draft = { title: "Minecraft maar alles is lava", description: "Bouwen.", tags: ["minecraft"], made_for_kids: true, contains_synthetic_media: false };
const level = (items: ReturnType<typeof videoGate>, key: string) => items.find((i) => i.key === key)?.level;

describe("words and personal data (same rules as migration 046)", () => {
  it("finds a word only as a whole word, any case", () => {
    expect(termHit("Hallo TESTKIND!", ["testkind"])).toBe("testkind");
    expect(termHit("testkinderen", ["testkind"])).toBeNull();
    expect(termHit("x", ["", " a "])).toBeNull();
    expect(termHit("x", undefined)).toBeNull();
  });

  it("finds e-mail addresses and Dutch phone numbers, not ordinary numbers", () => {
    expect(personalData("mail a@b.nl")).toBe("een e-mailadres");
    expect(personalData("bel 06-12345678")).toBe("een telefoonnummer");
    expect(personalData("+31 6 12345678")).toBe("een telefoonnummer");
    expect(personalData("Dag 1 van 100, 2026")).toBeNull();
    expect(postcode("Kerkstraat 1, 1234 AB")).toBe(true);
    expect(postcode("100 dagen")).toBe(false);
  });
});

describe("video checks (Keur 1 and 2)", () => {
  it("blocks a private word, a banned word or a phone number in the script", () => {
    expect(level(videoGate({ script: script("Kijk wat Testkind bouwt"), channel: kivoxel, privateTerms: ["Testkind"], flags: [] }), "script-private")).toBe("red");
    expect(level(videoGate({ script: script("Dit geneest alles"), channel: dreamnest, privateTerms: [], flags: [] }), "script-banned")).toBe("red");
    expect(level(videoGate({ script: script("Bel 0612345678"), channel: kivoxel, privateTerms: [], flags: [] }), "script-data")).toBe("red");
  });

  it("blocks a face and asks to look at a real name", () => {
    const items = videoGate({ script: script("Kijk"), channel: kivoxel, privateTerms: [], flags: ["face", "real_name"] });
    expect(level(items, "face")).toBe("red");
    expect(level(items, "real-name")).toBe("orange");
  });

  it("is all green for a clean script", () => {
    expect(hasRed(videoGate({ script: script("Hij overleeft het net"), channel: kivoxel, privateTerms: ["Testkind"], flags: ["gamertag"] }))).toBe(false);
  });
});

describe("publication checks", () => {
  it("needs Made for Kids and the AI notice chosen", () => {
    const items = publicationGate({ draft: { ...draft, made_for_kids: null, contains_synthetic_media: null }, channel: kivoxel, privateTerms: [] });
    expect(level(items, "kids")).toBe("red");
    expect(level(items, "ai")).toBe("red");
  });

  it("asks to look again when a kids channel says not for kids, and warns about end screens", () => {
    expect(level(publicationGate({ draft: { ...draft, made_for_kids: false }, channel: kivoxel, privateTerms: [] }), "kids")).toBe("orange");
    expect(level(publicationGate({ draft: { ...draft, description: "Zie het eindscherm!" }, channel: kivoxel, privateTerms: [] }), "kids-cta")).toBe("orange");
  });

  it("holds Dreamnest to its rules: Made for Kids, AI notice, volume tip, banned words, Lumi with Dreamnest", () => {
    const items = publicationGate({ draft: { ...draft, title: "Lumi slaapt, IQ omhoog", made_for_kids: false }, channel: dreamnest, privateTerms: [] });
    for (const key of ["kids", "ai", "volume", "text-banned", "lumi"]) expect(level(items, key)).toBe("red");
    const good = publicationGate({ draft: { title: "Lumi van Dreamnest valt in slaap | 8 uur", description: "Zet het apparaat minstens 2 meter van het bedje.", tags: [], made_for_kids: true, contains_synthetic_media: true }, channel: dreamnest, privateTerms: [] });
    expect(hasRed(good)).toBe(false);
  });

  it("blocks private words and personal data in title, description and tags", () => {
    expect(level(publicationGate({ draft: { ...draft, tags: ["teststraat"] }, channel: kivoxel, privateTerms: ["Teststraat"] }), "text-private")).toBe("red");
    expect(level(publicationGate({ draft: { ...draft, description: "a@b.nl" }, channel: kivoxel, privateTerms: [] }), "text-data")).toBe("red");
  });
});

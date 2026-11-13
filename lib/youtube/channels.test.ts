import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ supabase: {}, friendlyError: (m: string) => m }));
const { channelProblem } = await import("./channels");

const ok = { name: "PixelRush", status: "active" as const, language: "en" as const, audience: null, brand_color: null };

describe("channel fields", () => {
  it("accepts a normal channel", () => {
    expect(channelProblem(ok)).toBeNull();
    expect(channelProblem({ ...ok, brand_color: "#22aa55", audience: "Minecraft-fans" })).toBeNull();
  });

  it("refuses an empty or very long name, a long audience and a wrong colour", () => {
    expect(channelProblem({ ...ok, name: "  " })).toMatch(/naam/);
    expect(channelProblem({ ...ok, name: "x".repeat(61) })).toMatch(/naam/);
    expect(channelProblem({ ...ok, audience: "x".repeat(301) })).toMatch(/doelgroep/);
    expect(channelProblem({ ...ok, brand_color: "groen" })).toMatch(/merkkleur/);
  });
});

const { parseWords, parseSlots, profileProblem, providersText, bannedIn } = await import("./channels");
const profile = { slug: "dreamnest-nl", mode: "generate" as const, safety_profile: "infant_sleep" as const, made_for_kids: true, synthetic_media: true, banned_words: ["IQ"], publish_slots: ["19:00"] };

describe("channel profile (migration 045)", () => {
  it("reads banned words from a comma or line list without doubles", () => {
    expect(parseWords("geneest, IQ\ntherapie;  iq ,, ")).toEqual(["geneest", "IQ", "therapie"]);
  });

  it("reads publish times and writes them as hh:mm in order", () => {
    expect(parseSlots("20:00, 8.30 19:00 20:00")).toEqual(["08:30", "19:00", "20:00"]);
    expect(parseSlots("25:00")).toEqual(["25:00"]);
  });

  it("accepts a good profile and names what is wrong", () => {
    expect(profileProblem(profile)).toBeNull();
    expect(profileProblem({ ...profile, slug: "Dream Nest" })).toMatch(/korte naam/);
    expect(profileProblem({ ...profile, publish_slots: ["25:00"] })).toMatch(/25:00/);
    expect(profileProblem({ ...profile, publish_slots: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"] })).toMatch(/6/);
  });

  it("shows the providers in plain Dutch", () => {
    expect(providersText({ llm: "gemini", tts: "google", music: "none", video: "none" })).toBe("Denken: Gemini · Stem: Google-stem · Muziek: uit · Video: uit");
    expect(providersText(undefined)).toContain("Denken: uit");
  });

  it("finds banned words as whole words only", () => {
    expect(bannedIn("Slaapmuziek die koliek weg neemt, IQ omhoog", ["koliek weg", "IQ", "slimmer"])).toEqual(["koliek weg", "IQ"]);
    expect(bannedIn("Liquid lights", ["IQ"])).toEqual([]);
  });
});

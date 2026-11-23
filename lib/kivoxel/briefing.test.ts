import { describe, expect, it } from "vitest";
import { briefingAnalysisLines, briefingAudioMode, briefingBoost, briefingCheck, briefingScriptLines, briefingVerdict, filterPlans, mergeKeyEvents, musicForBriefing, parseBriefing, parseKeyEvent, parseMarks, parseTimecode, type MontageFacts } from "./briefing";

const facts = (over: Partial<MontageFacts> = {}): MontageFacts => ({ format: "A", hasVoice: false, musicMoods: ["tense"], ranges: [{ startMs: 100_000, endMs: 130_000 }], peakOutMs: 6000, durationMs: 20_000, lines: [], ...over });

describe("slimme uploadbriefing", () => {
  it("reads time codes and mark lines, and refuses lines without a time", () => {
    expect(parseTimecode("02:30")).toBe(150_000);
    expect(parseTimecode("1:02:30")).toBe(3_750_000);
    expect(parseTimecode("2:75")).toBeNull();
    const { marks, rejected } = parseMarks("08:45 — bijna dood\n02:30 grappig moment\nergens halverwege");
    expect(marks).toEqual([{ atMs: 150_000, note: "grappig moment" }, { atMs: 525_000, note: "bijna dood" }]);
    expect(rejected).toEqual(["ergens halverwege"]);
  });

  it("an empty form is no briefing; junk from the database is cleaned", () => {
    expect(parseBriefing({ v: 1, output: "auto", voice: "auto" })).toBeNull();
    const b = parseBriefing({ keyEvent: "Pirate Token", moods: ["spannend", "boos"], voice: "luid", marks: [{ atMs: 5000, note: "x" }, { atMs: -1 }] })!;
    expect(b).toMatchObject({ keyEvent: "Pirate Token", moods: ["spannend"], marks: [{ atMs: 5000, note: "x" }] });
    expect(b.voice).toBeUndefined();
  });

  it("tells the analysis to look for the key event and the marks of this chunk, as direction and not as proof", () => {
    const lines = briefingAnalysisLines({ v: 1, keyEvent: "Pirate Token", marks: [{ atMs: 30_000, note: "a" }, { atMs: 500_000, note: "b" }] }, { startMs: 480_000, endMs: 960_000, count: 2 }).join("\n");
    expect(lines).toMatch(/never as proof/);
    expect(lines).toMatch(/"key_event"/);
    expect(lines).toMatch(/0:20 \(b\)/);
    expect(lines).not.toMatch(/\(a\)/);
  });

  it("accepts the key event only with a time and evidence, chunk times made absolute", () => {
    expect(parseKeyEvent({ key_event: { found: true, at: "01:10", evidence: "gold token in the chest" } }, 480_000)).toEqual({ found: true, atMs: 550_000, evidence: "gold token in the chest" });
    expect(parseKeyEvent({ key_event: { found: true, at: "01:10", evidence: "" } })!.found).toBe(false);
    expect(mergeKeyEvents([{ found: false, atMs: null, evidence: "" }, { found: true, atMs: 5, evidence: "x" }])!.found).toBe(true);
  });

  it("puts the found key event and the marks first in the planning", () => {
    const b = { v: 1 as const, marks: [{ atMs: 200_000, note: "" }] };
    expect(briefingBoost(b, { found: true, atMs: 110_000, evidence: "x" }, { startMs: 100_000, endMs: 120_000 })).toBe(60);
    expect(briefingBoost(b, null, { startMs: 190_000, endMs: 210_000 })).toBe(30);
    expect(briefingBoost(null, null, { startMs: 0, endMs: 1 })).toBe(0);
  });

  it("makes only the videos Milan asked for", () => {
    const plans = [{ format: "A" }, { format: "B" }, { format: "A" }, { format: "A" }, { format: "C" }];
    expect(filterPlans(plans, { v: 1, output: "long" }).plans).toEqual([{ format: "C" }]);
    expect(filterPlans(plans, { v: 1, output: "shorts", shorts: 2 }).plans).toHaveLength(2);
    expect(filterPlans(plans, null).plans).toHaveLength(5);
  });

  it("the script gets the arc, and is told NOT to claim a key event the analysis did not see", () => {
    const seen = briefingScriptLines({ v: 1, keyEvent: "Pirate Token", moods: ["spannend"] }, { found: true, atMs: 550_000, evidence: "token" }).join("\n");
    expect(seen).toMatch(/seen at 9:10/);
    expect(seen).toMatch(/Mood: tense/);
    expect(briefingScriptLines({ v: 1, keyEvent: "Pirate Token" }, { found: false, atMs: null, evidence: "" }).join("\n")).toMatch(/did NOT see it\. Never mention it/);
  });

  it("voice and music choice override the automatic split; the library narrows to the asked mood", () => {
    expect(briefingAudioMode({ v: 1, voice: "none", music: "none" })).toBe("alleen_game");
    expect(briefingAudioMode({ v: 1, voice: "voice" })).toBe("vo_muziek");
    expect(briefingAudioMode({ v: 1 })).toBeNull();
    const lib = [{ moods: ["chill"] }, { moods: ["dark", "epic"] }];
    expect(musicForBriefing(lib, { v: 1, music: "mystery" }).tracks).toEqual([{ moods: ["dark", "epic"] }]);
    expect(musicForBriefing(lib, { v: 1, music: "funny" }).note).toMatch(/geen passende track/);
  });

  it("checks afterwards whether the montage followed the briefing; a missed instruction blocks approval", () => {
    const b = { v: 1 as const, keyEvent: "Pirate Token", voice: "none" as const, music: "tense" as const, moods: ["spannend" as const] };
    const ok = briefingCheck(b, { found: true, atMs: 120_000, evidence: "token" }, facts());
    expect(ok.filter((c) => c.status === "ok").map((c) => c.key)).toEqual(["key_event", "voice", "music"]);
    expect(briefingVerdict(ok).ok).toBe(true);
    const bad = briefingCheck(b, { found: true, atMs: 300_000, evidence: "token" }, facts({ hasVoice: true, musicMoods: ["chill"] }));
    expect(bad.filter((c) => c.status === "niet").map((c) => c.key)).toEqual(["key_event", "voice", "music"]);
    expect(briefingVerdict(bad).text).toMatch(/zit niet in deze montage/);
    const notSeen = briefingCheck({ v: 1, keyEvent: "Pirate Token" }, { found: false, atMs: null, evidence: "" }, facts());
    expect(notSeen[0]).toMatchObject({ status: "niet" });
    expect(notSeen[0].why).toMatch(/niet in beeld gezien/);
  });

  it("an instruction Milan let go no longer blocks", () => {
    const c = briefingCheck({ v: 1, voice: "voice", waived: ["voice"] }, null, facts());
    expect(c[0].status).toBe("vervallen");
    expect(briefingVerdict(c).ok).toBe(true);
  });
});

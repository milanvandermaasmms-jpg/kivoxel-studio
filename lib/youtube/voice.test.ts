import { describe, expect, it } from "vitest";
import { buildEditPlan, checkMoment, scriptPrompt, type Moment } from "./analysis";
import { rankShortHooks, weakOpening, type Hook } from "./hooks";
import { DEFAULT_VOICE } from "./analysisData";

const moment = (): Moment => {
  const r = checkMoment({ kind: "near_death", start: "0:10", peak: "0:22", end: "0:30", reason: "Creeper behind him with one heart", score: 80, has_context: true, has_payoff: true }, 600_000);
  if ("error" in r) throw new Error(r.error);
  return r.moment;
};

describe("an enthusiastic narrator for kids", () => {
  it("every script asks for an excited gaming buddy for young viewers", () => {
    for (const f of ["A", "B", "C"] as const) {
      const p = scriptPrompt(f, null, [moment()], buildEditPlan(f, [moment()]), "en");
      expect(p).toMatch(/kids/);
      expect(p).toMatch(/excited gaming buddy/);
      expect(p).toMatch(/invent nothing/);
    }
  });
  it("only Shorts get the first-2-seconds rule", () => {
    expect(scriptPrompt("A", null, [moment()], buildEditPlan("A", [moment()]), "en")).toMatch(/first 2 seconds/);
    expect(scriptPrompt("C", null, [moment()], buildEditPlan("C", [moment()]), "en")).not.toMatch(/first 2 seconds/);
  });
  it("the default voice is the enthusiastic one, a little faster", () => {
    expect(DEFAULT_VOICE.voice_name).toMatch(/Fenrir/);
    expect(DEFAULT_VOICE.speaking_rate).toBeGreaterThanOrEqual(1.1);
    expect(DEFAULT_VOICE.speaking_rate).toBeLessThanOrEqual(1.2);
  });
});

describe("the first seconds of a Short", () => {
  it("recognises openings that waste the first seconds", () => {
    expect(weakOpening("Hey guys, welcome back to the channel")).not.toBeNull();
    expect(weakOpening("In this video we explore a cave")).not.toBeNull();
    expect(weakOpening("So I was walking through the snow and then something happened")).not.toBeNull();
    expect(weakOpening("Three creepers. One heart!")).toBeNull();
  });
  it("puts strong openings first, so the default hook is a strong one", () => {
    const h = (first_line: string): Hook => ({ type: "challenge", first_line, overlay: "X", cold_open: false });
    const ranked = rankShortHooks([h("Hey guys, look at this"), h("One heart. Lava below!"), h("RUN, the Warden is here!")]);
    expect(ranked.map((x) => x.first_line)).toEqual(["One heart. Lava below!", "RUN, the Warden is here!", "Hey guys, look at this"]);
  });
});

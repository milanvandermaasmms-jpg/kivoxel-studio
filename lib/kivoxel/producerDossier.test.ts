import { describe, expect, it } from "vitest";
import type { Segment } from "../youtube/analysis";
import { buildDossier, dossierText, speakSeconds } from "./producerDossier";

const seg = (part: Segment["part"], a: number, b: number, out: number, speed = 1, effects: string[] = [], note = ""): Segment => ({ part, src_start_ms: a, src_end_ms: b, out_start_ms: out, speed, effects, note });
// The v2 of "Epic Sky Fall Clutch" (Night Walk With The Realm Tool).
const plan = [seg("teaser", 2_464_300, 2_465_700, 0, 1, ["zoom"], "teaser van de payoff"), seg("build", 2_461_000, 2_463_800, 1400, 1, [], "opbouw"), seg("payoff", 2_463_800, 2_464_700, 4200, 0.5, ["slowmo"], "slow-motion vlak voor de piek"), seg("payoff", 2_464_700, 2_466_800, 6000, 1, [], "Schade: van 10 naar 1 hartjes")];

describe("producerdossier", () => {
  const d = buildDossier({ format: "short", title: "Night Walk With The Realm Tool", topLine: "CLOSEST CALL EVER", hook: "Watch that zombie.", lines: [{ at_ms: 3300, text: "Close one." }, { at_ms: 5000, text: "Hold on, big hit coming." }, { at_ms: 7600, text: "That hurt." }], plan, targetMs: 11_600, voice: true, gate: null });

  it("has a shot table with running timecodes, the essential shots marked", () => {
    expect(d.shots.map((s) => [s.id, s.startMs, s.endMs])).toEqual([["S1", 0, 1400], ["S2", 1400, 4200], ["S3", 4200, 6000], ["S4", 6000, 8100]]);
    expect(d.shots.filter((s) => s.essential).map((s) => s.id)).toEqual(["S1", "S3", "S4"]);
    expect(d.shots[3].vo).toBe('"That hurt."');
  });

  it("writes the voice-over out with speaking time and the planned silences", () => {
    expect(speakSeconds("Hold on, big hit coming.")).toBe(1.9);
    expect(d.silences[0]).toEqual({ startMs: 0, endMs: 3300 });
    expect(d.endImage).toMatch(/Schade: van 10 naar 1 hartjes/);
  });

  it("gives a viewing test, one variant that changes one factor, and a plan to measure — without predictions", () => {
    expect(d.viewingTest[0]).toMatch(/eerste 2 seconden/);
    expect(d.variant.b).toMatch(/zonder stem/);
    expect(d.measure.join(" ")).toMatch(/mediaan/);
    const text = dossierText(d, "Night Walk");
    expect(text).toMatch(/SHOTS/);
    expect(text).not.toMatch(/%\s*kans|viraal gaat|views verwacht/i);
  });

  it("long videos get three title and thumbnail combinations", () => {
    const l = buildDossier({ format: "long", title: "A", titles: ["A", "B", "C"], topLine: null, hook: "", lines: [], plan, targetMs: 600_000, voice: false, thumbnails: [{ label: "cover", text: "TOTEM SAVE" }] });
    expect(l.packaging).toHaveLength(3);
    expect(l.packaging[0]).toMatchObject({ title: "A", chosen: true });
    expect(l.packaging[0].thumbnail).toMatch(/TOTEM SAVE/);
  });
});

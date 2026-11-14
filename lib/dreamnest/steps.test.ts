import { describe, expect, it } from "vitest";
import { FLOW, nextStep, parseProgress, safeMediaPath, scriptFor, stepViews } from "./steps";

const job = (step: string, status: string, at: string) => ({ step, status, created_at: at });

describe("Dreamnest steps in the Studio", () => {
  it("the newest job decides a step; cancelled counts as not started", () => {
    const v = stepViews([job("dn_concept", "failed", "1"), job("dn_concept", "done", "2"), job("dn_keyframes", "cancelled", "3")]);
    expect(v.map((x) => x.state)).toEqual(["done", "todo", "todo", "todo", "todo"]);
  });
  it("only the first unfinished step can start, and nothing while a step waits or runs", () => {
    expect(nextStep(stepViews([]))?.step).toBe("dn_concept");
    expect(nextStep(stepViews([job("dn_concept", "done", "1")]))?.step).toBe("dn_keyframes");
    expect(nextStep(stepViews([job("dn_concept", "done", "1"), job("dn_keyframes", "running", "2")]))).toBeNull();
    expect(nextStep(stepViews([job("dn_concept", "done", "1"), job("dn_keyframes", "failed", "2")]))?.step).toBe("dn_keyframes");
    expect(nextStep(stepViews(FLOW.map((f, i) => job(f.step, "done", String(i)))))).toBeNull();
  });
  it("runs the tested script of each phase, with safe arguments", () => {
    expect(scriptFor("dn_keyframes", 60, {})).toEqual({ script: "fase1.ts", args: ["b"] });
    expect(scriptFor("dn_animate", 60, { only: "loop-b04-tea" })?.args).toEqual(["--res", "1080p", "--only", "loop-b04-tea"]);
    expect(scriptFor("dn_animate", 60, { only: "x; del *" })?.args).toEqual(["--res", "1080p"]);
    expect(scriptFor("dn_music", 60, { seed: 42 })?.args).toEqual(["--seed", "42"]);
    expect(scriptFor("dn_render", 90, {})?.args).toEqual(["--minutes", "90", "--seed", "11"]);
    expect(scriptFor("dn_concept", 60, {})).toBeNull();
  });
  it("paid steps say their maximum; the pc steps are free", () => {
    expect(FLOW.filter((f) => f.maxCents > 0).map((f) => f.step)).toEqual(["dn_keyframes", "dn_animate"]);
  });
  it("reads the render percentage from the log", () => {
    expect(parseProgress("[09:12:27] Render 54% (50/73), nog ± 20 min")).toBe(54);
    expect(parseProgress("Muziek a-story (370 s)...")).toBeNull();
  });
  it("only shows media inside the Dreamnest folder", () => {
    expect(safeMediaPath("fase4/60min/preview.mp4")).toBe(true);
    expect(safeMediaPath("keyframes/huiskamer-01/b04-tea.png")).toBe(true);
    for (const bad of ["../secret.mp4", "fase4/../../x.mp4", "C:/x.mp4", "/etc/x.png", "a//b.png", "fase4/qc.json", "x.html", "a\b.mp4"]) expect(safeMediaPath(bad)).toBe(false);
  });
});

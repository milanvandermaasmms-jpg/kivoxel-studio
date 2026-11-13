import { describe, expect, it } from "vitest";
import { DN_STEPS, dreamnestEnabled, dreamnestMayStart, planChunks, withinBudget } from "./core";

describe("feature flag", () => {
  it("is off unless FEATURE_DREAMNEST is exactly true", () => {
    expect(dreamnestEnabled({})).toBe(false);
    expect(dreamnestEnabled({ FEATURE_DREAMNEST: "false" })).toBe(false);
    expect(dreamnestEnabled({ FEATURE_DREAMNEST: "1" })).toBe(false);
    expect(dreamnestEnabled({ FEATURE_DREAMNEST: "ja" })).toBe(false);
    expect(dreamnestEnabled({ FEATURE_DREAMNEST: "true" })).toBe(true);
    expect(dreamnestEnabled({ FEATURE_DREAMNEST: " TRUE " })).toBe(true);
  });
});

describe("KIVOXEL goes first", () => {
  it("Dreamnest only starts while the KIVOXEL main lane is idle and empty", () => {
    expect(dreamnestMayStart({ mainBusy: false })).toBe(true);
    expect(dreamnestMayStart({ mainBusy: true })).toBe(false);
    expect(dreamnestMayStart({ mainBusy: false, waiting: 2 })).toBe(false);
  });

  it("every Dreamnest step is recognisable and never a KIVOXEL step", () => {
    expect(DN_STEPS.every((s) => s.startsWith("dn_"))).toBe(true);
  });
});

describe("render in chunks", () => {
  it("cuts 60 minutes into 30 chunks of 2 minutes", () => {
    const c = planChunks(3600);
    expect(c).toHaveLength(30);
    expect(c[29]).toEqual({ index: 29, startSec: 3480, lengthSec: 120 });
  });
  it("keeps a shorter last chunk and refuses nonsense", () => {
    expect(planChunks(250).map((c) => c.lengthSec)).toEqual([120, 120, 10]);
    expect(planChunks(0)).toEqual([]);
    expect(planChunks(100, 0)).toEqual([]);
  });
});

describe("budget ceiling", () => {
  it("stops a call that would go over the budget", () => {
    expect(withinBudget({ budget_cents: 500, spent_cents: 400 }, 100)).toBe(true);
    expect(withinBudget({ budget_cents: 500, spent_cents: 400 }, 101)).toBe(false);
    expect(withinBudget({ budget_cents: 0, spent_cents: 0 }, 1)).toBe(false);
  });
});

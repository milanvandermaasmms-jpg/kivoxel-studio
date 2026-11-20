import { describe, expect, it } from "vitest";
import { boostOf, boostsSummary, kindBoosts, MAX_BOOST, type KindSample } from "./learnedKinds";

const many = (kind: KindSample["kind"], pct: number, n: number, views = 1000): KindSample[] => Array.from({ length: n }, () => ({ kind, avgViewPct: pct, views }));

describe("learning from what viewers really watched", () => {
  it("kinds watched better than average get points, swiped-away kinds lose points", () => {
    const b = kindBoosts([...many("near_death", 90, 10), ...many("discovery", 30, 10)]);
    expect(boostOf(b, "near_death")).toBeGreaterThan(0);
    expect(boostOf(b, "discovery")).toBeLessThan(0);
    expect(boostOf(b, "rescue")).toBe(0);
  });

  it("never more than MAX_BOOST, and few Shorts count for less", () => {
    const big = kindBoosts([...many("near_death", 200, 40), ...many("discovery", 10, 40)]);
    expect(Math.abs(boostOf(big, "near_death"))).toBeLessThanOrEqual(MAX_BOOST);
    const few = kindBoosts([...many("near_death", 90, 3), ...many("discovery", 30, 3)]);
    const lots = kindBoosts([...many("near_death", 90, 30), ...many("discovery", 30, 30)]);
    expect(boostOf(few, "near_death")).toBeLessThan(boostOf(lots, "near_death"));
  });

  it("ignores Shorts YouTube did not really show, and kinds with too few Shorts", () => {
    expect(kindBoosts([...many("near_death", 90, 10, 50), ...many("discovery", 30, 10, 50)])).toEqual([]);
    expect(boostOf(kindBoosts([...many("near_death", 90, 2), ...many("discovery", 30, 10)]), "near_death")).toBe(0);
  });

  it("says in Dutch what it learned", () => {
    expect(boostsSummary(kindBoosts([...many("near_death", 90, 10), ...many("discovery", 30, 10)]))).toMatch(/near_death \+\d+ \(10 Shorts, 90% bekeken\)/);
    expect(boostsSummary([])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { findChannel, isDreamnestChannel, isRouteSlug, routeSlug } from "./studioRoutes";

const kiv = { id: "k", slug: "kivoxel", is_default: true, safety_profile: "kids_gaming" };
const dn = { id: "d", slug: "dreamnest-nl", is_default: false, safety_profile: "infant_sleep" };
const dn2 = { id: "e", slug: "dreamnest-en", is_default: false, safety_profile: "infant_sleep" };
const other = { id: "o", slug: "koken", is_default: false, safety_profile: "general" };
const all = [kiv, dn, dn2, other];

describe("one address per channel", () => {
  it("KIVOXEL is /studio/kivoxel, the first Dreamnest channel /studio/dreamnest, the rest their own slug", () => {
    expect(all.map((c) => routeSlug(c, all))).toEqual(["kivoxel", "dreamnest", "dreamnest-en", "koken"]);
    expect(routeSlug({ id: "x", slug: "abc", is_default: true }, [])).toBe("kivoxel");
  });
  it("finds the channel back from the address", () => {
    expect(findChannel(all, "kivoxel")?.id).toBe("k");
    expect(findChannel(all, "dreamnest")?.id).toBe("d");
    expect(findChannel(all, "dreamnest-en")?.id).toBe("e");
    expect(findChannel(all, "bestaat-niet")).toBeNull();
  });
  it("knows a Dreamnest channel and accepts only clean addresses", () => {
    expect(isDreamnestChannel(dn)).toBe(true);
    expect(isDreamnestChannel(kiv)).toBe(false);
    expect(isRouteSlug("dreamnest")).toBe(true);
    for (const bad of ["Dreamnest", "a--b", "-a", "a/b", "x".repeat(41)]) expect(isRouteSlug(bad)).toBe(false);
  });
});

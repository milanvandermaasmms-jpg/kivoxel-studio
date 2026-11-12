import { describe, expect, it } from "vitest";
import { isPublicPath } from "../publicPages";

describe("public pages without login", () => {
  it("only the Kivoxel homepage and its sub pages", () => {
    expect(isPublicPath("/kivoxel")).toBe(true);
    expect(isPublicPath("/kivoxel/privacy")).toBe(true);
    expect(isPublicPath("/kivoxelx")).toBe(false);
    expect(isPublicPath("/youtube")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath(null)).toBe(false);
  });
});

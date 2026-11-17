import { describe, expect, it } from "vitest";
import { downloadName } from "./downloadName";

describe("downloadName", () => {
  it("makes a Windows-safe file name from the title", () => {
    expect(downloadName('Minecraft: "Creeper" in the cave?! #shorts', "mp4")).toBe("Minecraft Creeper in the cave ! shorts.mp4");
    expect(downloadName("ONE HEART LEFT...", "jpg")).toBe("ONE HEART LEFT.jpg");
  });
  it("falls back when there is no title yet, and keeps names short", () => {
    expect(downloadName("   ", "mp4")).toBe("kivoxel-video.mp4");
    expect(downloadName("x".repeat(200), "mp4")).toHaveLength(94);
  });
});

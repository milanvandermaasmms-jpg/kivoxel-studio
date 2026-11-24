import { describe, expect, it } from "vitest";
import { tiktokCaption } from "./tiktokCaption";

describe("tiktokCaption", () => {
  it("uses the English title and a few hashtags from the YouTube tags", () => {
    expect(tiktokCaption(["Minecraft Cave Drop Water Bucket Clutch"], ["minecraft survival", "water bucket clutch", "minecraft"])).toBe(
      "Minecraft Cave Drop Water Bucket Clutch\n\n#minecraft #minecraftshorts #gaming #minecraftsurvival #waterbucketclutch",
    );
  });

  it("skips a Dutch title and moves hashtags out of the title", () => {
    const c = tiktokCaption(["Minecraft Horror Nacht in de Sneeuw", "Horror Night in the Snow #scary"]);
    expect(c.split("\n\n")[0]).toBe("Horror Night in the Snow");
    expect(c).toContain("#scary");
    expect(c).not.toContain("Nacht");
  });

  it("never has more than six hashtags", () => {
    const tags = tiktokCaption(["x"], ["a1a", "b2b", "c3c", "d4d", "e5e", "f6f"]).split("\n\n")[1].split(" ");
    expect(tags).toHaveLength(6);
  });
});

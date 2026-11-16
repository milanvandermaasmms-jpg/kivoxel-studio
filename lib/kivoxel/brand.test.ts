import { describe, expect, it } from "vitest";
import { assColour, brandProblems, checkHeaderPixels, HEADER, headerStyle, headerText, hexToRgb } from "./brand";
import { thumbAss, THUMB_SIZE } from "../youtube/thumbnails";

describe("brand: yellow thumbnail header", () => {
  it("the brand file is valid and keeps the yellow of 14-11-2026", () => {
    expect(brandProblems()).toEqual([]);
    expect(HEADER.color_hex).toBe("#FFE500");
    expect(HEADER.font.family).toBe("Arial Black");
  });

  it("writes ASS colours as alpha-blue-green-red", () => {
    expect(assColour("#FFE500")).toBe("&H0000E5FF");
    expect(assColour("#000000", 150)).toBe("&H96000000");
    expect(hexToRgb("#ffe500")).toEqual([255, 229, 0]);
  });

  it("draws exactly the header style that was in the thumbnail code before (no visual change)", () => {
    expect(headerStyle(THUMB_SIZE.short)).toBe("Style: Thumb,Arial Black,130,&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,10,4,8,40,40,220,1");
    expect(headerStyle(THUMB_SIZE.long)).toBe("Style: Thumb,Arial Black,110,&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,8,4,8,40,40,36,1");
    expect(thumbAss(THUMB_SIZE.short, "BIJNA")).toContain(headerStyle(THUMB_SIZE.short));
  });

  it("makes header text: capitals, at most 4 words, no punctuation", () => {
    expect(headerText("the creeper got him!! right there")).toBe("THE CREEPER GOT HIM");
    expect(headerText(null)).toBe("");
  });

  describe("pixel check", () => {
    const w = 40;
    const h = 20;
    const picture = (fill: (x: number, y: number) => [number, number, number]) => {
      const out = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(fill(x, y), (y * w + x) * 3);
      return out;
    };
    const inBlock = (x: number, y: number) => x >= 5 && x < 35 && y >= 3 && y < 17;
    const reference = picture((x, y) => (inBlock(x, y) ? [255, 229, 0] : [0, 0, 0]));
    const spec = { ...HEADER, check: { ...HEADER.check, min_text_pixels: 50 } };

    it("passes when the letters are brand yellow (with some JPEG noise)", () => {
      const thumb = picture((x, y) => (inBlock(x, y) ? [240, 220, 30] : [30, 120, 60]));
      const r = checkHeaderPixels(reference, thumb, w, h, spec);
      expect(r.ok).toBe(true);
      expect(r.matchShare).toBe(1);
    });

    it("fails when the header is another colour", () => {
      const thumb = picture((x, y) => (inBlock(x, y) ? [255, 255, 255] : [0, 0, 0]));
      expect(checkHeaderPixels(reference, thumb, w, h, spec).reason).toMatch(/wijkt af/);
    });

    it("fails when the header moved", () => {
      const thumb = picture((x, y) => (inBlock(x, y - 8) ? [255, 229, 0] : [0, 0, 0]));
      expect(checkHeaderPixels(reference, thumb, w, h, spec).ok).toBe(false);
    });

    it("fails when there is (almost) no header", () => {
      const empty = picture(() => [0, 0, 0]);
      expect(checkHeaderPixels(empty, empty, w, h, spec).reason).toMatch(/ontbreekt/);
    });

    it("refuses pictures of the wrong size", () => {
      expect(checkHeaderPixels(reference, new Uint8Array(3), w, h, spec).ok).toBe(false);
    });
  });
});

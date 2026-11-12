import { describe, expect, it } from "vitest";
import { computeFingerprint, sampleRanges } from "./fingerprint";
import { isFingerprint, nextChunk, videoExtension } from "./protocol";

describe("fingerprint", () => {
  it("reads small files completely and large files at start, middle and end", () => {
    expect(sampleRanges(20, 10)).toEqual([[0, 20]]);
    expect(sampleRanges(30, 10)).toEqual([[0, 30]]);
    expect(sampleRanges(101, 10)).toEqual([
      [0, 10],
      [45, 55],
      [91, 101],
    ]);
  });

  it("is stable, and changes with a different size or content", async () => {
    const a = new Uint8Array(100).fill(1);
    const fp = await computeFingerprint(new Blob([a]), 10);
    expect(isFingerprint(fp)).toBe(true);
    expect(await computeFingerprint(new Blob([a]), 10)).toBe(fp);
    expect(await computeFingerprint(new Blob([a, new Uint8Array(1)]), 10)).not.toBe(fp);
    const b = a.slice();
    b[0] = 2;
    expect(await computeFingerprint(new Blob([b]), 10)).not.toBe(fp);
  });
});

describe("upload protocol", () => {
  it("walks through the file in pieces", () => {
    expect(nextChunk(0, 20, 8)).toEqual({ start: 0, end: 8 });
    expect(nextChunk(16, 20, 8)).toEqual({ start: 16, end: 20 });
    expect(nextChunk(20, 20, 8)).toBeNull();
  });

  it("accepts only video files", () => {
    expect(videoExtension("PS5 opname.MP4")).toBe("mp4");
    expect(videoExtension("clip.webm")).toBe("webm");
    expect(videoExtension("notes.txt")).toBeNull();
    expect(videoExtension("mp4")).toBeNull();
  });
});

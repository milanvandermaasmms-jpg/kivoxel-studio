import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./studio";

describe("studio formatting", () => {
  it("shows sizes in Dutch notation", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 kB");
    expect(formatBytes(3.5 * 1024 ** 3)).toBe("3,5 GB");
  });

  it("shows durations as clock time", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(754_000)).toBe("12:34");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});

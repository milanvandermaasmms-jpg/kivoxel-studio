import { describe, expect, it } from "vitest";
import { changedCount, scriptDiff } from "./scriptDiff";

const v1 = { top_line: "3 CREEPERS", hook: "He has one heart left.", lines: [{ at_ms: 0, text: "He runs." }, { at_ms: 5000, text: "Too slow." }] };

describe("script diff", () => {
  it("shows nothing new when the versions are the same", () => {
    const rows = scriptDiff(v1, v1);
    expect(rows.every((r) => r.kind === "same")).toBe(true);
    expect(changedCount(rows)).toBe(0);
  });

  it("marks a changed hook and line as removed + new, and keeps the rest", () => {
    const v2 = { ...v1, hook: "One heart. Three creepers.", lines: [{ at_ms: 0, text: "He runs." }, { at_ms: 4000, text: "Faster now!" }] };
    const rows = scriptDiff(v1, v2);
    expect(rows).toContainEqual({ kind: "removed", label: "Hook", text: "He has one heart left." });
    expect(rows).toContainEqual({ kind: "new", label: "Hook", text: "One heart. Three creepers." });
    expect(rows).toContainEqual({ kind: "removed", label: "Regel", text: "Too slow." });
    expect(rows).toContainEqual({ kind: "same", label: "Regel", text: "He runs." });
    expect(changedCount(rows)).toBe(2);
  });
});

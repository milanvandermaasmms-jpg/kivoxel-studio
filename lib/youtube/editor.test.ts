import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { addLine, commit, editorProblems, moveSegment, redo, relayout, removeSegment, setLine, setSegmentText, setSpeed, splitSegment, startHistory, toggleZoom, totalMs, trimSegment, undo, type EditorState } from "./editor";

const seg = (src_start_ms: number, src_end_ms: number, speed = 1, part: Segment["part"] = "build"): Segment => ({ part, src_start_ms, src_end_ms, out_start_ms: 0, speed, effects: [], note: part });
const state: EditorState = {
  topLine: "NO WAY OUT",
  lines: [
    { at_ms: 0, text: "Fighting off the swarm." },
    { at_ms: 5000, text: "Four of them." },
  ],
  segments: relayout([seg(221_000, 222_500, 1, "cold_open"), seg(209_000, 220_000, 1.1), seg(221_000, 227_000, 1, "payoff")]),
};

describe("timeline", () => {
  it("lays the segments one after the other at their speed", () => {
    expect(state.segments.map((s) => s.out_start_ms)).toEqual([0, 1500, 11_500]);
    expect(totalMs(state.segments)).toBe(17_500);
  });

  it("trims, removes and moves, and lays out again", () => {
    const trimmed = trimSegment(state, 1, 214_000, 220_000);
    expect(trimmed.segments[2].out_start_ms).toBe(1500 + Math.round(6000 / 1.1));
    expect(removeSegment(state, 0).segments[0].out_start_ms).toBe(0);
    const moved = moveSegment(state, 2, -1);
    expect(moved.segments.map((s) => s.part)).toEqual(["cold_open", "payoff", "build"]);
    expect(moveSegment(state, 0, -1)).toBe(state);
  });

  it("splits a segment at a point in the final video, keeping the speed", () => {
    const split = splitSegment(state, 1, 2200);
    expect(split.segments).toHaveLength(4);
    expect(split.segments[1]).toMatchObject({ src_start_ms: 209_000, src_end_ms: 209_000 + 2420 });
    expect(split.segments[2]).toMatchObject({ src_start_ms: 211_420, src_end_ms: 220_000, speed: 1.1 });
    expect(totalMs(split.segments)).toBeCloseTo(totalMs(state.segments), -1);
    expect(splitSegment(state, 1, 100)).toBe(state);
  });

  it("sets speed within 0.5-2x, toggles zoom and text", () => {
    expect(setSpeed(state, 2, 5).segments[2].speed).toBe(2);
    expect(toggleZoom(state, 0).segments[0].effects).toContain("zoom");
    expect(toggleZoom(toggleZoom(state, 0), 0).segments[0].effects).not.toContain("zoom");
    expect(setSegmentText(state, 1, "4 ZOMBIES").segments[1].text).toBe("4 ZOMBIES");
    expect(setSegmentText(state, 1, "  ").segments[1].text).toBeUndefined();
  });
});

describe("narration and checks", () => {
  it("keeps lines sorted when edited or added", () => {
    const s = addLine(setLine(state, 1, { at_ms: 900 }), 3000);
    expect(s.lines.map((l) => l.at_ms)).toEqual([0, 900, 3000]);
  });

  it("names what must be fixed before saving", () => {
    expect(editorProblems(state, 1_444_000)).toEqual([]);
    expect(editorProblems(addLine(state, 30_000), 1_444_000)).toEqual(["Een tekstregel is leeg.", "Een tekstregel valt buiten de video."]);
    expect(editorProblems(trimSegment(state, 0, 221_000, 221_100), 1_444_000)[0]).toMatch(/korter dan 0,3 s/);
    expect(editorProblems(trimSegment(state, 2, 221_000, 1_500_000), 1_444_000)[0]).toMatch(/buiten de opname/);
    expect(editorProblems({ ...state, segments: [] }, null)[0]).toMatch(/geen enkel fragment/);
  });
});

describe("undo and redo", () => {
  it("goes back and forward through the edits", () => {
    let h = startHistory(state);
    h = commit(h, removeSegment(h.present, 0));
    h = commit(h, toggleZoom(h.present, 0));
    expect(h.present.segments).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present).toBe(state);
    h = redo(h);
    expect(h.present.segments).toHaveLength(2);
    expect(h.present.segments[0].effects).not.toContain("zoom");
    expect(undo(startHistory(state)).present).toBe(state);
  });
});

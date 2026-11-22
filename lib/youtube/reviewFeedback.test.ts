import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { applyFixes, CROP_SHIFT, feedbackKey, feedbackNote, fixesFrom, needsNewMoment, plannedChanges, sideOf, type FeedbackItem } from "./reviewFeedback";

const seg = (a: number, b: number, out: number, speed = 1): Segment => ({ part: "build", src_start_ms: a, src_end_ms: b, out_start_ms: out, speed, effects: [], note: "" });
const cut = { segments: [seg(10_000, 15_000, 0), seg(20_000, 26_000, 5000), seg(26_000, 28_000, 11_000)], targetMs: 13_000 };

describe("feedback op een moment → de volgende versie", () => {
  it("Milan's example: bad crop at 00:08, the opponent leaves on the right → that piece moves right", () => {
    const items: FeedbackItem[] = [{ atMs: 8000, kind: "crop", text: "de tegenstander verdwijnt rechts uit beeld" }];
    expect(sideOf(items[0])).toBe("right");
    const { cut: next, changes } = applyFixes(cut, fixesFrom(items), 60_000);
    expect(next.segments[1].crop_x).toBe(CROP_SHIFT);
    expect(next.segments[0].crop_x).toBeUndefined();
    expect(next.segments[2].crop_x).toBeUndefined();
    expect(changes.join(" ")).toMatch(/rechts/);
    // The fragment choice stays: same source times.
    expect(next.segments.map((s) => [s.src_start_ms, s.src_end_ms])).toEqual(cut.segments.map((s) => [s.src_start_ms, s.src_end_ms]));
  });

  it("near a cut the piece on the other side of the cut moves too", () => {
    const { cut: next } = applyFixes(cut, { crop: [{ atMs: 10_700, side: "left" }] }, 60_000);
    expect(next.segments[1].crop_x).toBe(-CROP_SHIFT);
    expect(next.segments[2].crop_x).toBe(-CROP_SHIFT);
  });

  it("payoff missing: the last piece runs on, never past the end of the recording", () => {
    const a = applyFixes(cut, fixesFrom([{ atMs: 12_000, kind: "payoff", text: "" }]), 60_000);
    expect(a.cut.segments[2].src_end_ms).toBe(30_500);
    expect(a.cut.targetMs).toBe(15_500);
    const b = applyFixes(cut, { payoffExtraMs: 2500 }, 29_000);
    expect(b.cut.segments[2].src_end_ms).toBe(29_000);
  });

  it("a targeted fix needs something it can change; a wrong clip asks for another moment", () => {
    const vague: FeedbackItem[] = [{ atMs: 3000, kind: "crop", text: "slecht" }];
    expect(plannedChanges(vague, fixesFrom(vague)).changes).toEqual([]);
    expect(plannedChanges(vague, fixesFrom(vague)).unsupported[0]).toMatch(/links of rechts/);
    expect(needsNewMoment([{ atMs: 0, kind: "opening", text: "kies een ander moment" }])).toBe(true);
    expect(fixesFrom([{ atMs: 0, kind: "music", text: "zonder muziek" }]).music).toBe("none");
    expect(fixesFrom([{ atMs: 0, kind: "music", text: "", music: "other" }]).music).toBe("other");
  });

  it("the same feedback gives the same job key (double click, refresh), other feedback another one", () => {
    const items: FeedbackItem[] = [{ atMs: 8000, kind: "crop", text: "rechts", side: "right" }];
    expect(feedbackKey("s1", items, "gericht")).toBe(feedbackKey("s1", [...items], "gericht"));
    expect(feedbackKey("s1", items, "gericht")).not.toBe(feedbackKey("s1", items, "volledig"));
    expect(feedbackKey("s1", items, "gericht")).not.toBe(feedbackKey("s1", [{ ...items[0], atMs: 9000 }], "gericht"));
  });

  it("keeps Milan's feedback as a short note with the version and the times", () => {
    expect(feedbackNote([{ atMs: 8000, kind: "crop", text: "tegenstander rechts weg" }], 2)).toBe("v2: 00:08 slechte crop: tegenstander rechts weg");
  });
});

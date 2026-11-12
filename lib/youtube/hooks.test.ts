import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { applyHook, COLD_OPEN_MS, parseHooks } from "./hooks";

describe("hook variants from the AI", () => {
  it("keeps up to three valid hooks and writes the overlay in capitals", () => {
    const hooks = parseHooks([
      { type: "challenge", first_line: "One heart, four zombies.", overlay: "1 heart vs 4 zombies", cold_open: false },
      { type: "cold_open", first_line: "This is how close it got.", overlay: "TOO CLOSE" },
      { type: "nonsense", first_line: "x", overlay: "y" },
      { type: "bold_claim", first_line: "", overlay: "EMPTY LINE" },
      { type: "curiosity_gap", first_line: "Watch the left tunnel.", overlay: "WATCH LEFT" },
      { type: "relatable", first_line: "Fourth one.", overlay: "FOURTH" },
    ]);
    expect(hooks.map((h) => h.type)).toEqual(["challenge", "cold_open", "curiosity_gap"]);
    expect(hooks[0].overlay).toBe("1 HEART VS 4 ZOMBIES");
    expect(hooks[1].cold_open).toBe(true);
  });

  it("returns nothing for an answer without hooks", () => {
    expect(parseHooks(undefined)).toEqual([]);
    expect(parseHooks("hooks")).toEqual([]);
  });
});

const plan: Segment[] = [
  { part: "hook", src_start_ms: 220_000, src_end_ms: 221_000, out_start_ms: 0, speed: 1, effects: [], note: "" },
  { part: "build", src_start_ms: 209_000, src_end_ms: 221_000, out_start_ms: 1000, speed: 1.1, effects: [], note: "" },
  { part: "payoff", src_start_ms: 221_000, src_end_ms: 227_000, out_start_ms: 12_000, speed: 1, effects: [], note: "" },
];
const script = {
  top_line: "SWARMED BY ZOMBIES",
  hook: "Old hook",
  lines: [
    { at_ms: 0, text: "Old hook" },
    { at_ms: 4000, text: "The zombies close in." },
    { at_ms: 15_500, text: "Last line of the old script." },
  ],
  edit_plan: plan,
  target_ms: 18_000,
  loop_line: "And then it started again.",
};

describe("applying the chosen hook", () => {
  it("uses the hook's text and first sentence, and ends with the loop line", () => {
    const r = applyHook(script, { type: "challenge", first_line: "One heart, four zombies.", overlay: "1 HEART VS 4 ZOMBIES", cold_open: false }, 221_000);
    expect(r.topLine).toBe("1 HEART VS 4 ZOMBIES");
    expect(r.lines[0]).toEqual({ at_ms: 0, text: "One heart, four zombies." });
    expect(r.lines.map((l) => l.text)).toEqual(["One heart, four zombies.", "The zombies close in.", "And then it started again."]);
    expect(r.lines[r.lines.length - 1].at_ms).toBe(15_500);
    expect(r.segments).toBe(plan);
  });

  it("opens on the climax with a cold open and shifts the rest", () => {
    const r = applyHook(script, { type: "cold_open", first_line: "This is how close it got.", overlay: "TOO CLOSE", cold_open: true }, 221_000);
    expect(r.segments[0]).toMatchObject({ part: "cold_open", src_start_ms: 221_000, src_end_ms: 221_000 + COLD_OPEN_MS, out_start_ms: 0 });
    expect(r.segments[1].out_start_ms).toBe(COLD_OPEN_MS);
    expect(r.targetMs).toBe(18_000 + COLD_OPEN_MS);
    expect(r.lines.find((l) => l.text === "The zombies close in.")?.at_ms).toBe(4000 + COLD_OPEN_MS);
  });

  it("keeps the stored script when no hook is chosen", () => {
    const r = applyHook(script, null, 221_000);
    expect(r).toEqual({ topLine: script.top_line, hook: script.hook, lines: script.lines, segments: plan, targetMs: 18_000 });
  });
});

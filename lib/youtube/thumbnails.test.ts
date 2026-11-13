import { describe, expect, it } from "vitest";
import type { Segment } from "./analysis";
import { thumbArgs, thumbAss, thumbFileName, thumbnailPlans, thumbWords, THUMB_SIZE } from "./thumbnails";

const seg = (part: Segment["part"], out: number, len: number): Segment => ({ part, src_start_ms: 0, src_end_ms: len, out_start_ms: out, speed: 1, effects: [], note: "" });
const long = [seg("cold_open", 0, 15_000), seg("goals", 15_000, 15_000), seg("chapter", 30_000, 100_000), seg("chapter", 130_000, 100_000)];

describe("thumbnails", () => {
  it("keeps at most 4 words in capitals without punctuation", () => {
    expect(thumbWords("the creeper got him!! right there")).toBe("THE CREEPER GOT HIM");
    expect(thumbWords(null)).toBe("");
  });

  it("plans 3 different thumbnails for a long video: moment, result, before/after", () => {
    const plans = thumbnailPlans("C", long, ["3 creepers", "kasteel af"]);
    expect(plans.map((p) => p.key)).toEqual(["moment", "result", "before_after"]);
    expect(plans[0]).toMatchObject({ text: "3 CREEPERS", atMs: [7500] });
    expect(plans[1]).toMatchObject({ text: "KASTEEL AF", atMs: [215_000] });
    expect(plans[2].atMs).toEqual([40_000, 220_000]);
    expect(new Set(plans.map((p) => p.atMs[0])).size).toBe(3);
  });

  it("plans one cover for a Short, on the payoff", () => {
    const plans = thumbnailPlans("A", [seg("hook", 0, 1000), seg("build", 1000, 22_000), seg("payoff", 23_000, 10_000)], ["one heart left"]);
    expect(plans).toEqual([{ key: "cover", label: "Cover", text: "ONE HEART LEFT", atMs: [25_000] }]);
  });

  it("builds FFmpeg arguments for one frame and for two frames side by side", () => {
    const [moment, , split] = thumbnailPlans("C", long, ["x"]);
    const one = thumbArgs("in.mp4", moment, THUMB_SIZE.long, "t.ass", "out.jpg");
    expect(one).toContain("-vf");
    expect(one.join(" ")).toContain("crop=1280:720");
    const two = thumbArgs("in.mp4", split, THUMB_SIZE.long, "t.ass", "out.jpg");
    expect(two.filter((a) => a === "-i")).toHaveLength(2);
    expect(two.join(" ")).toContain("hstack=inputs=2");
  });

  it("writes the text as an ASS subtitle and names the files after the montage", () => {
    expect(thumbAss(THUMB_SIZE.long, "3 CREEPERS")).toContain("Dialogue: 0,0:00:00.00,0:00:10.00,Thumb,,0,0,0,,3 CREEPERS");
    expect(thumbAss(THUMB_SIZE.long, "")).not.toContain("Dialogue");
    expect(thumbFileName("abc-v1-1234.mp4", 1)).toBe("abc-v1-1234-t2.jpg");
  });
});

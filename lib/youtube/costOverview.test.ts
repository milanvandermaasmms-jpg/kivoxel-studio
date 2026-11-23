import { describe, expect, it } from "vitest";
import { costOverview, eur, type CostLine } from "./costOverview";

const line = (over: Partial<CostLine>): CostLine => ({ job_id: null, video_id: null, amount_cents: 2, is_estimate: false, category: "analysis", service: "Gemini", incurred_on: "2026-11-23", ...over });

describe("kosten per productie", () => {
  it("puts analysis on its recording, scripts and checks on their video, Ivar apart; estimates separately", () => {
    const jobs = [
      { id: "a", step: "analyse", video_id: null, recording_id: "r1" },
      { id: "s", step: "script", video_id: "v1", recording_id: null },
      { id: "c", step: "viral", video_id: "v1", recording_id: null },
      { id: "i", step: "assistant", video_id: null, recording_id: null },
    ];
    const { rows, total } = costOverview(
      [line({ job_id: "a", amount_cents: 10 }), line({ job_id: "a", amount_cents: 10, is_estimate: true }), line({ job_id: "s", amount_cents: 3 }), line({ job_id: "c", amount_cents: 2 }), line({ job_id: "i", amount_cents: 1 })],
      jobs,
      { recordings: { r1: "22/11 minecraft" }, videos: { v1: { title: "Cliff Fall", recordingId: "r1" } } },
    );
    expect(rows[0]).toMatchObject({ kind: "opname", label: "22/11 minecraft", measured: 10, estimated: 10 });
    expect(rows.find((r) => r.label === "Cliff Fall")).toMatchObject({ measured: 5, byStep: { script: 3, checks: 2 } });
    expect(rows.find((r) => r.kind === "overig")!.label).toBe("Ivar (gesprekken)");
    expect(total).toEqual({ measured: 16, estimated: 10 });
    expect(eur(123)).toBe("€ 1,23");
  });

  it("can show one month only", () => {
    const { total } = costOverview([line({ incurred_on: "2026-10-30" }), line({ incurred_on: "2026-11-02" })], [], { recordings: {}, videos: {} }, "2026-11-01");
    expect(total.measured).toBe(2);
  });
});

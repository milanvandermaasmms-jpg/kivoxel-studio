import { describe, expect, it } from "vitest";
import { reviveMontage, type ReviveJob, type ReviveScript, type ReviveVideo } from "./revive.ts";

const now = Date.parse("2026-11-20T20:00:00Z");
const video = (over: Partial<ReviveVideo> = {}): ReviveVideo => ({ id: "v1", studio_id: "s", status: "scripted", review_note: null, ...over });
const script: ReviveScript = { id: "sc1", version: 1, status: "approved" };
const render = (over: Partial<ReviveJob> = {}): ReviveJob => ({ id: "j1", step: "render", status: "failed", payload: { script_id: "sc1", audio_mode: "vo_muziek" }, created_at: "2026-11-20T19:00:00Z", finished_at: "2026-11-20T19:10:00Z", error: null, ...over });

describe("montages that stopped start again once by themselves", () => {
  it("a failed or cancelled montage is started again with the same sound", () => {
    expect(reviveMontage(video(), [render()], [script], now)).toMatchObject({ idempotency_key: "render:sc1:auto:j1", payload: { script_id: "sc1", audio_mode: "vo_muziek", auto_retry: 1 } });
    expect(reviveMontage(video({ status: "rendering" }), [render({ status: "cancelled" })], [script], now)?.why).toMatch(/geannuleerd/);
  });

  it("a video on 'montage' without a montage in the queue gets one", () => {
    expect(reviveMontage(video({ status: "rendering" }), [render({ status: "done" })], [script], now)?.why).toMatch(/niet in de rij/);
    expect(reviveMontage(video({ status: "rendering" }), [], [script], now)).toMatchObject({ idempotency_key: "render:sc1:auto:none" });
  });

  it("only once: a second failure stays under Mislukt", () => {
    expect(reviveMontage(video(), [render({ payload: { script_id: "sc1", auto_retry: 1 } })], [script], now)).toBeNull();
  });

  it("leaves alone what is busy, just ended, chosen by Milan or no longer needed", () => {
    expect(reviveMontage(video(), [render(), render({ id: "j2", status: "queued", created_at: "2026-11-20T19:30:00Z" })], [script], now)).toBeNull();
    expect(reviveMontage(video(), [render({ finished_at: "2026-11-20T19:59:30Z" })], [script], now)).toBeNull();
    expect(reviveMontage(video({ review_note: "niet goed" }), [render()], [script], now)).toBeNull();
    expect(reviveMontage(video(), [render({ status: "cancelled", error: "Niet meer nodig: de video staat op YouTube" })], [script], now)).toBeNull();
    expect(reviveMontage(video(), [render()], [{ ...script, status: "draft" }], now)).toBeNull();
    expect(reviveMontage(video({ status: "review" }), [render()], [script], now)).toBeNull();
    expect(reviveMontage(video(), [render(), { ...render({ id: "s9", step: "script", status: "running" }) }], [script], now)).toBeNull();
  });

  it("a scripted video whose last montage finished normally is not touched", () => {
    expect(reviveMontage(video(), [render({ status: "done" })], [script], now)).toBeNull();
  });
});

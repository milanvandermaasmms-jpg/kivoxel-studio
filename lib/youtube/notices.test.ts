import { describe, expect, it } from "vitest";
import { notices, type NoticeInput } from "./notices";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const pub = (extra: Partial<NoticeInput["publications"][number]>): NoticeInput["publications"][number] => ({ id: "p", title: "Minecraft: echt", status: "draft", error: null, publish_at: null, updated_at: "2026-11-12T19:00:00Z", is_test: false, ...extra });
const base: NoticeInput = { publications: [], channel: { youtube_connected_at: "2026-11-12T17:00:00Z", youtube_error: null }, lastSnapshot: { taken_at: "2026-11-12T19:30:00Z", analytics_error: null }, signals: [], now: NOW };

describe("notifications on the overview", () => {
  it("is quiet when all is well", () => {
    expect(notices(base)).toEqual([]);
  });

  it("reports failures first, then warnings, then information", () => {
    const list = notices({
      ...base,
      publications: [pub({ id: "a", status: "scheduled", publish_at: "2026-11-14T17:00:00Z" }), pub({ id: "b", status: "failed", error: "YouTube weigerde" }), pub({ id: "c", status: "uploaded", thumbnail_status: "Mislukt: verifieer het kanaal" })],
      signals: [{ kind: "growth", tone: "good", videoId: "v", title: "\"X\" groeit sneller dan normaal", rule: "" }],
    });
    expect(list.map((n) => n.tone)).toEqual(["error", "warn", "info", "info"]);
    expect(list[0].text).toBe('Publicatie "Minecraft: echt" is mislukt: YouTube weigerde. Probeer het opnieuw in het publicatiescherm.');
    expect(list[1].text).toBe('Thumbnail van "Minecraft: echt": verifieer het kanaal');
    expect(list[2].text).toMatch(/gaat openbaar op/);
  });

  it("warns when statistics stop, and before the 7-day test-mode consent ends", () => {
    expect(notices({ ...base, lastSnapshot: { taken_at: "2026-11-12T10:00:00Z", analytics_error: null } })[0]).toMatchObject({ key: "stats-stale", tab: "settings" });
    expect(notices({ ...base, channel: { youtube_connected_at: "2026-11-06T12:00:00Z", youtube_error: null } }).map((n) => n.key)).toContain("yt-reconnect");
    expect(notices({ ...base, channel: null })).toEqual([]);
  });
});

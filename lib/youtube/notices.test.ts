import { describe, expect, it } from "vitest";
import { notices, visibleNotices, type NoticeInput } from "./notices";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const pub = (extra: Partial<NoticeInput["publications"][number]>): NoticeInput["publications"][number] => ({ id: "p", title: "Minecraft: echt", status: "draft", error: null, publish_at: null, updated_at: "2026-11-12T19:00:00Z", is_test: false, ...extra });
const base: NoticeInput = { publications: [], channel: { youtube_connected_at: "2026-11-12T17:00:00Z", youtube_error: null }, lastSnapshot: { taken_at: "2026-11-12T19:30:00Z", analytics_error: null }, signals: [], now: NOW };

describe("notices: only what Milan has to act on", () => {
  it("is quiet when all is well, and says nothing about things that went fine", () => {
    expect(notices(base)).toEqual([]);
    const fine = notices({ ...base, publications: [pub({ status: "published" }), pub({ id: "b", status: "scheduled", publish_at: "2026-11-14T17:00:00Z" })], signals: [{ kind: "growth", tone: "good", videoId: "v", title: "groeit", rule: "" }] });
    expect(fine).toEqual([]);
  });

  it("groups the same cause into one notice with the fix", () => {
    const list = notices({ ...base, publications: ["a", "b", "c"].map((id) => pub({ id, status: "published", thumbnail_status: "Mislukt: YouTube staat eigen thumbnails niet toe. Verifieer het kanaal" })) });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "thumb-verify", text: "Eigen thumbnails lukken niet bij 3 video's: verifieer je YouTube-kanaal (eenmalig).", action: { label: "Kanaal verifiëren", href: "https://www.youtube.com/verify" } });
  });

  it("errors first, each with an action", () => {
    const list = notices({ ...base, publications: [pub({ id: "b", status: "failed", error: "YouTube weigerde" }), pub({ id: "c", status: "uploaded", captions_status: "Mislukt: te lang" })] });
    expect(list.map((n) => n.tone)).toEqual(["error", "warn"]);
    expect(list[0].text).toBe('Publicatie "Minecraft: echt" is mislukt: YouTube weigerde.');
    expect(list.every((n) => n.action.label)).toBe(true);
  });

  it("an ignored notice comes back when a new case joins", () => {
    const one = notices({ ...base, publications: [pub({ id: "a", status: "failed" })] });
    const dismissed = { [one[0].key]: one[0].signature };
    expect(visibleNotices(one, dismissed)).toEqual([]);
    const two = notices({ ...base, publications: [pub({ id: "a", status: "failed" }), pub({ id: "b", status: "failed" })] });
    expect(visibleNotices(two, dismissed)).toHaveLength(1);
  });

  it("warns when statistics stop, and before the 7-day test-mode consent ends", () => {
    expect(notices({ ...base, lastSnapshot: { taken_at: "2026-11-12T10:00:00Z", analytics_error: null } })[0]).toMatchObject({ key: "stats-stale" });
    expect(notices({ ...base, channel: { youtube_connected_at: "2026-11-06T12:00:00Z", youtube_error: null } }).map((n) => n.key)).toContain("yt-reconnect");
    expect(notices({ ...base, channel: null })).toEqual([]);
  });
});

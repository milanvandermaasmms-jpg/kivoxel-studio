import { describe, expect, it } from "vitest";
import { computeTips, defaultSlot, defaultTags, hiddenFolds, isOpen, learnTags, likedTitles, nextSlot, type Preference, type SentPublication, type StudioEvent } from "./learning";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const name = () => "Kivoxel";
const pub = (tags: string[], i: number, over: Partial<SentPublication> = {}): SentPublication => ({ video_id: `v${i}`, channel_id: "c1", status: "published", tags, updated_at: `2026-11-0${i}T10:00:00Z`, ...over });
const ev = (action: string, over: Partial<StudioEvent> = {}): StudioEvent => ({ action, screen: "", at: "2026-11-10T10:00:00Z", channel_id: "c1", metadata: {}, ...over });
const pref = (key: string, value: unknown, channel_id: string | null = null): Preference => ({ id: key, channel_id, key, value, updated_at: "2026-11-01T00:00:00Z" });

describe("tag tips", () => {
  it("spots a tag Milan always adds and offers to make it a default", () => {
    const pubs = [pub(["minecraft", "Creeper"], 1), pub(["minecraft"], 2), pub(["minecraft", "cave"], 3)];
    const tips = computeTips({ events: [], prefs: [], publications: pubs, channelName: name, now: NOW });
    expect(tips.map((t) => t.text)).toEqual(['Je voegt altijd de tag "minecraft" toe. Standaard maken?']);
    expect(tips[0].apply).toEqual({ key: "default_tags", channelId: "c1", value: ["minecraft"] });
  });

  it("needs at least 3 sent videos and ignores drafts", () => {
    expect(computeTips({ events: [], prefs: [], publications: [pub(["a"], 1), pub(["a"], 2), pub(["a"], 3, { status: "draft" })], channelName: name, now: NOW })).toEqual([]);
  });

  it("no tip once the tag is a default, or after Nooit meer tonen", () => {
    const pubs = [pub(["minecraft"], 1), pub(["minecraft"], 2), pub(["minecraft"], 3)];
    expect(computeTips({ events: [], prefs: [pref("default_tags", ["Minecraft"], "c1")], publications: pubs, channelName: name, now: NOW })).toEqual([]);
    expect(computeTips({ events: [], prefs: [pref("tip:default_tag:c1:minecraft", { state: "never", at: "2026-11-01T00:00:00Z" })], publications: pubs, channelName: name, now: NOW })).toEqual([]);
  });

  it("an ignored tip comes back after 14 days", () => {
    const ignored = [pref("tip:x", { state: "ignored", at: "2026-11-10T00:00:00Z" })];
    expect(isOpen(ignored, "x", NOW)).toBe(false);
    expect(isOpen(ignored, "x", NOW + 15 * 86_400_000)).toBe(true);
  });
});

describe("slot tips", () => {
  const sent = (at: string, meta: Record<string, unknown>) => ev("publish_sent", { at, metadata: { kind: "short", ...meta } });

  it("Shorts always public at 18:00 (scheduled or published by hand) gives a schedule tip", () => {
    const events = [sent("2026-11-08T10:00:00Z", { action: "schedule", publish_at: "2026-11-08T17:00:00Z" }), sent("2026-11-09T17:05:00Z", { action: "publish", visibility: "public" }), sent("2026-11-10T10:00:00Z", { action: "schedule", publish_at: "2026-11-10T17:00:00Z" })];
    const tips = computeTips({ events, prefs: [], publications: [], channelName: name, now: NOW });
    expect(tips.map((t) => t.text)).toEqual(["Je zet Shorts altijd op Openbaar om 18:00. Inplannen als standaard?"]);
    expect(tips[0].apply).toEqual({ key: "default_slot:short", channelId: "c1", value: "18:00" });
  });

  it("no tip when the times differ or a video went private", () => {
    const events = [sent("2026-11-08T10:00:00Z", { action: "schedule", publish_at: "2026-11-08T17:00:00Z" }), sent("2026-11-09T10:00:00Z", { action: "private" }), sent("2026-11-10T10:00:00Z", { action: "schedule", publish_at: "2026-11-10T17:00:00Z" })];
    expect(computeTips({ events, prefs: [], publications: [], channelName: name, now: NOW })).toEqual([]);
  });
});

describe("fold tips", () => {
  it("a part that is never opened on a tab Milan visits often may be hidden", () => {
    const visits = Array.from({ length: 8 }, () => ev("tab_opened", { screen: "insights", channel_id: null }));
    const opened = [ev("fold_opened", { metadata: { fold: "insights.today" } }), ev("fold_opened", { metadata: { fold: "insights.steps" } })];
    const tips = computeTips({ events: [...visits, ...opened], prefs: [], publications: [], channelName: name, now: NOW });
    expect(tips.map((t) => t.id)).toEqual(["hide_fold:insights.formats"]);
    expect(tips[0].apply.value).toEqual(["insights.formats"]);
  });
});

describe("preferences", () => {
  it("merges default tags of all channels and of the channel, without doubles", () => {
    expect(defaultTags([pref("default_tags", ["gaming", "Minecraft"]), pref("default_tags", ["minecraft", "creeper"], "c1")], "c1")).toEqual(["gaming", "Minecraft", "creeper"]);
  });
  it("a channel slot wins over the general one", () => {
    expect(defaultSlot([pref("default_slot:short", "12:00"), pref("default_slot:short", "18:00", "c1")], "c1", "short")).toBe("18:00");
    expect(defaultSlot([pref("default_slot:short", "12:00")], "c2", "short")).toBe("12:00");
    expect(defaultSlot([], "c1", "long")).toBeNull();
  });
  it("hidden parts", () => {
    expect(hiddenFolds([pref("hidden_folds", ["live.all"])])).toEqual(["live.all"]);
  });
  it("next slot is today when there is time, otherwise tomorrow (Amsterdam time)", () => {
    expect(nextSlot("18:00", Date.parse("2026-11-13T12:00:00Z"))).toBe("2026-11-13T17:00:00.000Z");
    expect(nextSlot("18:00", Date.parse("2026-11-13T16:50:00Z"))).toBe("2026-11-14T17:00:00.000Z");
    expect(nextSlot("25:00", NOW)).toBeNull();
  });
});

describe("learning for AI suggestions", () => {
  it("likes kept tags and dislikes tags left out twice and never kept", () => {
    const history = [
      { offered: ["minecraft", "funny", "noob"], final: ["minecraft"] },
      { offered: ["minecraft", "noob", "cave"], final: ["minecraft", "cave"] },
    ];
    const { liked, disliked } = learnTags(history, [ev("ai_tag_removed", { metadata: { tag: "funny" } })]);
    expect(liked[0]).toBe("minecraft");
    expect(disliked.sort()).toEqual(["funny", "noob"]);
  });
  it("remembers titles Milan picked", () => {
    expect(likedTitles([ev("ai_title_used", { metadata: { title: "Minecraft: net op tijd" } }), ev("ai_title_used", { metadata: { title: "Minecraft: net op tijd" } })])).toEqual(["Minecraft: net op tijd"]);
  });
});

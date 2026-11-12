import { describe, expect, it } from "vitest";
import type { Channel } from "./channels";
import { connectionView, quotaText, reconnectBefore } from "./connection";

const base: Channel = { id: "a", name: "Kivoxel", is_default: true, status: "active", language: "en", audience: null, brand_color: null, youtube_channel_id: null, youtube_connected_at: null, youtube_error: null };
const health = { ok: true as const, version: "56.0", ffmpeg: "8", queue: "supabase" as const, dataDir: "x", youtube: true };

describe("YouTube connection block", () => {
  it("waits for migration 036 first", () => {
    const { youtube_connected_at: _, ...old } = base;
    expect(connectionView(old as Channel, health, null, false).kind).toBe("migration");
  });

  it("explains what is missing before the button can work", () => {
    expect(connectionView(base, null, null, false).kind).toBe("worker-off");
    expect(connectionView(base, { ...health, youtube: undefined }, null, false).kind).toBe("worker-old");
    expect(connectionView(base, { ...health, youtube: false }, null, false).kind).toBe("not-configured");
    expect(connectionView(base, health, null, true).kind).toBe("other-linked");
    expect(connectionView(base, health, null, false).kind).toBe("ready");
  });

  it("shows a connected channel with the 7-day date and whether this pc holds the tokens", () => {
    const linked = { ...base, youtube_channel_id: "UCabcdefghijklmnopqrstuv", youtube_connected_at: "2026-11-12T12:00:00Z" };
    expect(connectionView(linked, null, null, false)).toEqual({ kind: "connected", reconnectBefore: "2026-11-19T12:00:00.000Z", error: null, tokensHere: false });
    expect(connectionView(linked, health, "UCabcdefghijklmnopqrstuv", false)).toMatchObject({ tokensHere: true });
    expect(reconnectBefore("2026-11-12T12:00:00Z")).toBe("2026-11-19T12:00:00.000Z");
  });

  it("writes the quota in Dutch numbers", () => {
    expect(quotaText({ units: 1201, uploads: 2, limitUnits: 10000, limitUploads: 100 })).toBe("1.201 van 10.000 eenheden, 2 van 100 uploads");
  });
});

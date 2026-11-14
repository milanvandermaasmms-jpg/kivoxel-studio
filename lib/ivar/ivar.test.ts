import { describe, expect, it } from "vitest";
import { asksToPublish, asksToRemember, classifyIntent, toolAllowed } from "./intent.ts";
import { toGemini, validate } from "./schema.ts";
import { elapsed, launcherSignal, taskView } from "./tasks.ts";
import { boundHistory, boundResult, systemPrompt } from "./prompt.ts";
import { applyCuts, outputToSource, replaceLines } from "./edits.ts";
import { clientKey, sameTarget, scopeTrail } from "./types.ts";
import { TOOLS } from "./tools.ts";
import type { Segment } from "../youtube/analysis.ts";

describe("intent", () => {
  it.each([
    ["Bedenk vijf nieuwe video's voor Lumi", "brainstorm"],
    ["Waarom voelt deze video nog zo statisch?", "brainstorm"],
    ["Welke video moeten we hierna maken?", "brainstorm"],
    ["Maak drie titels voor deze Minecraft-video", "action"],
    ["Maak van deze opname drie Shorts", "action"],
    ["Maak het beschrijvingsconcept korter", "action"],
    ["Bekijk waar de intro te langzaam is", "question"],
    ["Waar is mijn render nu mee bezig?", "progress"],
    ["Start de montage", "action"],
  ])("%s → %s", (text, intent) => expect(classifyIntent(text)).toBe(intent));

  it("jobs only run on a concrete request; reading and drafts always", () => {
    expect(toolAllowed("job", "brainstorm").ok).toBe(false);
    expect(toolAllowed("job", "question").ok).toBe(false);
    expect(toolAllowed("job", "progress").ok).toBe(false);
    expect(toolAllowed("job", "action").ok).toBe(true);
    expect(toolAllowed("draft", "brainstorm").ok).toBe(true);
  });

  it("recognises explicit remember and publish requests", () => {
    expect(asksToRemember("Onthoud dat we voortaan Engels gebruiken")).toBe(true);
    expect(asksToRemember("Misschien Engels?")).toBe(false);
    expect(asksToPublish("Publiceer deze video")).toBe(true);
    expect(asksToPublish("Maak een beschrijving")).toBe(false);
  });
});

describe("tool schemas", () => {
  it("every tool has a valid Gemini declaration and nothing publishes or deletes", () => {
    for (const t of TOOLS) {
      expect(toGemini(t.input)).toMatchObject({ type: "OBJECT" });
      expect(t.name).not.toMatch(/publish_video|delete|sql|shell|fetch/);
    }
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it("validates, trims and refuses unknown fields", () => {
    const titles = TOOLS.find((t) => t.name === "propose_titles")!.input;
    const id = "00000000-0000-4000-8000-000000000001";
    expect(validate(titles, { video_id: id, options: [{ title: "  A  ", why: "b" }] })).toEqual({ ok: true, value: { video_id: id, options: [{ title: "A", why: "b" }] } });
    expect(validate(titles, { video_id: id, options: [] }).ok).toBe(false);
    expect(validate(titles, { video_id: id, options: [{ title: "x", why: "y" }], sql: "drop" }).ok).toBe(false);
    expect(validate(titles, { video_id: "1; drop table", options: [{ title: "x", why: "y" }] }).ok).toBe(false);
    expect(validate(titles, { video_id: id, options: [{ title: "x".repeat(101), why: "y" }] }).ok).toBe(false);
  });
});

describe("tasks", () => {
  const base = { id: "j", step: "render", error: null, created_at: "2026-11-14T10:00:00Z" };
  it("never invents a percentage", () => {
    expect(taskView({ ...base, status: "running" }, "yt")).toMatchObject({ status: "running", percent: null, statusLabel: "Bezig met renderen" });
    expect(taskView({ ...base, status: "running", progress: 0.42, phase: "Renderen" }, "yt")).toMatchObject({ percent: 42, statusLabel: "Renderen" });
    expect(taskView({ ...base, status: "running", progress: 42 }, "dn").percent).toBe(42);
    expect(taskView({ ...base, status: "done", progress: 1 }, "yt")).toMatchObject({ status: "succeeded", percent: null });
  });
  it("maps statuses and actions", () => {
    expect(taskView({ ...base, status: "failed", error: "x" }, "yt")).toMatchObject({ status: "failed", canRetry: true, canCancel: false, error: "x" });
    expect(taskView({ ...base, step: "upload", status: "failed", error: "x" }, "yt").canRetry).toBe(false);
    expect(taskView({ ...base, status: "running", cancel_requested: true }, "yt")).toMatchObject({ canCancel: false, statusLabel: "Wordt geannuleerd" });
  });
  it("shows elapsed time and a quiet launcher signal", () => {
    expect(elapsed("2026-11-14T10:00:00Z", Date.parse("2026-11-14T10:03:12Z"))).toBe("3 min 12 s");
    const seen = Date.parse("2026-11-14T10:00:00Z");
    expect(launcherSignal([{ status: "running", finishedAt: null }], [], seen)).toBe("busy");
    expect(launcherSignal([{ status: "succeeded", finishedAt: "2026-11-14T10:01:00Z" }], [], seen)).toBe("ready");
    expect(launcherSignal([{ status: "failed", finishedAt: "2026-11-14T10:01:00Z" }], [], seen)).toBe("attention");
    expect(launcherSignal([{ status: "failed", finishedAt: "2026-11-14T09:00:00Z" }], [], seen)).toBe("idle");
  });
});

describe("prompt and context", () => {
  const ctx = { studioName: "KIVOXEL Studio", channels: [], channel: { id: "c", name: "Dreamnest", kind: "dreamnest" as const, language: "en", audience: null }, project: null, page: "Afleveringen", memory: [{ scope: "channel", content: "Zachte pianomuziek" }], tasks: [], intent: "brainstorm" as const, today: "zaterdag" };
  it("names the scope, the channel rules, memory and the intent", () => {
    const p = systemPrompt(ctx);
    expect(p).toMatch(/Dreamnest → Afleveringen/);
    expect(p).toMatch(/geen medische claims|Nooit medische claims/i);
    expect(p).toMatch(/Zachte pianomuziek/);
    expect(p).toMatch(/start niets/);
    expect(p).toMatch(/Publiceren doe je nooit/);
  });
  it("bounds history and tool results", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `bericht ${i} ${"x".repeat(1000)}` }));
    const h = boundHistory(items);
    expect(h.length).toBeLessThanOrEqual(16);
    expect(h[h.length - 1].content).toMatch(/bericht 39/);
    expect(boundResult({ a: "x".repeat(10_000) })).toHaveProperty("result_truncated");
  });
});

describe("edits on a new version", () => {
  const segs: Segment[] = [
    { part: "hook", src_start_ms: 10_000, src_end_ms: 20_000, out_start_ms: 0, speed: 1, effects: [], note: "" },
    { part: "build", src_start_ms: 60_000, src_end_ms: 80_000, out_start_ms: 10_000, speed: 2, effects: [], note: "" },
  ];
  it("maps finished-video time to the recording", () => {
    expect(outputToSource(segs, 5000, 15_000)).toEqual([[15_000, 20_000], [60_000, 70_000]]);
  });
  it("cuts and refuses nonsense", () => {
    const r = applyCuts(segs, [{ at_ms: 0, text: "a" }], [{ from_ms: 2000, to_ms: 4000 }]);
    expect("error" in r ? r.error : r.removedMs).toBe(2000);
    expect("error" in applyCuts(segs, [], [{ from_ms: 4000, to_ms: 2000 }])).toBe(true);
    expect("error" in applyCuts(segs, [], [{ from_ms: 0, to_ms: 20_000 }])).toBe(true);
  });
  it("replaces narration lines on the same timing", () => {
    expect(replaceLines([{ at_ms: 0, text: "a" }], [{ index: 0, text: "b" }])).toEqual({ lines: [{ at_ms: 0, text: "b" }], changed: 1 });
    expect("error" in replaceLines([{ at_ms: 0, text: "a" }], [{ index: 3, text: "b" }])).toBe(true);
  });
});

describe("scope", () => {
  it("shows a breadcrumb and compares targets", () => {
    expect(scopeTrail({ channelId: "k", channelName: "Kivoxel", projectId: "p", projectKind: "video", projectLabel: "The One Who Watches", page: "Shorts" })).toEqual(["Kivoxel", "The One Who Watches", "Shorts"]);
    expect(scopeTrail(null)).toEqual(["Hele studio"]);
    expect(sameTarget({ channelId: "a", projectId: "p" }, { channelId: "a", projectId: "p", page: "x" })).toBe(true);
    expect(sameTarget({ channelId: "a" }, { channelId: "b" })).toBe(false);
  });
  it("makes valid client keys", () => {
    expect(clientKey()).toMatch(/^[A-Za-z0-9]{20}$/);
  });
});

import { suggestions } from "./suggest.ts";
describe("quiet suggestions from the real project state", () => {
  it("fits the situation", () => {
    expect(suggestions("dreamnest", null)).toContain("Bedenk vijf nieuwe video's voor Lumi");
    expect(suggestions("kivoxel", { kind: "recording", status: "ready", analysed: true })).toContain("Zoek geschikte Shortmomenten");
    expect(suggestions("kivoxel", { kind: "video", status: "review", hasRender: true })).toContain("Controleer de kwaliteit");
    expect(suggestions("kivoxel", { kind: "video", status: "published", onYouTube: true, hasStats: true })).toContain("Analyseer deze resultaten");
    expect(suggestions("kivoxel", { kind: "video", status: "published", onYouTube: true, hasStats: false })).not.toContain("Analyseer deze resultaten");
    expect(suggestions("dreamnest", { kind: "episode", status: "concept" })).toContain("Help me met het concept");
  });
});

import { describe, expect, it } from "vitest";
import { memoryDb, type Tables } from "./memoryDb.ts";
import { runInsight, scheduleInsights, type JsonModel } from "./insights.ts";
import { runTool, type ToolEnv } from "./tools.ts";
import { isoWeek, nicheQueries, ownSignals, parseInsights, trendSignals, type RefVideo } from "../../lib/ivar/insights.ts";
import { classifyIntent } from "../../lib/ivar/intent.ts";

const STUDIO = "00000000-0000-4000-8000-000000000001";
const KIV = "00000000-0000-4000-8000-0000000000a1";
const VID = "00000000-0000-4000-8000-0000000000c1";
const NOW = Date.parse("2026-11-14T12:00:00Z");

const ref = (title: string, views: number, ratio: number, short = true): RefVideo => ({ title, tags: [], duration_s: short ? 40 : 600, is_short: short, published_at: "2026-11-10T00:00:00Z", views, ratio, query: "minecraft survival" });
const niche: RefVideo[] = [
  ref("Warden escape in deep dark", 900_000, 40),
  ref("Warden chase gone wrong", 700_000, 35),
  ref("Hardcore warden ambush", 500_000, 30),
  ref("Building a cozy house", 20_000, 1),
  ref("My first diamond", 30_000, 2),
  ref("Redstone tutorial", 10_000, 0.5, false),
  ref("Village tour", 15_000, 1, false),
  ref("Speedrun tips", 12_000, 1),
];

function tables(paid = true): Tables {
  return {
    yt_channels: [{ id: KIV, studio_id: STUDIO, name: "Eerste kanaal", is_default: true, status: "active", language: "en", audience: null, slug: "kivoxel", safety_profile: "kids_gaming", banned_words: [], voice_name: null, speaking_rate: null, made_for_kids: false, youtube_channel_id: null }],
    yt_settings: [{ studio_id: STUDIO, paid_processing_enabled: paid, monthly_cap_cents: 500 }],
    yt_reference_videos: niche.map((v) => ({ ...v, studio_id: STUDIO, channel_id: KIV })),
    yt_video_snapshots: [],
    ivar_revisions: [
      { studio_id: STUDIO, channel_id: KIV, field: "title", status: "applied", after_value: "Crafting An Iron Pickaxe in Under 35 Seconds", created_at: "2026-11-13T00:00:00Z" },
      { studio_id: STUDIO, channel_id: KIV, field: "title", status: "reverted", after_value: "How He Crafted This Rare Iron Pickaxe So Fast", created_at: "2026-11-13T00:00:00Z" },
    ],
    ivar_ideas: [],
    yt_videos: [{ id: VID, studio_id: STUDIO, channel_id: KIV, format: "A", kind: "short", title: null, promise: null, status: "review", plan_key: null, youtube_video_id: null, is_test: false, recording_id: null, review_note: null, created_at: "2026-11-14T10:00:00Z" }],
    yt_scripts: [{ id: "s1", studio_id: STUDIO, video_id: VID, version: 1, status: "draft", lines: [], edit_plan: [], hook: "h", target_ms: 1000 }],
    ivar_memory: [],
    ivar_insights: [],
    yt_jobs: [],
    yt_costs: [],
    yt_moments: [],
    yt_recordings: [],
    yt_publications: [],
    ivar_actions: [],
  };
}
const reserve = (t: Tables) => ({
  reserve_yt_cost: (a: Record<string, unknown>) => {
    if (!t.yt_settings[0].paid_processing_enabled) return { error: { message: "Betaalde verwerking staat uit" } };
    t.yt_costs.push({ id: "c", job_id: a.p_job, category: "analysis", amount_cents: 2, is_estimate: true });
    return { data: 2 };
  },
});
const model = (json: unknown): JsonModel & { calls: number } => {
  const m = { model: "test", calls: 0, generateText: async () => (m.calls++, { json, usage: { inputTokens: 2000, outputTokens: 300 } }) };
  return m;
};
const answer = {
  insights: [
    { kind: "trend", title: "Warden-achtervolgingen scoren", body: "De drie best scorende video's gaan over de Warden.", suggestion: "Maak een Short over ontsnappen aan de Warden", evidence: ["3 van de 8 video's, ratio 30-40"], confidence: "medium" },
    { kind: "learning", title: "Milan kiest titels met een getal", body: "Toegepast: 'in Under 35 Seconds'; teruggedraaid: een vraagtitel.", suggestion: "Gebruik een concreet getal in titels", evidence: ["1 toegepast, 1 teruggedraaid"], confidence: "low" },
    { kind: "tip", title: "Zonder bewijs", body: "x", evidence: [] },
    { kind: "trend", title: "Gegarandeerd viraal", body: "Dit gaat gegarandeerd viraal", evidence: ["x"] },
  ],
};

describe("insight signals (pure)", () => {
  it("finds the words that stand out among the best niche videos", () => {
    const s = trendSignals(niche, NOW);
    expect(s.count).toBe(8);
    expect(s.rising.map((r) => r.word)).toContain("warden");
    expect(s.examples[0].title).toMatch(/Warden/);
  });
  it("is honest about too few own videos", () => {
    expect(ownSignals([], NOW).tooFew).toBe(true);
  });
  it("keeps only insights with evidence and without promises", () => {
    const list = parseInsights(answer, []);
    expect(list.map((i) => i.title)).toEqual(["Warden-achtervolgingen scoren", "Milan kiest titels met een getal"]);
    expect(parseInsights(answer, ["Warden-achtervolgingen scoren"]).map((i) => i.title)).toEqual(["Milan kiest titels met een getal"]);
  });
  it("uses ISO weeks and niche search terms for Dreamnest", () => {
    expect(isoWeek(new Date("2026-11-14T12:00:00Z"))).toBe("2026-W46");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(nicheQueries("dreamnest", "en")?.[0]).toMatch(/sleep/);
    expect(nicheQueries("kivoxel", "en")).toBeNull();
  });
});

describe("weekly insight step (worker)", () => {
  it("stores insights with evidence and settles the real cost", async () => {
    const t = tables();
    const { db } = memoryDb(t, reserve(t));
    const m = model(answer);
    const r = await runInsight(db, m, { id: "job1", studio_id: STUDIO, payload: { channel_id: KIV } }, NOW);
    expect(r).toMatchObject({ week: "2026-W46", saved: 2 });
    expect(t.ivar_insights.map((i) => i.kind)).toEqual(["trend", "learning"]);
    expect(t.ivar_insights[0]).toMatchObject({ channel_id: KIV, job_id: "job1" });
    expect(t.yt_costs[0]).toMatchObject({ is_estimate: false });
  });
  it("skips for free when there is nothing to learn from", async () => {
    const t = tables();
    t.yt_reference_videos = [];
    t.ivar_revisions = [];
    const m = model(answer);
    const r = await runInsight(memoryDb(t, reserve(t)).db, m, { id: "j", studio_id: STUDIO, payload: { channel_id: KIV } }, NOW);
    expect(r).toHaveProperty("skipped");
    expect(m.calls).toBe(0);
    expect(t.yt_costs).toHaveLength(0);
  });
  it("spends nothing when paid processing is off", async () => {
    const t = tables(false);
    const m = model(answer);
    await expect(runInsight(memoryDb(t, reserve(t)).db, m, { id: "j", studio_id: STUDIO, payload: { channel_id: KIV } }, NOW)).rejects.toThrow(/staat uit/);
    expect(m.calls).toBe(0);
  });
  it("plans itself once per week per channel, only with paid processing on", async () => {
    const t = tables();
    const { db } = memoryDb(t);
    expect(await scheduleInsights(db, () => {}, NOW)).toBe(1);
    expect(await scheduleInsights(db, () => {}, NOW)).toBe(0);
    expect(t.yt_jobs[0]).toMatchObject({ step: "insight", idempotency_key: `insight:${KIV}:2026-W46` });
    const off = tables(false);
    expect(await scheduleInsights(memoryDb(off).db, () => {}, NOW)).toBe(0);
  });
});

describe("wider tools", () => {
  const env = (t: Tables, text: string): ToolEnv => ({ db: memoryDb(t).db, studioId: STUDIO, conversationId: "c", replyId: "r", channel: { ...t.yt_channels[0], name: "KIVOXEL" } as never, project: null, intent: classifyIntent(text), userText: text, cards: [], dreamnest: true });
  it("gives a studio overview and the month costs", async () => {
    const t = tables();
    t.yt_costs.push({ studio_id: STUDIO, amount_cents: 12, category: "analysis", service: "Gemini x (Ivar)", is_estimate: false, currency: "EUR", incurred_on: new Date().toISOString().slice(0, 10) });
    const o = await runTool(env(t, "Wat moet ik vandaag doen?"), "get_studio_overview", {});
    expect(o.ok).toBe(true);
    expect((o.result as { channels: { te_keuren: number }[] }).channels[0].te_keuren).toBe(1);
    const c = await runTool(env(t, "Wat heb ik deze maand uitgegeven?"), "get_costs", {});
    expect(c.result).toMatchObject({ cap_cents: 500, spent_cents: 12, ivar_cents: 12 });
  });
  it("a new script only via a cost card; approving only on a concrete request", async () => {
    const t = tables();
    const e = env(t, "Schrijf het script opnieuw met een spannender begin");
    const r = await runTool({ ...e, intent: "action" }, "regenerate_script", { video_id: VID, note: "spannender begin" });
    expect(r.result).toMatchObject({ needs_confirmation: true, version: 2 });
    expect(t.yt_jobs).toHaveLength(0);
    const no = await runTool(env(t, "Is dit script goed?"), "approve_script", { video_id: VID });
    expect(no.ok).toBe(false);
    const yes = await runTool(env(t, "Keur het script goed"), "approve_script", { video_id: VID });
    expect(yes.result, JSON.stringify(yes.result)).toMatchObject({ approved: true, version: 1 });
    expect(t.yt_scripts[0].status).toBe("approved");
  });
  it("refreshing insights shows a cost card first", async () => {
    const t = tables();
    const e = env(t, "Zoek nu de trends op");
    const r = await runTool({ ...e, intent: "action" }, "refresh_insights", {});
    expect(r.result).toMatchObject({ needs_confirmation: true, estimate_cents: 2 });
    expect(e.cards[0]).toMatchObject({ type: "confirm", action: "insights" });
  });
});

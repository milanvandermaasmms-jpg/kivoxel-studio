import { describe, expect, it } from "vitest";
import { memoryDb, type Tables } from "./memoryDb.ts";
import { runTool, type ChannelRow, type ToolEnv } from "./tools.ts";
import { createIvarLane, cardNote } from "./lane.ts";
import { readReply, type IvarModel, type Reply } from "./model.ts";
import type { Card } from "../../lib/ivar/types.ts";
import { classifyIntent } from "../../lib/ivar/intent.ts";

const STUDIO = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDIO = "00000000-0000-4000-8000-000000000002";
const KIV = "00000000-0000-4000-8000-0000000000a1";
const DN = "00000000-0000-4000-8000-0000000000a2";
const REC = "00000000-0000-4000-8000-0000000000b1";
const VID = "00000000-0000-4000-8000-0000000000c1";
const DN_VID = "00000000-0000-4000-8000-0000000000c2";
const FOREIGN_VID = "00000000-0000-4000-8000-0000000000c3";
const SCRIPT = "00000000-0000-4000-8000-0000000000d1";
const MILAN = "00000000-0000-4000-8000-0000000000e1";
const STRANGER = "00000000-0000-4000-8000-0000000000e2";

const kivoxel: ChannelRow = { id: KIV, name: "KIVOXEL", is_default: true, status: "active", language: "en", audience: "kids 8-12", slug: "kivoxel", safety_profile: "kids_gaming", banned_words: [], voice_name: null, speaking_rate: null, made_for_kids: false, youtube_channel_id: null };
const dreamnest: ChannelRow = { ...kivoxel, id: DN, name: "Dreamnest", is_default: false, slug: "dreamnest", safety_profile: "infant_sleep" };

function seed(): Tables {
  return {
    yt_channels: [{ ...kivoxel, studio_id: STUDIO }, { ...dreamnest, studio_id: STUDIO }],
    yt_settings: [{ studio_id: STUDIO, paid_processing_enabled: true }],
    yt_recordings: [{ id: REC, studio_id: STUDIO, label: "The One Who Watches", status: "ready", duration_ms: 37 * 60_000, is_test: false, channel_id: KIV, created_at: "2026-11-14T10:00:00Z" }],
    yt_videos: [
      { id: VID, studio_id: STUDIO, recording_id: REC, format: "A", kind: "short", title: "Old title", promise: null, status: "scripted", plan_key: null, channel_id: KIV, youtube_video_id: null, is_test: false, created_at: "2026-11-14T10:00:00Z" },
      { id: DN_VID, studio_id: STUDIO, recording_id: null, format: "C", kind: "long", title: "Lumi", promise: null, status: "review", plan_key: null, channel_id: DN, youtube_video_id: null, is_test: false, created_at: "2026-11-14T10:00:00Z" },
      { id: FOREIGN_VID, studio_id: OTHER_STUDIO, recording_id: null, format: "A", kind: "short", title: "Not ours", promise: null, status: "scripted", plan_key: null, channel_id: KIV, youtube_video_id: null, is_test: false, created_at: "2026-11-14T10:00:00Z" },
    ],
    yt_scripts: [
      {
        id: SCRIPT,
        studio_id: STUDIO,
        video_id: VID,
        version: 1,
        language: "en",
        top_line: null,
        hook: "Watch this",
        lines: [{ at_ms: 0, text: "Watch this" }, { at_ms: 5000, text: "Then this happened" }],
        edit_plan: [{ part: "hook", src_start_ms: 10_000, src_end_ms: 40_000, out_start_ms: 0, speed: 1, effects: [], note: "" }],
        target_ms: 30_000,
        status: "approved",
        source: "ai",
        is_test: false,
      },
    ],
    yt_jobs: [],
    yt_publications: [],
    yt_renders: [],
    yt_viral_checks: [],
    yt_moments: [],
    ivar_actions: [],
    ivar_revisions: [],
    ivar_ideas: [],
    ivar_memory: [],
    studio_members: [{ studio_id: STUDIO, user_id: MILAN, role: "eigenaar" }],
    studios: [{ id: STUDIO, name: "KIVOXEL Studio" }],
    ivar_conversations: [],
    ivar_messages: [],
    yt_costs: [],
  };
}

function envFor(tables: Tables, text: string, channel: ChannelRow | null = kivoxel, project: ToolEnv["project"] = null): ToolEnv {
  const { db } = memoryDb(tables);
  return { db, studioId: STUDIO, conversationId: "conv-1", replyId: "reply-1", channel, project, intent: classifyIntent(text), userText: text, cards: [], dreamnest: true };
}

describe("Ivar tools: scope and rights", () => {
  it("never reads a video of another studio", async () => {
    const out = await runTool(envFor(seed(), "Bekijk deze video"), "get_project", { kind: "video", id: FOREIGN_VID });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.result)).toMatch(/bestaat niet/);
  });

  it("keeps channels apart: a Dreamnest video is refused in the KIVOXEL scope", async () => {
    const out = await runTool(envFor(seed(), "Maak drie titels"), "propose_titles", { video_id: DN_VID, options: [{ title: "x", why: "y" }] });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.result)).toMatch(/ander kanaal/);
  });

  it("refuses invalid input with a clear message and logs every call", async () => {
    const tables = seed();
    const out = await runTool(envFor(tables, "Maak titels"), "propose_titles", { video_id: "not-a-uuid", options: [] });
    expect(out.ok).toBe(false);
    expect(tables.ivar_actions).toHaveLength(1);
    expect(tables.ivar_actions[0]).toMatchObject({ tool: "propose_titles", ok: false, actor: "ivar", studio_id: STUDIO });
  });

  it("says honestly that a function does not exist", async () => {
    const out = await runTool(envFor(seed(), "Publiceer deze video"), "publish_video", { video_id: VID });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.result)).toMatch(/geen functie/);
  });
});

describe("Ivar tools: brainstorm never starts work", () => {
  it("does not start a montage from a brainstorm or a question", async () => {
    for (const text of ["Waarom voelt deze video nog zo statisch?", "Bedenk vijf nieuwe video's voor Lumi"]) {
      const tables = seed();
      const out = await runTool(envFor(tables, text), "start_render", { video_id: VID });
      expect(out.ok).toBe(false);
      expect(tables.yt_jobs).toHaveLength(0);
    }
  });

  it("starts a montage on a concrete request, once, and a retried answer finds the same step", async () => {
    const tables = seed();
    const env = envFor(tables, "Start de montage van deze video");
    const first = await runTool(env, "start_render", { video_id: VID });
    expect(first.ok).toBe(true);
    expect(tables.yt_jobs).toHaveLength(1);
    expect(tables.yt_jobs[0]).toMatchObject({ step: "render", payload: { script_id: SCRIPT } });
    tables.yt_jobs[0].status = "queued";
    const second = await runTool(env, "start_render", { video_id: VID });
    expect(second.ok).toBe(true);
    expect(second.result).toMatchObject({ started: false, already_running: true });
    expect(tables.yt_jobs).toHaveLength(1);
    expect(env.cards.filter((c) => c.type === "task")).toHaveLength(2);
  });

  it("a paid analysis only shows a cost card; nothing is queued until Milan clicks", async () => {
    const tables = seed();
    const env = envFor(tables, "Analyseer deze opname");
    const out = await runTool(env, "start_analysis", { recording_id: REC, mode: "first" });
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ needs_confirmation: true });
    expect(tables.yt_jobs).toHaveLength(0);
    expect(env.cards[0]).toMatchObject({ type: "confirm", action: "analyse", estimate: true });
  });

  it("there is no publish tool: prepare_publish only checks and shows a card", async () => {
    const tables = seed();
    const env = envFor(tables, "Publiceer deze video");
    const out = await runTool(env, "prepare_publish", { video_id: VID });
    expect(out.ok).toBe(true);
    expect(tables.yt_jobs).toHaveLength(0);
    expect((env.cards[0] as Extract<Card, { type: "publish" }>).problems.length).toBeGreaterThan(0);
  });
});

describe("Ivar tools: concept changes are stored and reversible", () => {
  it("applies a working title as a concept, with the old value kept for undo", async () => {
    const tables = seed();
    const out = await runTool(envFor(tables, "Verander de titel in Creeper Ambush"), "update_metadata_draft", { video_id: VID, title: "Creeper Ambush", apply: true });
    expect(out.ok).toBe(true);
    expect(tables.yt_videos[0].title).toBe("Creeper Ambush");
    expect(tables.ivar_revisions[0]).toMatchObject({ target: "video", field: "title", before_value: "Old title", after_value: "Creeper Ambush", status: "applied" });
  });

  it("always builds on the version that is there now (hand edits are the new base)", async () => {
    const tables = seed();
    const env = envFor(tables, "Verander de titel");
    // Someone edits the title between Ivar's read and the write: simulated by a stale revision.
    tables.yt_videos[0].title = "Changed by hand";
    const out = await runTool(env, "update_metadata_draft", { video_id: VID, title: "New", apply: true });
    expect(out.ok).toBe(true);
    expect(tables.yt_videos[0].title).toBe("New");
    tables.yt_videos[0].title = "Edited again";
    const { db } = memoryDb(tables);
    const stale = await runTool({ ...env, db, cards: [] }, "update_metadata_draft", { video_id: VID, title: "Newer", apply: true });
    expect(stale.ok).toBe(true);
    expect(tables.yt_videos[0].title).toBe("Newer");
  });

  it("title proposals change nothing until Milan applies one", async () => {
    const tables = seed();
    const env = envFor(tables, "Maak drie titels voor deze Minecraft-video");
    const out = await runTool(env, "propose_titles", { video_id: VID, options: [{ title: "A", why: "1" }, { title: "B", why: "2" }, { title: "C", why: "3" }] });
    expect(out.ok).toBe(true);
    expect(tables.yt_videos[0].title).toBe("Old title");
    expect(tables.ivar_revisions.map((r) => r.status)).toEqual(["proposed", "proposed", "proposed"]);
    expect((env.cards[0] as Extract<Card, { type: "titles" }>).options).toHaveLength(3);
  });

  it("description needs the publication draft, which exists only after approval", async () => {
    const out = await runTool(envFor(seed(), "Maak het beschrijvingsconcept korter"), "update_metadata_draft", { video_id: VID, description: "Short", apply: true });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out.result)).toMatch(/goedgekeurd/);
  });

  it("an edit proposal becomes a new draft script version; the old one stays", async () => {
    const tables = seed();
    const env = envFor(tables, "Knip het stuk van 0:05 tot 0:10 eruit");
    const out = await runTool(env, "propose_edit", { video_id: VID, cuts: [{ from_ms: 5000, to_ms: 10_000 }], note: "Intro te traag" });
    expect(out.ok).toBe(true);
    expect(tables.yt_scripts).toHaveLength(2);
    expect(tables.yt_scripts[0]).toMatchObject({ version: 1, status: "approved" });
    expect(tables.yt_scripts[1]).toMatchObject({ version: 2, status: "draft", model: "ivar" });
  });

  it("memory from a brainstorm is only a question; 'onthoud' stores it", async () => {
    const tables = seed();
    const ask = await runTool(envFor(tables, "Misschien wat donkerdere thumbnails?"), "save_memory", { content: "Donkere thumbnails", scope: "channel", confirmed: true });
    expect(ask.result).toMatchObject({ saved: false });
    expect(tables.ivar_memory).toHaveLength(0);
    const keep = await runTool(envFor(tables, "Onthoud: voortaan altijd Engelse voice-over"), "save_memory", { content: "Engelse voice-over", scope: "channel", confirmed: true });
    expect(keep.result).toMatchObject({ saved: true });
    expect(tables.ivar_memory[0]).toMatchObject({ channel_id: KIV, source: "ivar" });
  });
});

describe("Ivar tools: tasks", () => {
  it("cancels only steps in this studio and asks a running step to stop", async () => {
    const tables = seed();
    tables.yt_jobs.push({ id: "00000000-0000-4000-8000-0000000000f1", studio_id: STUDIO, video_id: VID, step: "render", status: "running", idempotency_key: "r1" });
    tables.yt_jobs.push({ id: "00000000-0000-4000-8000-0000000000f2", studio_id: OTHER_STUDIO, video_id: FOREIGN_VID, step: "render", status: "queued", idempotency_key: "r2" });
    const env = envFor(tables, "Annuleer de render");
    expect((await runTool(env, "cancel_task", { job_id: "00000000-0000-4000-8000-0000000000f1", queue: "yt" })).result).toMatchObject({ cancel_requested: true });
    expect(tables.yt_jobs[0].cancel_requested).toBe(true);
    const foreign = await runTool(env, "cancel_task", { job_id: "00000000-0000-4000-8000-0000000000f2", queue: "yt" });
    expect(foreign.ok).toBe(false);
    expect(tables.yt_jobs[1].status).toBe("queued");
  });

  it("retry puts the same step back, never a second paid step or an upload", async () => {
    const tables = seed();
    tables.yt_jobs.push({ id: "00000000-0000-4000-8000-0000000000f3", studio_id: STUDIO, recording_id: REC, step: "analyse", status: "failed", attempts: 3, idempotency_key: "a1" });
    tables.yt_jobs.push({ id: "00000000-0000-4000-8000-0000000000f4", studio_id: STUDIO, video_id: VID, step: "upload", status: "failed", idempotency_key: "u1" });
    const env = envFor(tables, "Probeer de analyse opnieuw");
    await runTool(env, "retry_task", { job_id: "00000000-0000-4000-8000-0000000000f3" });
    expect(tables.yt_jobs).toHaveLength(2);
    expect(tables.yt_jobs[0]).toMatchObject({ status: "queued", attempts: 0 });
    const up = await runTool(env, "retry_task", { job_id: "00000000-0000-4000-8000-0000000000f4" });
    expect(up.ok).toBe(false);
  });
});

// ---------- The lane: one answer end to end ----------

function scripted(replies: Reply[]): IvarModel & { seen: number } {
  const m = {
    model: "test-model",
    seen: 0,
    async generate() {
      const r = replies[m.seen++];
      if (!r) throw new Error("no more replies");
      return r;
    },
  };
  return m;
}
const reply = (text: string, calls: { name: string; args: unknown }[] = []): Reply => ({ parts: calls.length ? calls.map((c) => ({ functionCall: c })) : [{ text }], text, calls, usage: { inputTokens: 1000, outputTokens: 100 } });

function laneSetup(paid = true) {
  const tables = seed();
  tables.yt_settings[0].paid_processing_enabled = paid;
  tables.ivar_conversations.push({ id: "c1", studio_id: STUDIO, channel_id: KIV, project_kind: "video", project_id: VID, project_label: "Old title" });
  tables.ivar_messages.push({ id: "m1", studio_id: STUDIO, conversation_id: "c1", role: "user", content: "Maak drie titels voor deze video", cards: [], status: "done", scope: {}, created_by: MILAN, created_at: "2026-11-14T12:00:00Z" });
  tables.ivar_messages.push({ id: "r1", studio_id: STUDIO, conversation_id: "c1", role: "assistant", content: "", cards: [], status: "pending", scope: {}, job_id: "j1", created_at: "2026-11-14T12:00:01Z" });
  const job = { id: "j1", studio_id: STUDIO, step: "assistant", status: "queued", attempts: 0, max_attempts: 1, payload: { conversation_id: "c1", message_id: "m1" }, idempotency_key: "assistant:m1" };
  tables.yt_jobs.push(job);
  let reserved = 0;
  const { db } = memoryDb(tables, {
    claim_yt_job: () => {
      if (job.status !== "queued") return { data: [] };
      Object.assign(job, { status: "running", attempts: 1, locked_by: "pc" });
      return { data: [{ ...job }] };
    },
    reserve_yt_cost: (_a, t) => {
      if (!t.yt_settings[0].paid_processing_enabled) return { error: { message: "Betaalde verwerking staat uit: eerst akkoord" } };
      reserved++;
      t.yt_costs.push({ id: "cost1", job_id: "j1", category: "analysis", amount_cents: 1, is_estimate: true });
      return { data: 1 };
    },
  });
  return { tables, db, job, reserved: () => reserved };
}

describe("Ivar lane", () => {
  it("answers with tool results as cards, reserves the cost once and settles it", async () => {
    const s = laneSetup();
    const model = scripted([reply("", [{ name: "propose_titles", args: { video_id: VID, options: [{ title: "Creeper Ambush", why: "spanning" }] } }]), reply("Hier zijn je titels.")]);
    const lane = createIvarLane({ db: s.db, workerName: "pc", log: () => {}, model, dreamnest: true });
    await lane.tick();
    const r1 = s.tables.ivar_messages.find((m) => m.id === "r1")!;
    expect(r1.status).toBe("done");
    expect(r1.content).toBe("Hier zijn je titels.");
    expect((r1.cards as Card[])[0].type).toBe("titles");
    expect(s.job.status).toBe("done");
    expect(s.reserved()).toBe(1);
    expect(s.tables.yt_costs[0]).toMatchObject({ is_estimate: false });
    expect(s.tables.ivar_actions[0]).toMatchObject({ tool: "propose_titles", ok: true, message_id: "r1" });
  });

  it("is honest when paid processing is off: no answer is invented", async () => {
    const s = laneSetup(false);
    const model = scripted([reply("should not be used")]);
    await createIvarLane({ db: s.db, workerName: "pc", log: () => {}, model, dreamnest: true }).tick();
    const r1 = s.tables.ivar_messages.find((m) => m.id === "r1")!;
    expect(r1.status).toBe("error");
    expect(r1.content).toMatch(/betaalde verwerking staat uit/i);
    expect(model.seen).toBe(0);
  });

  it("is honest without a Gemini key", async () => {
    const s = laneSetup();
    await createIvarLane({ db: s.db, workerName: "pc", log: () => {}, model: null, dreamnest: true }).tick();
    expect(s.tables.ivar_messages.find((m) => m.id === "r1")!.content).toMatch(/GEMINI_API_KEY/);
    expect(s.job.status).toBe("failed");
  });

  it("refuses a message from someone who is not an admin of the studio", async () => {
    const s = laneSetup();
    s.tables.ivar_messages[0].created_by = STRANGER;
    const model = scripted([reply("x")]);
    await createIvarLane({ db: s.db, workerName: "pc", log: () => {}, model, dreamnest: true }).tick();
    expect(s.tables.ivar_messages.find((m) => m.id === "r1")!.status).toBe("error");
    expect(model.seen).toBe(0);
  });

  it("closes an answer whose step was cancelled while waiting", async () => {
    const s = laneSetup();
    s.job.status = "cancelled";
    await createIvarLane({ db: s.db, workerName: "pc", log: () => {}, model: scripted([]), dreamnest: true }).tick();
    expect(s.tables.ivar_messages.find((m) => m.id === "r1")!.status).toBe("stopped");
  });
});

describe("Gemini reply reading", () => {
  it("separates text, thoughts and function calls", () => {
    const r = readReply({ candidates: [{ content: { parts: [{ text: "denken", thought: true }, { text: "Hallo" }, { functionCall: { name: "list_tasks", args: {} }, thoughtSignature: "sig" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    expect(r.text).toBe("Hallo");
    expect(r.calls).toEqual([{ name: "list_tasks", args: {} }]);
    expect(r.parts[2]).toHaveProperty("thoughtSignature");
  });
  it("treats an empty answer as an error, not as an answer", () => {
    expect(() => readReply({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })).toThrow(/leeg/);
  });
  it("summarises cards for the history", () => {
    expect(cardNote({ type: "task", queue: "yt", jobId: "x", label: "Montage" })).toMatch(/Montage/);
  });
});

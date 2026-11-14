// Ivar's lane in the worker: picks up the step 'assistant' from the normal queue (yt_jobs, claim_yt_job) next to the
// montage, so an answer never waits behind a render of many minutes. One answer at a time, cost reserved first
// (reserve_yt_cost, monthly cap), at most a few tool rounds, cancellable with the stop button.
import type { SupabaseClient } from "@supabase/supabase-js";
import { costCents } from "../gemini.ts";
import { classifyIntent } from "../../lib/ivar/intent.ts";
import { boundHistory, boundResult, systemPrompt, type PromptContext } from "../../lib/ivar/prompt.ts";
import { toGemini } from "../../lib/ivar/schema.ts";
import { TOOLS } from "../../lib/ivar/tools.ts";
import { taskView, type JobRow } from "../../lib/ivar/tasks.ts";
import type { Card, ProjectKind } from "../../lib/ivar/types.ts";
import { CHANNEL_COLUMNS, channelKind, memoryFor, readProject, runTool, STATUS_NOTE, type ChannelRow, type ToolEnv } from "./tools.ts";
import type { IvarModel, Turn } from "./model.ts";
import { runInsight, scheduleInsights, type JsonModel } from "./insights.ts";

type Job = { id: string; studio_id: string; step: string; attempts: number; max_attempts: number; payload: Record<string, unknown> | null };
type ConvRow = { id: string; studio_id: string; channel_id: string | null; project_kind: ProjectKind | null; project_id: string | null; project_label: string | null };
type MsgRow = { id: string; role: "user" | "assistant"; content: string; cards: Card[]; status: string; scope: Record<string, unknown>; created_by: string | null; job_id: string | null; created_at: string };

export const MAX_ROUNDS = 5;
export const MAX_CALLS_PER_ROUND = 4;
const ESTIMATE_CENTS = 1;
const TOOL_DECLARATIONS = TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: toGemini(t.input) }));

class Stopped extends Error {}

/** A short line per card in the history, so a follow-up ("pas de tweede toe") knows what was shown. */
export function cardNote(c: Card): string {
  switch (c.type) {
    case "titles":
      return `[titelvoorstellen voor video ${c.videoId}: ${c.options.map((o) => `"${o.title}"`).join(", ")}]`;
    case "metadata":
      return `[conceptwijziging ${c.applied ? "toegepast" : "voorgesteld"}: ${c.changes.map((x) => x.field).join(", ")}]`;
    case "concept":
      return `[idee opgeslagen: ${c.title}]`;
    case "task":
      return `[taak ${c.label}, id ${c.jobId}]`;
    case "confirm":
      return `[kostenkaart: ${c.label}, wacht op Milans klik]`;
    case "edit":
      return `[editvoorstel: nieuwe scriptversie ${c.version}]`;
    case "script":
      return `[voice-overtekst: nieuwe scriptversie ${c.version}]`;
    case "memory":
      return c.saved ? `[onthouden: ${c.content}]` : `[gevraagd of dit onthouden moet worden: ${c.content}]`;
    case "publish":
      return `[publicatiekaart, ${c.problems.length} punten]`;
    default:
      return `[kaart ${c.type}]`;
  }
}

export function createIvarLane(opts: { db: SupabaseClient; workerName: string; log: (msg: string) => void; model: IvarModel | null; json?: JsonModel | null; poke?: () => void; dreamnest: boolean; intervalMs?: number }) {
  const { db, workerName, log, model } = opts;
  let busy = false;
  let timer: NodeJS.Timeout | null = null;

  const setReply = (id: string, fields: Record<string, unknown>) => db.from("ivar_messages").update(fields).eq("id", id).then(({ error }) => error && log(`Ivar: antwoord ${id} niet bijgewerkt: ${error.message}`));

  async function finishJob(job: Job, fields: Record<string, unknown>) {
    const { error } = await db.from("yt_jobs").update({ locked_by: null, locked_at: null, finished_at: new Date().toISOString(), ...fields }).eq("id", job.id).eq("locked_by", workerName);
    if (error) log(`Ivar: stap ${job.id} niet afgerond: ${error.message}`);
  }

  async function settle(job: Job, usage: { inputTokens: number; outputTokens: number }) {
    const cents = costCents(usage);
    const { data } = await db.from("yt_costs").select("id, amount_cents, is_estimate").eq("job_id", job.id).eq("category", "analysis").maybeSingle<{ id: string; amount_cents: number; is_estimate: boolean }>();
    if (!data) return;
    await db.from("yt_costs").update({ amount_cents: data.is_estimate ? cents : data.amount_cents + cents, is_estimate: false, description: `Ivar: ${usage.inputTokens} invoer- en ${usage.outputTokens} uitvoertokens` }).eq("id", data.id);
  }

  /** What Ivar found in the last weeks for this channel: advice, shown as such (not a preference). */
  async function recentInsights(channelId: string): Promise<string[]> {
    const r = await db.from("ivar_insights").select("kind, title, suggestion, status, week").eq("channel_id", channelId).neq("status", "dismissed").order("created_at", { ascending: false }).limit(6).returns<{ kind: string; title: string; suggestion: string | null; status: string; week: string }[]>();
    return (r.data ?? []).map((i) => `[${i.kind}, ${i.week}${i.status === "accepted" ? ", door Milan omarmd" : ""}] ${i.title}${i.suggestion ? ` → ${i.suggestion}` : ""}`);
  }

  async function context(env: ToolEnv, conv: ConvRow, scope: Record<string, unknown>, channels: ChannelRow[]): Promise<PromptContext> {
    const studio = await db.from("studios").select("name").eq("id", conv.studio_id).maybeSingle<{ name: string }>();
    let project: PromptContext["project"] = null;
    if (env.project) {
      try {
        const p = await readProject(env, { kind: env.project.kind, id: env.project.id });
        project = { kind: env.project.kind, id: env.project.id, label: env.project.label, summary: JSON.stringify(p).slice(0, 2500) };
      } catch (e) {
        project = { kind: env.project.kind, id: env.project.id, label: env.project.label, summary: `Niet te lezen: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    let tq = db.from("yt_jobs").select("id, step, status, error, phase, progress, cancel_requested, created_at, started_at").eq("studio_id", conv.studio_id).in("status", ["queued", "running"]).neq("step", "assistant");
    if (conv.channel_id) tq = tq.or(`channel_id.eq.${conv.channel_id},channel_id.is.null`);
    const active = await tq.order("created_at").limit(6).returns<JobRow[]>();
    return {
      studioName: studio.data?.name ?? "de studio",
      channels: channels.map((c) => ({ id: c.id, name: c.name, kind: channelKind(c), status: c.status })),
      channel: env.channel ? { id: env.channel.id, name: env.channel.name, kind: channelKind(env.channel), language: env.channel.language, audience: env.channel.audience } : null,
      project,
      page: typeof scope.page === "string" ? scope.page.slice(0, 60) : null,
      memory: await memoryFor(env).catch(() => []),
      tasks: (active.data ?? []).map((j) => {
        const t = taskView(j, "yt");
        return `${t.name}: ${t.statusLabel}${t.percent !== null ? ` (${t.percent}%)` : ""} (id ${j.id})`;
      }),
      insights: env.channel ? await recentInsights(env.channel.id) : [],
      intent: env.intent,
      today: new Date().toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    };
  }

  async function answer(job: Job) {
    const conversationId = String(job.payload?.conversation_id ?? "");
    const messageId = String(job.payload?.message_id ?? "");
    const reply = await db.from("ivar_messages").select("id").eq("job_id", job.id).eq("role", "assistant").eq("studio_id", job.studio_id).maybeSingle<{ id: string }>();
    if (!reply.data) return finishJob(job, { status: "failed", error: "Geen antwoordplek gevonden" });
    const replyId = reply.data.id;
    const failWith = async (message: string) => {
      await setReply(replyId, { status: "error", note: null, content: message.slice(0, 2000) });
      await finishJob(job, { status: "failed", error: message.slice(0, 500) });
    };

    const conv = await db.from("ivar_conversations").select("id, studio_id, channel_id, project_kind, project_id, project_label").eq("id", conversationId).eq("studio_id", job.studio_id).maybeSingle<ConvRow>();
    const msg = await db.from("ivar_messages").select("id, role, content, cards, status, scope, created_by, job_id, created_at").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle<MsgRow>();
    if (!conv.data || !msg.data || msg.data.role !== "user") return failWith("Dit gesprek of bericht bestaat niet meer.");
    // The sender must still be an admin of this studio; the conversation gives no extra rights.
    const member = msg.data.created_by ? await db.from("studio_members").select("role").eq("studio_id", job.studio_id).eq("user_id", msg.data.created_by).maybeSingle<{ role: string }>() : { data: null };
    if (!member.data || !["eigenaar", "beheerder"].includes(member.data.role)) return failWith("Alleen beheerders van deze studio kunnen Ivar opdrachten geven.");
    if (!model) return failWith("Ivar heeft geen verbinding met Gemini: GEMINI_API_KEY ontbreekt in worker/.env.local. Zet de sleutel daar en start de werker opnieuw.");

    const reserved = await db.rpc("reserve_yt_cost", { p_studio: job.studio_id, p_job: job.id, p_category: "analysis", p_service: `Gemini ${model.model} (Ivar)`, p_estimate_cents: ESTIMATE_CENTS });
    if (reserved.error) return failWith(/betaalde verwerking staat uit/i.test(reserved.error.message) ? "Ivar gebruikt Gemini (± 1 cent per antwoord) en betaalde verwerking staat uit. Zet die aan in Instellingen > Analyse, met een maandplafond." : /maandplafond/i.test(reserved.error.message) ? `Het maandplafond is bereikt, dus Ivar antwoordt niet meer deze maand. ${reserved.error.message}` : `Kosten konden niet worden vastgelegd: ${reserved.error.message}`);

    // The default channel is KIVOXEL in the studio, whatever its first name in the database was.
    const channels = ((await db.from("yt_channels").select(CHANNEL_COLUMNS).eq("studio_id", job.studio_id).returns<ChannelRow[]>()).data ?? []).map((c) => (c.is_default ? { ...c, name: "KIVOXEL" } : c));
    const channel = conv.data.channel_id ? (channels.find((c) => c.id === conv.data!.channel_id) ?? null) : null;
    const cards: Card[] = [];
    const env: ToolEnv = {
      db,
      studioId: job.studio_id,
      conversationId,
      replyId,
      channel,
      project: conv.data.project_kind && conv.data.project_id ? { kind: conv.data.project_kind, id: conv.data.project_id, label: conv.data.project_label ?? "Project" } : null,
      intent: classifyIntent(msg.data.content),
      userText: msg.data.content,
      cards,
      poke: opts.poke,
      dreamnest: opts.dreamnest,
    };

    // Stop button: the database asks, this lane listens every 2 seconds and breaks off the call to Gemini.
    const control = new AbortController();
    const watch = setInterval(async () => {
      const { data } = await db.from("yt_jobs").select("cancel_requested").eq("id", job.id).maybeSingle<{ cancel_requested: boolean }>();
      await db.from("yt_jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", job.id).eq("locked_by", workerName);
      if (data?.cancel_requested) control.abort(new Stopped("Gestopt"));
    }, 2000);
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      await setReply(replyId, { status: "running", note: "Denkt na" });
      const prompt = systemPrompt(await context(env, conv.data, msg.data.scope ?? {}, channels));
      const history = await db.from("ivar_messages").select("role, content, cards, status, created_at").eq("conversation_id", conversationId).lte("created_at", msg.data.created_at).neq("id", replyId).order("created_at", { ascending: false }).limit(30).returns<MsgRow[]>();
      const items = (history.data ?? [])
        .reverse()
        .filter((m) => m.role === "user" || m.status === "done")
        .map((m) => ({ role: m.role, content: [m.content, ...(m.cards ?? []).map(cardNote)].filter(Boolean).join("\n") || "(leeg)" }));
      const contents: Turn[] = boundHistory(items).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
      if (!contents.length || contents[0].role !== "user") contents.unshift({ role: "user", parts: [{ text: "(begin van het gesprek)" }] });

      let text = "";
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const last = round === MAX_ROUNDS;
        const r = await model.generate({ system: prompt, contents, tools: TOOL_DECLARATIONS, allowTools: !last, signal: control.signal });
        usage.inputTokens += r.usage.inputTokens;
        usage.outputTokens += r.usage.outputTokens;
        if (!r.calls.length || last) {
          text = r.text;
          break;
        }
        contents.push({ role: "model", parts: r.parts });
        const responses = [];
        for (const call of r.calls.slice(0, MAX_CALLS_PER_ROUND)) {
          control.signal.throwIfAborted();
          await setReply(replyId, { note: STATUS_NOTE[call.name] ?? "Werkt aan je vraag" });
          const out = await runTool(env, call.name, call.args);
          responses.push({ functionResponse: { name: call.name, response: { ok: out.ok, ...boundResult(out.result) } } });
        }
        for (const call of r.calls.slice(MAX_CALLS_PER_ROUND)) responses.push({ functionResponse: { name: call.name, response: { ok: false, error: "Te veel functies tegelijk; niet uitgevoerd." } } });
        contents.push({ role: "user", parts: responses });
      }
      if (!text) text = cards.length ? "Zie de kaarten hieronder." : "Ik heb hier geen antwoord op kunnen maken.";
      await settle(job, usage);
      let kept = cards;
      while (JSON.stringify(kept).length > 58_000 && kept.length) kept = kept.slice(0, -1);
      await setReply(replyId, { status: "done", note: null, content: text.slice(0, 8000), cards: kept });
      await finishJob(job, { status: "done", result: { rounds: contents.length, cards: kept.length, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });
    } catch (e) {
      await settle(job, { inputTokens: usage.inputTokens + ((e as { usage?: { inputTokens: number } }).usage?.inputTokens ?? 0), outputTokens: usage.outputTokens + ((e as { usage?: { outputTokens: number } }).usage?.outputTokens ?? 0) });
      if (control.signal.aborted && control.signal.reason instanceof Stopped) {
        // What already ran (a task, a saved idea) really happened: those cards stay visible.
        await setReply(replyId, { status: "stopped", note: null, content: cards.length ? "Gestopt. Wat al gedaan was, staat hieronder." : "Gestopt.", cards });
        await finishJob(job, { status: "cancelled", error: "Gestopt" });
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      await setReply(replyId, { status: "error", note: null, content: `Ivar kon dit niet afmaken: ${message}`.slice(0, 2000), cards });
      await finishJob(job, { status: "failed", error: message.slice(0, 500) });
    } finally {
      clearInterval(watch);
    }
  }

  /** Answers whose step stopped elsewhere (worker restarted, step cancelled while waiting) are closed honestly. */
  async function sweep() {
    const open = await db.from("ivar_messages").select("id, job_id, status").eq("role", "assistant").in("status", ["pending", "running"]).limit(30).returns<{ id: string; job_id: string | null; status: string }[]>();
    const ids = (open.data ?? []).map((m) => m.job_id).filter((x): x is string => !!x);
    if (!ids.length) return;
    const jobs = await db.from("yt_jobs").select("id, status, error").in("id", ids).returns<{ id: string; status: string; error: string | null }[]>();
    const byId = new Map((jobs.data ?? []).map((j) => [j.id, j]));
    for (const m of open.data ?? []) {
      const j = m.job_id ? byId.get(m.job_id) : null;
      if (j && (j.status === "queued" || j.status === "running")) continue;
      if (j?.status === "cancelled") await setReply(m.id, { status: "stopped", note: null, content: "Gestopt." });
      else await setReply(m.id, { status: "error", note: null, content: `Ivar kon dit niet afmaken: ${j?.error ?? "de stap is verdwenen"}. Probeer het opnieuw.` });
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await sweep().catch((e) => log(`Ivar: opruimen mislukt: ${e instanceof Error ? e.message : String(e)}`));
      for (;;) {
        const { data, error } = await db.rpc("claim_yt_job", { p_worker: workerName, p_steps: ["assistant", "insight"] });
        if (error) return log(`Ivar: wachtrij niet bereikbaar: ${error.message}`);
        const job = (data as Job[] | null)?.[0];
        if (!job) return;
        if (job.step === "insight") {
          log(`Ivar zoekt trends en leert (${job.id})`);
          try {
            const result = await runInsight(db, opts.json ?? null, job);
            await finishJob(job, { status: "done", result, error: null });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const again = job.attempts < job.max_attempts && !/betaalde verwerking|maandplafond|GEMINI_API_KEY/i.test(message);
            await finishJob(job, again ? { status: "queued", error: message.slice(0, 500), finished_at: null } : { status: "failed", error: message.slice(0, 500) });
          }
          continue;
        }
        log(`Ivar beantwoordt een bericht (${job.id})`);
        try {
          await answer(job);
        } catch (e) {
          log(`Ivar: fout bij ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
          await finishJob(job, { status: "failed", error: "Er ging iets mis in de werker" });
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      void tick();
      timer = setInterval(() => void tick(), opts.intervalMs ?? 3000);
      // On his own: once a week per channel trends and lessons (checked a minute after start and every 6 hours).
      const plan = () => void scheduleInsights(db, log).then((n) => n && (log(`Ivar: ${n} kanaal/kanalen ingepland voor trends en leren`), void tick())).catch(() => undefined);
      setTimeout(plan, 60_000);
      setInterval(plan, 6 * 3_600_000);
    },
    scheduleInsights: () => scheduleInsights(db, log),
    stop() {
      if (timer) clearInterval(timer);
    },
    tick,
    poke: () => void tick(),
  };
}

"use client";
// Ivar's result cards. Every button calls a real function (RPC or the existing studio function); what is applied,
// running or done is read live from the database, never from the chat text.
import { AlertTriangle, Check, CircleSlash, ExternalLink, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { queueAnalysis, queueSeries } from "@/lib/youtube/analysisData";
import { requestViral } from "@/lib/youtube/viralData";
import { createEpisode } from "@/lib/dreamnest/data";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { openInStudio } from "@/lib/ivar/pageContext";
import { elapsed, taskView, type JobRow } from "@/lib/ivar/tasks";
import { euro, mmss, type Card, type Idea, type Revision } from "@/lib/ivar/types";
import * as data from "@/lib/ivar/data";

export type CardLive = {
  revisions: Map<string, Revision>;
  jobs: Map<string, { row: JobRow; queue: "yt" | "dn" }>;
  ideas: Map<string, Idea>;
  now: number;
};
export type CardCtx = { studioId: string; conversationId: string | null; workerOnline: boolean; live: CardLive; refresh: () => void; ask: (text: string) => void };

const box = "mt-2 rounded-lg border border-slate-200 bg-surface p-3 text-sm";
const small = "inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";
const primary = `${small} bg-violet-600 text-white hover:bg-violet-700`;
const secondary = `${small} border border-slate-200 text-slate-700 hover:bg-slate-50`;
const FIELD: Record<string, string> = { title: "Titel", description: "Beschrijving", tags: "Tags" };
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")) || "(leeg)";

function useAction(ctx: CardCtx) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      ctx.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const errorLine = error ? (
    <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
      {error}
    </p>
  ) : null;
  return { busy, run, errorLine };
}

function TitlesCard({ card, ctx }: { card: Extract<Card, { type: "titles" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  return (
    <div className={box}>
      <p className="font-medium text-slate-800">Titelvoorstellen {card.target === "publication" ? "(publicatieconcept)" : "(werktitel)"}</p>
      <ul className="mt-2 space-y-2">
        {card.options.map((o, i) => {
          const r = ctx.live.revisions.get(o.revisionId);
          const applied = r?.status === "applied";
          return (
            <li key={o.revisionId} className={`rounded-md border p-2 ${applied ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}>
              <p className="font-medium text-slate-900">
                {i + 1}. {o.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">{o.why}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {applied ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden /> Toegepast als concept
                    </span>
                    <button type="button" className={secondary} disabled={a.busy} onClick={() => void a.run(async () => (await data.revertRevision(o.revisionId), data.logClick(ctx.studioId, ctx.conversationId, "revert_revision", `Titel teruggedraaid: ${o.title}`)))}>
                      <Undo2 className="h-3.5 w-3.5" aria-hidden /> Terugdraaien
                    </button>
                  </>
                ) : (
                  <button type="button" className={primary} disabled={a.busy || !r} onClick={() => void a.run(async () => (await data.applyRevision(o.revisionId), data.logClick(ctx.studioId, ctx.conversationId, "apply_revision", `Titel toegepast: ${o.title}`)))}>
                    Als concept toepassen
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Niets wordt gepubliceerd. Je ziet de titel terug bij de video.</p>
      {a.errorLine}
    </div>
  );
}

function MetadataCard({ card, ctx }: { card: Extract<Card, { type: "metadata" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  const states = card.changes.map((c) => ctx.live.revisions.get(c.revisionId)?.status ?? (card.applied ? "applied" : "proposed"));
  const anyApplied = states.includes("applied");
  const anyOpen = states.some((s) => s === "proposed" || s === "reverted");
  return (
    <div className={box}>
      <p className="font-medium text-slate-800">Conceptwijziging</p>
      {card.note && <p className="text-xs text-slate-600">{card.note}</p>}
      <dl className="mt-2 space-y-2">
        {card.changes.map((c, i) => (
          <div key={c.revisionId}>
            <dt className="text-xs font-medium text-slate-500">
              {FIELD[c.field]} · {states[i] === "applied" ? "toegepast" : states[i] === "reverted" ? "teruggedraaid" : states[i] === "superseded" ? "vervangen" : "voorstel"}
            </dt>
            <dd className="mt-0.5 grid gap-1 sm:grid-cols-2">
              <p className="whitespace-pre-wrap rounded bg-slate-50 p-1.5 text-xs text-slate-500 line-through decoration-slate-400/60">{show(c.before).slice(0, 600)}</p>
              <p className="whitespace-pre-wrap rounded bg-violet-50 p-1.5 text-xs text-slate-800">{show(c.after).slice(0, 600)}</p>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {anyOpen && (
          <button type="button" className={primary} disabled={a.busy} onClick={() => void a.run(async () => { for (const c of card.changes) if (["proposed", "reverted"].includes(ctx.live.revisions.get(c.revisionId)?.status ?? "proposed")) await data.applyRevision(c.revisionId); await data.logClick(ctx.studioId, ctx.conversationId, "apply_revision", "Conceptwijziging toegepast"); })}>
            Toepassen
          </button>
        )}
        {anyApplied && (
          <button type="button" className={secondary} disabled={a.busy} onClick={() => void a.run(async () => { for (const c of card.changes) if (ctx.live.revisions.get(c.revisionId)?.status === "applied") await data.revertRevision(c.revisionId); await data.logClick(ctx.studioId, ctx.conversationId, "revert_revision", "Conceptwijziging teruggedraaid"); })}>
            <Undo2 className="h-3.5 w-3.5" aria-hidden /> Terugdraaien
          </button>
        )}
        <button type="button" className={secondary} onClick={() => openInStudio(card.videoId)}>
          Bekijk bij de video
        </button>
      </div>
      {a.errorLine}
    </div>
  );
}

function AnalysisCard({ card, ctx }: { card: Extract<Card, { type: "analysis" }>; ctx: CardCtx }) {
  const at = (ms: number | null) => (ms === null ? "" : `${mmss(ms)} · `);
  return (
    <div className={box}>
      <p className="font-medium text-slate-800">Analyse: {card.projectLabel}</p>
      <p className="mt-1 text-xs text-slate-500">
        Bron: {card.sources.data.join(", ") || "onbekend"} · {card.sources.wholeVideo ? "hele video" : "alleen een deel"} · audio {card.sources.audioAnalysed ? "geanalyseerd" : "niet geanalyseerd"}
      </p>
      <p className="mt-2 text-xs font-medium text-slate-500">Observaties</p>
      <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
        {card.observations.map((o, i) => (
          <li key={i}>
            <span className="tabular-nums text-slate-500">{at(o.atMs)}</span>
            {o.text}
          </li>
        ))}
      </ul>
      {card.priorities.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-slate-500">Prioriteiten</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-slate-700">
            {card.priorities.map((o, i) => (
              <li key={i}>
                <span className="tabular-nums text-slate-500">{at(o.atMs)}</span>
                {o.text}
              </li>
            ))}
          </ol>
        </>
      )}
      {card.uncertain.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 p-1.5 text-xs text-amber-800">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Onzeker: {card.uncertain.join(" · ")}
        </p>
      )}
      {card.videoId && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={primary} onClick={() => ctx.ask("Maak een editvoorstel op basis van deze analyse (als nieuwe versie).")}>
            Maak editvoorstel
          </button>
        </div>
      )}
    </div>
  );
}

function ConceptCard({ card, ctx }: { card: Extract<Card, { type: "concept" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  const idea = ctx.live.ideas.get(card.ideaId);
  const status = idea?.status ?? "idea";
  return (
    <div className={box}>
      <p className="text-xs font-medium uppercase tracking-wide text-violet-700">Videoconcept</p>
      <p className="font-medium text-slate-900">{card.title}</p>
      <p className="mt-1 text-slate-700">{card.premise}</p>
      {card.opening && (
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-medium">Opening:</span> {card.opening}
        </p>
      )}
      {card.sourceMaterial && (
        <p className="mt-0.5 text-xs text-slate-600">
          <span className="font-medium">Bronmateriaal:</span> {card.sourceMaterial}
        </p>
      )}
      {card.shorts.length > 0 && <p className="mt-0.5 text-xs text-slate-600">Shorts: {card.shorts.join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {status === "project" ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <Check className="h-3.5 w-3.5" aria-hidden /> Project gemaakt
          </span>
        ) : status === "dropped" ? (
          <span className="text-xs text-slate-500">Laten vallen</span>
        ) : card.channelKind === "dreamnest" ? (
          <button
            type="button"
            className={primary}
            disabled={a.busy || !idea}
            onClick={() =>
              void a.run(async () => {
                const id = await createEpisode(ctx.studioId, card.channelId, card.title.slice(0, 200), 60);
                await data.setIdea(card.ideaId, { status: "project", episode_id: id });
                await data.logClick(ctx.studioId, ctx.conversationId, "make_project", `Aflevering gemaakt: ${card.title}`, { channelId: card.channelId });
              })
            }
          >
            Maak project (aflevering, 60 min)
          </button>
        ) : (
          <span className="text-xs text-slate-600">Een KIVOXEL-project begint met een opname: upload de gameplay bij Uploaden.</span>
        )}
        {status === "idea" && (
          <button type="button" className={secondary} disabled={a.busy || !idea} onClick={() => void a.run(() => data.setIdea(card.ideaId, { status: "dropped" }))}>
            Laat vallen
          </button>
        )}
      </div>
      {a.errorLine}
    </div>
  );
}

function RenderResult({ jobId, ctx }: { jobId: string; ctx: CardCtx }) {
  const [render, setRender] = useState<data.RenderInfo | null | undefined>(undefined);
  useEffect(() => {
    void data.renderOfJob(jobId).then(setRender);
  }, [jobId]);
  if (!render) return null;
  const items = render.qc?.items ?? [];
  return (
    <div className="mt-2 border-t border-slate-200 pt-2">
      <p className="text-xs font-medium text-slate-500">Renderresultaat</p>
      {ctx.workerOnline ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video controls preload="metadata" crossOrigin="anonymous" src={`${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}`} className={`mt-1 max-h-72 rounded bg-black ${render.height > render.width ? "w-40" : "w-full"}`} />
      ) : (
        <p className="mt-1 text-xs text-slate-500">De preview staat op de pc; zet de werker aan om hem hier te bekijken.</p>
      )}
      <p className="mt-1 text-xs text-slate-600">
        {render.file_name} · {mmss(render.duration_ms)} · {render.width}×{render.height} · {render.voice_name ? `stem ${render.voice_name}` : "zonder stem"}
      </p>
      {items.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.label} className={i.level === "green" ? "text-emerald-700" : i.level === "red" ? "text-red-700" : "text-amber-700"}>
              {i.level === "green" ? "✓" : "!"} {i.label}
              {i.value ? `: ${i.value}` : ""}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${secondary} mt-1.5`} onClick={() => openInStudio(render.video_id)}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in editor
      </button>
    </div>
  );
}

export function TaskCard({ card, ctx }: { card: Extract<Card, { type: "task" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  const live = ctx.live.jobs.get(card.jobId);
  if (!live) {
    return (
      <div className={box}>
        <p className="text-slate-600">{card.label}: status laden…</p>
      </div>
    );
  }
  const t = taskView(live.row, live.queue);
  const tone = t.status === "failed" ? "text-red-700" : t.status === "succeeded" ? "text-emerald-700" : t.status === "cancelled" ? "text-slate-500" : "text-violet-700";
  return (
    <div className={box} aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{t.name}</p>
          <p className="truncate text-xs text-slate-500">{card.label}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${tone}`}>
          {(t.status === "running" || t.status === "queued") && <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />}
          {t.statusLabel}
        </span>
      </div>
      {t.percent !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={t.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Gemeten voortgang">
          <div className="h-full bg-violet-500 motion-safe:transition-all" style={{ width: `${t.percent}%` }} />
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Gestart {new Date(t.startedAt ?? t.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} · {elapsed(t.startedAt ?? t.createdAt, ctx.live.now, t.finishedAt)}
        {t.status === "queued" && !ctx.workerOnline ? " · de werker op de pc lijkt uit te staan" : ""}
      </p>
      {t.error && <p className="mt-1 text-xs text-red-700">{t.error}</p>}
      {t.next && <p className="mt-1 text-xs text-slate-600">Volgende stap: {t.next}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {t.canCancel && (
          <button type="button" className={secondary} disabled={a.busy} onClick={() => void a.run(async () => (live.queue === "yt" ? await data.cancelYtJob(card.jobId) : await data.cancelDnJob(card.jobId), data.logClick(ctx.studioId, ctx.conversationId, "cancel_task", `Geannuleerd: ${t.name}`, { jobId: card.jobId })))}>
            <CircleSlash className="h-3.5 w-3.5" aria-hidden /> Annuleren
          </button>
        )}
        {t.canRetry && (
          <button type="button" className={secondary} disabled={a.busy} onClick={() => void a.run(async () => (await data.retryYtJob(card.jobId), data.logClick(ctx.studioId, ctx.conversationId, "retry_task", `Opnieuw: ${t.name}`, { jobId: card.jobId })))}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Opnieuw (zelfde stap)
          </button>
        )}
      </div>
      {t.status === "succeeded" && t.step === "render" && <RenderResult jobId={card.jobId} ctx={ctx} />}
      {a.errorLine}
    </div>
  );
}

function ConfirmCard({ card, ctx }: { card: Extract<Card, { type: "confirm" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  const [done, setDone] = useState<string | null>(null);
  const go = () =>
    a.run(async () => {
      const r =
        card.action === "series" ? await queueSeries(ctx.studioId, card.targetId) : card.action === "quality" ? (await requestViral(ctx.studioId, card.targetId), "queued") : await queueAnalysis(ctx.studioId, card.targetId, card.action === "analyse_again");
      await data.logClick(ctx.studioId, ctx.conversationId, card.action === "quality" ? "start_quality_check" : "start_analysis", `${card.label} bevestigd${card.estimateCents !== null ? ` (± ${euro(card.estimateCents)})` : ""}`);
      void data.pokeWorker();
      setDone(r === "exists" ? "Stond al in de wachtrij." : "In de wachtrij gezet. Volg het bij In productie of vraag Ivar naar de voortgang.");
    });
  return (
    <div className={`${box} border-amber-200`}>
      <p className="font-medium text-slate-800">{card.label}</p>
      <p className="mt-0.5 text-xs text-slate-600">{card.text}</p>
      <p className="mt-1 text-xs text-slate-700">
        Kosten: {card.estimateCents === null ? "onbekend" : `${card.estimate ? "± " : ""}${euro(card.estimateCents)}${card.estimate ? " (schatting)" : ""}`} · binnen het maandplafond; boven het plafond weigert de studio de stap.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {done ? (
          <span className="text-xs text-emerald-700">{done}</span>
        ) : (
          <button type="button" className={primary} disabled={a.busy} onClick={() => void go()}>
            Ja, start ({card.estimateCents !== null ? `± ${euro(card.estimateCents)}` : "kosten onbekend"})
          </button>
        )}
      </div>
      {a.errorLine}
    </div>
  );
}

function MemoryCard({ card, ctx }: { card: Extract<Card, { type: "memory" }>; ctx: CardCtx }) {
  const a = useAction(ctx);
  const [state, setState] = useState<"ask" | "saved" | "no">(card.saved ? "saved" : "ask");
  return (
    <div className={box}>
      <p className="text-xs font-medium text-slate-500">Geheugen</p>
      <p className="text-slate-800">“{card.content}”</p>
      {state === "saved" ? (
        <p className="mt-1 text-xs text-emerald-700">Onthouden. Aanpassen of wissen kan bij Geheugen bovenin Ivar.</p>
      ) : state === "no" ? (
        <p className="mt-1 text-xs text-slate-500">Niet onthouden; geldt alleen voor dit gesprek.</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-600">{card.question}</span>
          <button type="button" className={primary} disabled={a.busy} onClick={() => void a.run(async () => (await data.addMemory(ctx.studioId, card.content, { channelId: card.channelId, projectKind: card.projectKind, projectId: card.projectId }), setState("saved")))}>
            Ja, onthouden
          </button>
          <button type="button" className={secondary} onClick={() => setState("no")}>
            Alleen dit gesprek
          </button>
        </div>
      )}
      {a.errorLine}
    </div>
  );
}

function PublishCard({ card }: { card: Extract<Card, { type: "publish" }> }) {
  return (
    <div className={`${box} border-sky-200`}>
      <p className="font-medium text-slate-800">Publiceren: controle</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-500">Kanaal</dt>
        <dd>{card.channelName}</dd>
        <dt className="text-slate-500">Bestand</dt>
        <dd>{card.fileName ?? "nog geen montage"}</dd>
        <dt className="text-slate-500">Zichtbaarheid</dt>
        <dd>{card.visibility === "private" ? "Privé" : card.visibility === "unlisted" ? "Niet vermeld" : "Openbaar"}</dd>
        <dt className="text-slate-500">Tijdstip</dt>
        <dd>{card.publishAt ? new Date(card.publishAt).toLocaleString("nl-NL") : "nog niet gekozen"}</dd>
      </dl>
      {card.problems.length > 0 && (
        <ul className="mt-1.5 list-disc pl-5 text-xs text-amber-800">
          {card.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-slate-600">Ivar publiceert niet zelf. Controleer en klik zelf in het publicatiescherm.</p>
      <button type="button" className={`${secondary} mt-1.5`} onClick={() => openInStudio(card.videoId)}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open publicatiescherm
      </button>
    </div>
  );
}

function VersionCard({ card }: { card: Extract<Card, { type: "edit" | "script" }> }) {
  return (
    <div className={box}>
      <p className="font-medium text-slate-800">{card.type === "edit" ? "Editvoorstel" : "Nieuwe voice-overtekst"} · versie {card.version}</p>
      <p className="mt-0.5 text-xs text-slate-600">{card.note}</p>
      {card.type === "edit" ? (
        <p className="mt-1 text-xs text-slate-600">
          Eruit: {card.cuts.map(([a, b]) => `${mmss(a)}-${mmss(b)}`).join(", ")} ({mmss(card.removedMs)} korter)
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-600">{card.changed} regel(s) aangepast, zelfde timing.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">Concept: de vorige versie en de opname blijven bewaard. Keur goed bij Actie nodig; daarna maak je de montage en vergelijk je.</p>
      <button type="button" className={`${secondary} mt-1.5`} onClick={() => openInStudio(card.videoId)}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open in editor
      </button>
    </div>
  );
}

export function IvarCard({ card, ctx }: { card: Card; ctx: CardCtx }) {
  switch (card.type) {
    case "titles":
      return <TitlesCard card={card} ctx={ctx} />;
    case "metadata":
      return <MetadataCard card={card} ctx={ctx} />;
    case "analysis":
      return <AnalysisCard card={card} ctx={ctx} />;
    case "concept":
      return <ConceptCard card={card} ctx={ctx} />;
    case "task":
      return <TaskCard card={card} ctx={ctx} />;
    case "confirm":
      return <ConfirmCard card={card} ctx={ctx} />;
    case "memory":
      return <MemoryCard card={card} ctx={ctx} />;
    case "publish":
      return <PublishCard card={card} />;
    case "edit":
    case "script":
      return <VersionCard card={card} />;
    case "unavailable":
      return (
        <div className={box}>
          <p className="font-medium text-slate-800">Niet beschikbaar: {card.what}</p>
          <p className="text-xs text-slate-600">{card.why}</p>
        </div>
      );
    default:
      return null;
  }
}

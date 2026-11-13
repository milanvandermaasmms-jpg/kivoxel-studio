"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { ReviewMode } from "@/components/youtube/ReviewMode";
import { euros } from "@/lib/youtube/analysisData";
import { buildProjects, reviewQueue, STAGES, type Project } from "@/lib/youtube/board";
import { loadBoard, type BoardState } from "@/lib/youtube/boardData";
import { WORKER_URL } from "@/lib/youtube/protocol";

/**
 * Pipeline board (superprompt 7.1): one column per step, one card per source, a filter per channel and a button
 * that opens the review mode with only what waits for Milan.
 */
export function PipelineBoard({ studioId, workerOnline, onOpenStudio }: { studioId: string; workerOnline: boolean; onOpenStudio: () => void }) {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const refresh = useCallback(async () => setBoard(await loadBoard(studioId)), [studioId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!board) return <p className="text-sm text-slate-500">Laden…</p>;
  if (!board.ready)
    return (
      <Section title="Pijplijnbord">
        <p className="text-sm text-slate-600">{board.reason === "migration" ? "De database is nog niet helemaal ingericht." : `Het bord laden lukte niet: ${board.message ?? ""}`}</p>
      </Section>
    );

  const projects = buildProjects(board.input).filter((p) => !channel || p.channelId === channel);
  const queue = reviewQueue(board.input.videos, board.input.scripts, channel);
  const channelOf = (id: string) => board.channels.find((c) => c.id === id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter per kanaal" className="flex flex-wrap gap-1">
          <FilterButton active={channel === null} onClick={() => setChannel(null)}>
            Alle kanalen
          </FilterButton>
          {board.channels.map((c) => (
            <FilterButton key={c.id} active={channel === c.id} onClick={() => setChannel(c.id)}>
              <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-slate-300" style={{ background: c.brand_color ?? "transparent" }} />
              {c.name}
              {c.status === "planned" && <span className="text-xs text-slate-400">(gepland)</span>}
            </FilterButton>
          ))}
        </div>
        <Button disabled={queue.length === 0} onClick={() => setReviewing(true)}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Te keuren ({queue.length})
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          {channel && channelOf(channel)?.status === "planned" ? "Dit kanaal is nog gepland; er zijn nog geen projecten." : "Nog geen projecten. Upload een opname of zet hem in de inbox-map."}
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
          <div className="flex snap-x snap-mandatory gap-3">
            {STAGES.map((stage) => {
              const cards = projects.filter((p) => p.stage === stage.key);
              return (
                <section key={stage.key} aria-label={stage.label} className="w-64 shrink-0 snap-start rounded-lg bg-slate-50 p-2">
                  <h3 className="flex items-center justify-between px-1 text-sm font-medium" title={stage.note}>
                    {stage.label}
                    <span className="text-xs font-normal text-slate-500">{cards.length}</span>
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {cards.map((p) => (
                      <ProjectCard key={p.key} project={p} color={channelOf(p.channelId)?.brand_color ?? null} channelName={channelOf(p.channelId)?.name ?? ""} poster={posterFor(board, p, workerOnline)} onOpen={onOpenStudio} />
                    ))}
                    {cards.length === 0 && <li className="px-1 text-xs text-slate-400">—</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {reviewing && (
        <ReviewMode
          studioId={studioId}
          board={board}
          items={queue}
          workerOnline={workerOnline}
          onClose={() => setReviewing(false)}
          onEdit={() => {
            setReviewing(false);
            onOpenStudio();
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/** First frame of the newest montage of the project, when the worker can serve it. */
function posterFor(board: Extract<BoardState, { ready: true }>, p: Project, workerOnline: boolean): string | null {
  if (!workerOnline) return null;
  const render = board.renders.find((r) => p.videoIds.includes(r.video_id));
  return render ? `${WORKER_URL}/renders/${encodeURIComponent(render.file_name)}#t=0.5` : null;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${active ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
      {children}
    </button>
  );
}

function ProjectCard({ project: p, color, channelName, poster, onOpen }: { project: Project; color: string | null; channelName: string; poster: string | null; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="block w-full overflow-hidden rounded-md border border-slate-200 bg-surface text-left text-sm shadow-sm hover:border-slate-400" style={{ borderLeft: `4px solid ${color ?? "#cbd5e1"}` }}>
        {poster && <video src={poster} crossOrigin="anonymous" muted playsInline preload="metadata" aria-hidden className="h-24 w-full bg-black object-cover" />}
        <div className="space-y-1 p-2">
          <p className="line-clamp-2 font-medium">{p.title}</p>
          <p className="text-xs text-slate-500">
            {channelName}
            {p.isTest && " · test"}
          </p>
          <p className="text-xs text-slate-600">
            {p.longCount} lang · {p.shortCount} {p.shortCount === 1 ? "Short" : "Shorts"} · {euros(p.costCents)}
          </p>
          {p.toReview > 0 && <p className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">{p.toReview} te keuren</p>}
          {p.blocked.length > 0 && (
            <p className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800" title={p.blocked.join("\n")}>
              Geblokkeerd: {p.blocked[0]}
              {p.blocked.length > 1 ? ` (+${p.blocked.length - 1})` : ""}
            </p>
          )}
          {p.sentBack && <p className="text-xs text-amber-800">Teruggestuurd: {p.sentBack}</p>}
        </div>
      </button>
    </li>
  );
}

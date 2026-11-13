"use client";
// Data for the top bar and the tabs "Klaar voor YouTube" and "Live" (fase 1.1-1.3): the board plus the publications,
// refreshed every 8 seconds. The state only changes when the data really changed, so nothing re-renders (or jumps) for
// a poll that brought nothing new.
import { useCallback, useEffect, useRef, useState } from "react";
import { FORMATS } from "./studio";
import { loadBoard, type BoardState } from "./boardData";
import { buildFlow, type FlowItem, type FlowPublication } from "./flow";
import { loadPublications } from "./publicationData";
import { pageVisible } from "../visible";

type Ready = Extract<BoardState, { ready: true }>;
export type FlowState = { board: Ready; items: FlowItem[]; publications: FlowPublication[] } | { error: string } | null;

export function useFlow(studioId: string, enabled: boolean) {
  const [state, setState] = useState<FlowState>(null);
  const last = useRef("");
  const refresh = useCallback(async () => {
    try {
      const [board, pubs] = await Promise.all([loadBoard(studioId), loadPublications(studioId).catch(() => "migration" as const)]);
      if (!board.ready) {
        const next = { error: board.reason === "migration" ? "De database is nog niet helemaal ingericht." : (board.message ?? "Laden lukte niet.") };
        const key = JSON.stringify(next);
        if (key !== last.current) (last.current = key), setState(next);
        return;
      }
      const publications: FlowPublication[] = pubs === "migration" ? [] : pubs;
      const titleOf = (v: { id: string; format: string; promise?: string | null }) => {
        const s = board.scripts.find((x) => x.video_id === v.id && x.status !== "rejected");
        return (s?.titles?.[0] as string | undefined) ?? s?.top_line ?? v.promise ?? FORMATS.find((f) => f.key === v.format)?.name ?? "Video";
      };
      const items = buildFlow(board.input.videos, board.input.scripts, publications, titleOf);
      const key = JSON.stringify([items, board, publications]);
      if (key === last.current) return;
      last.current = key;
      setState({ board, items, publications });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : "Laden lukte niet." });
    }
  }, [studioId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => pageVisible() && void refresh(), 8000);
    return () => clearInterval(t);
  }, [refresh, enabled]);

  return { state, refresh };
}

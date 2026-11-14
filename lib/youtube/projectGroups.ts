// "Klaar voor YouTube" per project: the cards of one recording together, so the parts of a long story (Deel 1..N) and
// the Shorts from the same gameplay stand side by side. Groups are ordered by their newest video (the list keeps the
// "order = creation time" rule); inside a group the parts come first in their own order. Pure, tested.
import { parseSeriesKey } from "./analysis.ts";

type Item = { videoId: string; kind: "short" | "long"; createdAt: string };
type Video = { id: string; recording_id: string | null; plan_key?: string | null };
type Recording = { id: string; label: string };

export type ProjectGroup<T extends Item> = { key: string; label: string; recordingId: string | null; items: T[]; longs: number; shorts: number; parts: number | null };

export function groupByProject<T extends Item>(items: T[], videos: Video[], recordings: Recording[]): ProjectGroup<T>[] {
  const videoOf = new Map(videos.map((v) => [v.id, v]));
  const labelOf = new Map(recordings.map((r) => [r.id, r.label]));
  const groups = new Map<string, ProjectGroup<T>>();
  for (const item of items) {
    const rec = videoOf.get(item.videoId)?.recording_id ?? null;
    const key = rec && labelOf.has(rec) ? `r:${rec}` : "none";
    if (!groups.has(key)) groups.set(key, { key, label: rec && labelOf.has(rec) ? labelOf.get(rec)! : "Zonder opname", recordingId: key === "none" ? null : rec, items: [], longs: 0, shorts: 0, parts: null });
    const g = groups.get(key)!;
    g.items.push(item);
    if (item.kind === "long") g.longs++;
    else g.shorts++;
  }
  const part = (i: Item) => parseSeriesKey(videoOf.get(i.videoId)?.plan_key);
  for (const g of groups.values()) {
    g.items.sort((a, b) => {
      const pa = part(a);
      const pb = part(b);
      if (pa && pb) return pa.index - pb.index;
      if (pa || pb) return pa ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    const counts = g.items.map(part).filter((p) => p !== null);
    g.parts = counts.length ? counts[0]!.count : null;
  }
  const newest = (g: ProjectGroup<T>) => g.items.reduce((m, i) => (i.createdAt > m ? i.createdAt : m), "");
  return [...groups.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : newest(b).localeCompare(newest(a))));
}

/** "2 lange video's (Deel 1-5) · 3 Shorts" */
export function groupMeta(g: Pick<ProjectGroup<Item>, "longs" | "shorts" | "parts" | "items">): string {
  const bits: string[] = [];
  if (g.longs) bits.push(`${g.longs} ${g.longs === 1 ? "lange video" : "lange video's"}${g.parts ? ` van ${g.parts} delen` : ""}`);
  if (g.shorts) bits.push(`${g.shorts} ${g.shorts === 1 ? "Short" : "Shorts"}`);
  return bits.join(" · ");
}

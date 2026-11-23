// 23-11-2026 (superprompt V5 fase 19): the real facts for the publication check: video status, the export on the pc,
// the music of this version and its licence (from the music library on the pc), and the viral score of the version.

import { supabase } from "../supabase";
import { WORKER_URL } from "./protocol";
import type { PublishFacts } from "./publishCheck";

type Track = { file: string; license?: string; test?: boolean; credit?: string };

export async function loadPublishFacts(videoId: string, renderId: string | null, renderFile: string | null, workerOnline: boolean): Promise<Pick<PublishFacts, "videoStatus" | "exportOk" | "music" | "viralStatus">> {
  const [video, render] = await Promise.all([
    supabase.from("yt_videos").select("status").eq("id", videoId).maybeSingle<{ status: string }>(),
    renderId ? supabase.from("yt_renders").select("qc").eq("id", renderId).maybeSingle<{ qc: { audio?: { musicFiles?: string[] } | null; viral?: { status?: string } | null } | null }>() : Promise.resolve({ data: null }),
  ]);
  let exportOk: boolean | null = null;
  let library: Track[] = [];
  if (workerOnline) {
    if (renderFile) exportOk = await fetch(`${WORKER_URL}/renders/${encodeURIComponent(renderFile)}`, { method: "HEAD" }).then((r) => r.ok).catch(() => null);
    library = await fetch(`${WORKER_URL}/music`).then((r) => (r.ok ? (r.json() as Promise<Track[]>) : [])).catch(() => []);
  }
  const files = [...new Set(render.data?.qc?.audio?.musicFiles ?? [])];
  const music = files.map((file) => {
    const t = library.find((x) => x.file === file);
    // Without the worker the licence cannot be checked: it then counts as not on record (it blocks, never passes unseen).
    return { file, licensed: !!t && !!t.license?.trim() && !t.test, credit: t?.credit ?? "" };
  });
  return { videoStatus: video.data?.status ?? null, exportOk, music, viralStatus: render.data?.qc?.viral?.status ?? null };
}

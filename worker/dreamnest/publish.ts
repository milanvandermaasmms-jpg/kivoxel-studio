// Dreamnest fase 5: publish one video (the long episode or a Short) to the Dreamnest YouTube channel.
// Only after Milan's click (a dn_publications row in 'queued' plus a dn_publish step). Before a single byte goes out the
// worker asks YouTube which channel the sign-in writes to and compares it with the linked channel (megaprompt §2.4).
// Always private: either scheduled (YouTube makes it public at that moment) or private until Milan changes it himself.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DN_FIXED, PLAYLIST, publishProblem } from "../../lib/dreamnest/package.ts";
import type { YouTube } from "../youtube.ts";
import type { Uploader } from "../youtubeUpload.ts";
import type { DnHandler } from "./lane.ts";

export type Publication = {
  id: string;
  episode_id: string;
  channel_id: string;
  kind: "long" | "short";
  file: string;
  thumbnail: string | null;
  title: string;
  description: string;
  tags: string[];
  publish_at: string | null;
  status: string;
  youtube_video_id: string | null;
};

export function createDnPublish(o: {
  db: SupabaseClient;
  dataDir: string;
  youtubeFor: (channelRowId: string) => Promise<YouTube>;
  makeUploader: (yt: YouTube) => Pick<Uploader, "upload" | "setThumbnail" | "addToPlaylist">;
  log: (msg: string) => void;
  now?: () => number;
}): DnHandler {
  const base = join(o.dataDir, "dreamnest");
  return async (job) => {
    const id = String((job.payload as { publication_id?: unknown } | null)?.publication_id ?? "");
    const { data: pub, error } = await o.db.from("dn_publications").select("*").eq("id", id).eq("studio_id", job.studio_id).single<Publication>();
    if (error || !pub) throw new Error(`Publicatie niet gevonden: ${error?.message ?? id}`);
    const set = (fields: Record<string, unknown>) => o.db.from("dn_publications").update(fields).eq("id", pub.id).then(({ error: e }) => {
      if (e) o.log(`Dreamnest publiceren: kon de status niet bewaren: ${e.message}`);
    });
    if (pub.youtube_video_id) return { video_id: pub.youtube_video_id, already: true }; // never a second upload
    if (pub.status !== "queued" && pub.status !== "uploading") throw new Error("Deze publicatie staat niet klaar (eerst Klaarzetten in de Studio)");

    try {
      // 1. The right channel: linked in the Studio, and YouTube itself says the sign-in writes there.
      const ch = await o.db.from("yt_channels").select("name, youtube_channel_id").eq("id", pub.channel_id).single<{ name: string; youtube_channel_id: string | null }>();
      if (ch.error || !ch.data) throw new Error(`Kanaal niet gevonden: ${ch.error?.message ?? pub.channel_id}`);
      const qc = pub.kind === "long" ? await qcOk(pub) : true;
      const problem = publishProblem({ kind: pub.kind, title: pub.title, description: pub.description, tags: pub.tags, publishAt: pub.publish_at, qcOk: qc, channelLinked: !!ch.data.youtube_channel_id }, (o.now ?? Date.now)());
      if (problem) throw new Error(problem);
      const yt = await o.youtubeFor(pub.channel_id);
      const live = await yt.myChannel();
      if (live.id !== ch.data.youtube_channel_id) throw new Error(`De koppeling op deze pc schrijft naar "${live.title}" (${live.id}), niet naar ${ch.data.name}. Niets geüpload.`);
      const file = join(base, ...pub.file.split("/"));
      if (!existsSync(file)) throw new Error("De video staat niet (meer) op de pc. Maak de verpakking of montage opnieuw.");

      // 2. Upload (resumable; an unfinished upload continues where it stopped).
      await set({ status: "uploading", error: null, progress: 0 });
      o.log(`Dreamnest: uploaden naar ${live.title}: ${pub.title}`);
      const up = o.makeUploader(yt);
      let last = 0;
      const result = await up.upload({
        key: `dn-${pub.id}`,
        file,
        meta: { title: pub.title, description: pub.description, tags: pub.tags, ...DN_FIXED, visibility: "private", publish_at: pub.publish_at },
        signal: new AbortController().signal,
        onProgress: (sent, total) => {
          const pct = total ? Math.floor((sent / total) * 100) : 0;
          if (pct - last >= 5 || pct === 100) {
            last = pct;
            void set({ progress: pct });
          }
        },
        onEvent: (m) => o.log(`Dreamnest publiceren: ${m}`),
      });
      await set({ youtube_video_id: result.videoId, youtube_channel_id: live.id, progress: 100 });

      // 3. Thumbnail and playlist: a problem here does not undo the upload; it is shown in the Studio.
      const notes: string[] = [];
      if (pub.thumbnail) {
        try {
          await up.setThumbnail(result.videoId, await readFile(join(base, ...pub.thumbnail.split("/"))));
        } catch (e) {
          notes.push(`Thumbnail: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      try {
        await up.addToPlaylist(result.videoId, PLAYLIST, "Calm sleep videos with Lumi van Dreamnest: soft lullabies, gentle stories and slowly dimming pictures.");
      } catch (e) {
        notes.push(`Afspeellijst: ${e instanceof Error ? e.message : String(e)}`);
      }
      await set({ status: pub.publish_at ? "scheduled" : "uploaded", error: notes.length ? notes.join(" · ").slice(0, 500) : null });
      return { video_id: result.videoId, channel: live.title, scheduled: pub.publish_at, notes };
    } catch (e) {
      await set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
      throw e;
    }
  };

  async function qcOk(pub: Publication): Promise<boolean> {
    const { data } = await o.db.from("dn_render_jobs").select("result").eq("episode_id", pub.episode_id).eq("step", "dn_render").eq("status", "done").order("created_at", { ascending: false }).limit(1).maybeSingle<{ result: { qc_ok?: boolean } | null }>();
    return data?.result?.qc_ok === true;
  }
}

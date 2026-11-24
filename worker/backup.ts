// 24-11-2026 (opdracht 6): weekly backup of the studio database, without any key in Git. The worker already has its
// own key in worker/.env.local; it exports every table as gzipped JSON to the backup folder (<data>/backups or KIVOXEL_BACKUP_DIR
// on this pc), keeps the last 8 weeks and writes a manifest with row counts. The
// structure itself is in supabase/migrations (in Git); restoring = migrations first, then these rows (docs/backup.md).
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Every table of the studio (supabase/migrations), parents before children so a restore can follow this order. */
export const BACKUP_TABLES = [
  "studios", "studio_members", "studio_tile_tokens", "studio_preferences", "studio_events",
  "yt_settings", "yt_channels", "yt_recordings", "yt_moments", "yt_videos", "yt_video_moments", "yt_scripts", "yt_renders",
  "yt_publications", "yt_jobs", "yt_job_events", "yt_costs", "yt_viral_checks", "yt_reference_videos",
  "yt_channel_snapshots", "yt_video_snapshots", "yt_manual_metrics",
  "ivar_conversations", "ivar_messages", "ivar_memory", "ivar_ideas", "ivar_revisions", "ivar_actions", "ivar_insights",
  "dn_episodes", "dn_render_jobs", "dn_publications",
] as const;
export const KEEP_WEEKS = 8;
const WEEK_MS = 7 * 24 * 3_600_000;

/** Folder names are dates (2026-11-24); the oldest beyond `keep` go. Pure, tested. */
export function toPrune(folders: string[], keep = KEEP_WEEKS): string[] {
  const dated = folders.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  return dated.slice(0, Math.max(0, dated.length - keep));
}
/** Is a new backup due? `last` = the newest folder name, or null. Pure, tested. */
export function backupDue(last: string | null, now = new Date()): boolean {
  if (!last) return true;
  return now.getTime() - Date.parse(`${last}T00:00:00Z`) >= WEEK_MS - 3_600_000;
}

export function backupDir(dataDir: string, env: Record<string, string | undefined> = process.env): string {
  // 24-11-2026: not on the external drive by default: during the copy it dropped out three times and Windows asks for a
  // full repair (chkdsk). The database export is small; it stays on the pc unless KIVOXEL_BACKUP_DIR says otherwise.
  return env.KIVOXEL_BACKUP_DIR || join(dataDir, "backups");
}

export function createBackup(o: { db: SupabaseClient; dir: string; log: (m: string) => void }) {
  let running = false;
  async function latest(): Promise<string | null> {
    if (!existsSync(o.dir)) return null;
    const dated = (await readdir(o.dir)).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
    return dated[dated.length - 1] ?? null;
  }
  async function run(now = new Date()): Promise<{ folder: string; tables: Record<string, number>; errors: string[] }> {
    const day = now.toISOString().slice(0, 10);
    const folder = join(o.dir, day);
    await mkdir(folder, { recursive: true });
    const tables: Record<string, number> = {};
    const errors: string[] = [];
    for (const t of BACKUP_TABLES) {
      const rows: unknown[] = [];
      try {
        for (let from = 0; ; from += 1000) {
          const r = await o.db.from(t).select("*").range(from, from + 999);
          if (r.error) throw new Error(r.error.message);
          rows.push(...(r.data ?? []));
          if ((r.data ?? []).length < 1000) break;
        }
        await writeFile(join(folder, `${t}.json.gz`), gzipSync(JSON.stringify(rows)));
        tables[t] = rows.length;
      } catch (e) {
        // A table that does not exist yet (migration not run) is no failure of the backup.
        errors.push(`${t}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
    await writeFile(join(folder, "manifest.json"), JSON.stringify({ at: now.toISOString(), tables, errors, restore: "docs/backup.md" }, null, 1));
    for (const old of toPrune(await readdir(o.dir))) await rm(join(o.dir, old), { recursive: true, force: true });
    o.log(`Back-up gemaakt in ${folder}: ${Object.values(tables).reduce((a, b) => a + b, 0)} rijen uit ${Object.keys(tables).length} tabellen${errors.length ? `, ${errors.length} niet (zie manifest)` : ""}`);
    return { folder, tables, errors };
  }
  return {
    run,
    latest,
    /** Called every few hours: makes the weekly backup when it is due. */
    async tick() {
      if (running) return;
      running = true;
      try {
        if (backupDue(await latest())) await run();
      } catch (e) {
        o.log(`Back-up mislukt: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
      }
    },
  };
}

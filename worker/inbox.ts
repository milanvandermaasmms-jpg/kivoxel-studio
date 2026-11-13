// Inbox folder (KIVOXEL Studio fase 2): Milan drops a recording in KIVOXEL\inbox and the studio takes it from there.
// The worker looks every few seconds. A file is only taken once it has stopped growing (copying a big file takes
// minutes), then it moves into the recordings folder and gets the same intake as an upload from the web page.
// Duplicates go to inbox\_dubbel, files that fail go to inbox\_fout with a short note next to them.
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { CompleteResult, InboxStatus, LocalRecording } from "../lib/youtube/protocol.ts";
import { videoExtension } from "../lib/youtube/protocol.ts";
import { moveFile } from "./store.ts";

type Seen = { size: number; mtimeMs: number; stableSince: number | null };

export type InboxDeps = {
  dir: string;
  importFile: (path: string, label: string) => Promise<CompleteResult>;
  /** Queue mode: put the recording in Supabase with an intake step. Local mode: run the intake right away. */
  register: (recording: LocalRecording) => Promise<void>;
  log: (msg: string) => void;
  now?: () => number;
  /** How long a file must stay the same size before it is taken (default 20 s). */
  settleMs?: number;
};

/** Files the inbox ignores: hidden, our own sub-folders, and half-finished downloads or copies. */
export function ignoredName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_") || /\.(part|tmp|crdownload|partial|download)$/i.test(name) || name.toLowerCase() === "desktop.ini";
}

/** "13-11 minecraft grot.mp4" -> "13-11 minecraft grot". */
export function labelFromName(name: string): string {
  return name.slice(0, name.length - extname(name).length).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || "Opname";
}

/** A file is ready once size and modification time stayed the same for `settleMs`. */
export function settle(previous: Seen | undefined, size: number, mtimeMs: number, now: number, settleMs: number): { seen: Seen; ready: boolean } {
  if (!previous || previous.size !== size || previous.mtimeMs !== mtimeMs) return { seen: { size, mtimeMs, stableSince: now }, ready: false };
  const stableSince = previous.stableSince ?? now;
  return { seen: { size, mtimeMs, stableSince }, ready: size > 0 && now - stableSince >= settleMs };
}

export function createInbox(deps: InboxDeps) {
  const now = deps.now ?? Date.now;
  const settleMs = deps.settleMs ?? 20_000;
  const seen = new Map<string, Seen>();
  /** Taken into the store but not yet registered (for example while the internet was gone). */
  const unregistered = new Map<string, LocalRecording>();
  const status: InboxStatus = { dir: deps.dir, waiting: 0, imported: 0, last: null, errors: [] };
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const fail = async (name: string, message: string) => {
    status.errors = [{ file: name, message, at: new Date(now()).toISOString() }, ...status.errors].slice(0, 10);
    deps.log(`Inbox: ${name} niet gelukt: ${message}`);
    const errorDir = join(deps.dir, "_fout");
    await mkdir(errorDir, { recursive: true });
    await moveFile(join(deps.dir, name), join(errorDir, name)).catch(() => undefined);
    await writeFile(join(errorDir, `${name}.fout.txt`), `${message}\r\n`).catch(() => undefined);
  };

  async function registerPending() {
    for (const [fp, recording] of unregistered) {
      try {
        await deps.register(recording);
        unregistered.delete(fp);
      } catch (e) {
        deps.log(`Inbox: ${recording.label} nog niet aangemeld (${e instanceof Error ? e.message : "onbekend"}); volgende ronde opnieuw`);
        return;
      }
    }
  }

  /** One round: look at the folder, take what is ready. Never runs twice at the same time. */
  async function scan(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await mkdir(deps.dir, { recursive: true });
      await registerPending();
      const entries = await readdir(deps.dir, { withFileTypes: true });
      const present = new Set<string>();
      let waiting = 0;
      for (const entry of entries) {
        if (!entry.isFile() || ignoredName(entry.name)) continue;
        present.add(entry.name);
        if (!videoExtension(entry.name)) {
          await fail(entry.name, "Geen videobestand (alleen mp4, webm, mkv of mov)");
          continue;
        }
        const info = await stat(join(deps.dir, entry.name)).catch(() => null);
        if (!info) continue;
        const { seen: next, ready } = settle(seen.get(entry.name), info.size, info.mtimeMs, now(), settleMs);
        seen.set(entry.name, next);
        if (!ready) {
          waiting++;
          continue;
        }
        seen.delete(entry.name);
        const label = labelFromName(entry.name);
        try {
          const { recording, duplicateOf } = await deps.importFile(join(deps.dir, entry.name), label);
          if (duplicateOf) {
            const dupDir = join(deps.dir, "_dubbel");
            await mkdir(dupDir, { recursive: true });
            await moveFile(join(deps.dir, entry.name), join(dupDir, entry.name));
            deps.log(`Inbox: ${entry.name} staat er al (als "${duplicateOf.label}"); verplaatst naar _dubbel`);
          } else {
            status.imported++;
            deps.log(`Inbox: ${entry.name} overgenomen als "${recording.label}"`);
            unregistered.set(recording.fingerprint, recording);
            await registerPending();
          }
          status.last = { label: recording.label, at: new Date(now()).toISOString(), duplicate: !!duplicateOf };
        } catch (e) {
          // EBUSY/EPERM: still open in another program (Windows). Try again next round instead of giving up.
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
            waiting++;
            continue;
          }
          await fail(entry.name, e instanceof Error ? e.message.slice(0, 300) : "Onbekende fout");
        }
      }
      for (const name of seen.keys()) if (!present.has(name)) seen.delete(name);
      status.waiting = waiting;
    } catch (e) {
      deps.log(`Inbox: map niet te lezen (${e instanceof Error ? e.message : "onbekend"})`);
    } finally {
      busy = false;
    }
  }

  return {
    scan,
    status: (): InboxStatus => ({ ...status, errors: [...status.errors] }),
    start(intervalMs = 5_000) {
      if (timer) return;
      void scan();
      timer = setInterval(() => void scan(), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

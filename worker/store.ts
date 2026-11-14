// Recordings on Milan's pc: resumable uploads, duplicate detection and the local list.
// Raw recordings never leave this pc; Supabase only gets the facts about the file.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { computeFingerprint } from "../lib/youtube/fingerprint.ts";

/**
 * A Blob-like view on a file that reads at real file positions. fs.openAsBlob read the wrong bytes beyond 4 GB
 * (found 14-11-2026 with a 4.8 GB recording: every upload above 4 GB was refused as damaged).
 */
export async function diskBlob(path: string): Promise<Blob> {
  const size = (await stat(path)).size;
  const slice = (start: number, end: number) => ({
    async arrayBuffer() {
      const fh = await open(path, "r");
      try {
        const buf = Buffer.alloc(Math.max(0, end - start));
        let done = 0;
        while (done < buf.length) {
          const { bytesRead } = await fh.read(buf, done, buf.length - done, start + done);
          if (!bytesRead) break;
          done += bytesRead;
        }
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + done) as ArrayBuffer;
      } finally {
        await fh.close();
      }
    },
  });
  return { size, slice } as unknown as Blob;
}
import {
  isFingerprint,
  MAX_CHUNK_SIZE,
  MAX_RECORDING_SIZE,
  videoExtension,
  type CompleteResult,
  type LocalRecording,
  type ProbeInfo,
  type UploadStart,
  type UploadState,
} from "../lib/youtube/protocol.ts";

/** An error with a message for the dashboard and an HTTP status. */
export class StoreError extends Error {
  status: number;
  received?: number;
  constructor(status: number, message: string, received?: number) {
    super(message);
    this.status = status;
    this.received = received;
  }
}

type Pending = UploadStart & { startedAt: string };

export type Store = ReturnType<typeof createStore>;

export function createStore(dataDir: string, probeFile: (file: string) => Promise<ProbeInfo>) {
  const incoming = join(dataDir, "incoming");
  const recordingsDir = join(dataDir, "recordings");
  const indexFile = join(dataDir, "recordings.json");
  const locks = new Map<string, Promise<unknown>>();

  /** One action per recording at a time, so two tabs cannot write through each other. */
  function locked<T>(fingerprint: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(fingerprint) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    locks.set(fingerprint, next);
    void next.finally(() => locks.get(fingerprint) === next && locks.delete(fingerprint)).catch(() => undefined);
    return next;
  }

  const partFile = (fp: string) => join(incoming, `${fp}.part`);
  const pendingFile = (fp: string) => join(incoming, `${fp}.json`);
  const sizeOf = async (file: string) => (await stat(file).catch(() => null))?.size ?? null;

  async function readIndex(): Promise<LocalRecording[]> {
    try {
      return JSON.parse(await readFile(indexFile, "utf8")) as LocalRecording[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async function writeIndex(list: LocalRecording[]) {
    const tmp = `${indexFile}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, indexFile);
  }
  async function readPending(fp: string): Promise<Pending> {
    try {
      return JSON.parse(await readFile(pendingFile(fp), "utf8")) as Pending;
    } catch {
      throw new StoreError(404, "Deze upload is niet gestart of al afgerond. Kies het bestand opnieuw.");
    }
  }

  async function init() {
    await mkdir(incoming, { recursive: true });
    await mkdir(recordingsDir, { recursive: true });
  }

  function validate(input: UploadStart) {
    if (!isFingerprint(input.fingerprint)) throw new StoreError(400, "Ongeldige vingerafdruk");
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_RECORDING_SIZE) throw new StoreError(400, "Ongeldige bestandsgrootte");
    if (!videoExtension(input.name)) throw new StoreError(400, "Alleen videobestanden (mp4, webm, mkv of mov)");
    const label = input.label?.trim();
    if (!label || label.length > 200) throw new StoreError(400, "Geef de opname een naam (maximaal 200 tekens)");
  }

  async function start(input: UploadStart): Promise<UploadState> {
    validate(input);
    return locked(input.fingerprint, async () => {
      const existing = (await readIndex()).find((r) => r.fingerprint === input.fingerprint);
      if (existing) return { state: "complete", received: existing.size, recording: existing };
      const received = await sizeOf(partFile(input.fingerprint));
      if (received !== null && (await sizeOf(pendingFile(input.fingerprint))) !== null) {
        const pending = await readPending(input.fingerprint);
        if (pending.size !== input.size) throw new StoreError(409, "Er loopt al een upload met deze vingerafdruk maar een andere grootte");
        return { state: received > 0 ? "partial" : "new", received };
      }
      const pending: Pending = { ...input, label: input.label.trim(), name: input.name.trim(), startedAt: new Date().toISOString() };
      await writeFile(pendingFile(input.fingerprint), JSON.stringify(pending, null, 2));
      await writeFile(partFile(input.fingerprint), "");
      return { state: "new", received: 0 };
    });
  }

  /** Appends one piece at `offset`. A broken connection keeps what arrived; the next attempt continues from there. */
  async function append(fp: string, offset: number, length: number, body: Readable | AsyncIterable<Uint8Array>): Promise<number> {
    if (!isFingerprint(fp)) throw new StoreError(400, "Ongeldige vingerafdruk");
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_CHUNK_SIZE) throw new StoreError(400, "Ongeldige stukgrootte");
    return locked(fp, async () => {
      const pending = await readPending(fp);
      const received = (await sizeOf(partFile(fp))) ?? 0;
      if (offset !== received) throw new StoreError(409, "Verkeerde positie; ga verder vanaf wat er al is", received);
      if (offset + length > pending.size) throw new StoreError(400, "Dit stuk valt buiten het bestand");
      let counted = 0;
      const guard = new Transform({
        transform(chunk: Buffer, _enc, done) {
          counted += chunk.length;
          if (counted > length) done(new StoreError(400, "Stuk is groter dan opgegeven"));
          else done(null, chunk);
        },
      });
      try {
        await pipeline(body, guard, createWriteStream(partFile(fp), { flags: "a" }));
      } catch (e) {
        // Keep what was written (resume continues from there), unless the piece was too large.
        if (e instanceof StoreError) await truncateTo(fp, received);
        throw e;
      }
      return (await sizeOf(partFile(fp))) ?? 0;
    });
  }

  async function truncateTo(fp: string, size: number) {
    await truncate(partFile(fp), size);
  }

  async function sha256Of(file: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(createReadStream(file, { highWaterMark: 4 * 1024 * 1024 }), hash);
    return hash.digest("hex");
  }

  /** All pieces are there: check the fingerprint, compute the full SHA-256 and recognise duplicates. */
  async function complete(fp: string): Promise<CompleteResult> {
    if (!isFingerprint(fp)) throw new StoreError(400, "Ongeldige vingerafdruk");
    return locked(fp, async () => {
      const index = await readIndex();
      const done = index.find((r) => r.fingerprint === fp);
      if (done) return { recording: done, duplicateOf: done };
      const pending = await readPending(fp);
      const part = partFile(fp);
      const received = (await sizeOf(part)) ?? 0;
      if (received !== pending.size) throw new StoreError(409, "Nog niet alles is ontvangen", received);

      if ((await computeFingerprint(await diskBlob(part))) !== fp) {
        await rm(part, { force: true });
        await rm(pendingFile(fp), { force: true });
        throw new StoreError(422, "Het bestand kwam beschadigd aan. Upload het opnieuw.");
      }
      const sha256 = await sha256Of(part);
      const same = index.find((r) => r.sha256 === sha256);
      if (same) {
        await rm(part, { force: true });
        await rm(pendingFile(fp), { force: true });
        return { recording: same, duplicateOf: same };
      }

      const file = `${fp}.${videoExtension(pending.name)}`;
      await rename(part, join(recordingsDir, file));
      const recording: LocalRecording = {
        fingerprint: fp,
        sha256,
        label: pending.label,
        originalName: pending.name,
        size: pending.size,
        isTest: pending.isTest === true,
        file,
        receivedAt: new Date().toISOString(),
        probe: null,
        intakeError: null,
      };
      await writeIndex([...index, recording]);
      await rm(pendingFile(fp), { force: true });
      return { recording, duplicateOf: null };
    });
  }

  /**
   * Inbox (fase 2): take over a file that Milan put in the inbox folder. The file is moved (not copied) into the
   * recordings folder, so a recording of many GB never takes double space. A duplicate stays where it is.
   */
  async function importFile(source: string, label: string): Promise<CompleteResult> {
    const name = basename(source);
    const ext = videoExtension(name);
    if (!ext) throw new StoreError(400, "Alleen videobestanden (mp4, webm, mkv of mov)");
    const cleanLabel = label.trim().slice(0, 200) || "Opname";
    const size = (await stat(source)).size;
    if (size <= 0 || size > MAX_RECORDING_SIZE) throw new StoreError(400, "Ongeldige bestandsgrootte");
    const fp = await computeFingerprint(await diskBlob(source));
    return locked(fp, async () => {
      const index = await readIndex();
      const done = index.find((r) => r.fingerprint === fp);
      if (done) return { recording: done, duplicateOf: done };
      const sha256 = await sha256Of(source);
      const same = index.find((r) => r.sha256 === sha256);
      if (same) return { recording: same, duplicateOf: same };
      const file = `${fp}.${ext}`;
      await moveFile(source, join(recordingsDir, file));
      const recording: LocalRecording = { fingerprint: fp, sha256, label: cleanLabel, originalName: name, size, isTest: false, file, receivedAt: new Date().toISOString(), probe: null, intakeError: null };
      await writeIndex([...index, recording]);
      return { recording, duplicateOf: null };
    });
  }

  /** Intake step: read length, picture size and codecs with ffprobe. */
  async function intake(fp: string): Promise<LocalRecording> {
    return locked(fp, async () => {
      const index = await readIndex();
      const recording = index.find((r) => r.fingerprint === fp);
      if (!recording) throw new StoreError(404, "Deze opname staat niet op deze pc");
      try {
        recording.probe = await probeFile(join(recordingsDir, recording.file));
        recording.intakeError = null;
      } catch (e) {
        recording.intakeError = e instanceof Error ? e.message.slice(0, 300) : "Onbekende fout";
      }
      await writeIndex(index);
      return recording;
    });
  }

  const list = async () => (await readIndex()).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const get = async (fp: string) => (await readIndex()).find((r) => r.fingerprint === fp) ?? null;

  return { init, start, append, complete, importFile, intake, list, get, recordingsDir };
}

/** Rename when possible; across drives (EXDEV) copy and then remove the original. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyFile(from, `${to}.tmp`);
    await rename(`${to}.tmp`, to);
    await rm(from, { force: true });
  }
}

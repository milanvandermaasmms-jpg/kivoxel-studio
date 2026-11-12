// Browser side of the hand-over to the worker on the pc: health, list and resumable upload.
import { computeFingerprint } from "./fingerprint";
import { nextChunk, videoExtension, WORKER_URL, type CompleteResult, type LocalRecording, type UploadState, type WorkerHealth } from "./protocol";

export class WorkerError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, { ...init, cache: "no-store" });
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    throw new WorkerError("De werker op de pc is niet bereikbaar. Staat hij aan?");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; received?: number };
  if (!res.ok) throw Object.assign(new WorkerError(body.error ?? `Werker gaf fout ${res.status}`), { status: res.status, received: body.received });
  return body;
}

export async function workerHealth(): Promise<WorkerHealth | null> {
  try {
    return await call<WorkerHealth>("/health", { signal: AbortSignal.timeout(3000) });
  } catch {
    return null;
  }
}

export const listLocalRecordings = () => call<LocalRecording[]>("/recordings");

/** YouTube connection (fase D1). The worker signs in with Google; the tokens never reach the browser. */
export type YouTubeStatus = { configured: boolean; connected: boolean; channelId: string | null; consentedAt: string | null; scopes: string[]; quota: { day: string; units: number; uploads: number; limitUnits: number; limitUploads: number } };
export const youtubeStatus = () => call<YouTubeStatus>("/youtube/status", { signal: AbortSignal.timeout(5000) });
const postJson = (path: string, body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) satisfies RequestInit;
export const startYouTubeConnect = (channelId: string) => call<{ url: string }>("/youtube/connect", postJson("/youtube/connect", { channelId }));
/** Fase E: fetch the statistics now (counts and analytics). */
export const refreshStats = async () => (await call<{ message: string | null }>("/youtube/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).message;
export const disconnectYouTube = (channelId: string) => call<{ ok: true }>("/youtube/disconnect", postJson("/youtube/disconnect", { channelId }));

export type UploadPhase = "fingerprint" | "checking" | "uploading" | "verifying";
export type UploadOutcome = { kind: "done" | "duplicate"; fingerprint: string; recording: LocalRecording };

type Options = {
  label: string;
  isTest: boolean;
  signal: AbortSignal;
  onProgress: (phase: UploadPhase, received: number, total: number) => void;
  /** Extra check in the database (also catches a recording that was received on another pc). */
  isKnown?: (fingerprint: string) => Promise<boolean>;
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * Sends a recording to the worker in pieces of 8 MB. After a pause, a closed tab or a broken
 * connection, choosing the same file again continues where it stopped.
 */
export async function uploadRecording(file: File, { label, isTest, signal, onProgress, isKnown }: Options): Promise<UploadOutcome> {
  if (!videoExtension(file.name)) throw new WorkerError("Kies een videobestand (mp4, webm, mkv of mov).");
  onProgress("fingerprint", 0, file.size);
  const fingerprint = await computeFingerprint(file);
  signal.throwIfAborted();

  onProgress("checking", 0, file.size);
  if (isKnown && (await isKnown(fingerprint))) {
    const existing = (await listLocalRecordings()).find((r) => r.fingerprint === fingerprint);
    if (existing) return { kind: "duplicate", fingerprint, recording: existing };
    throw new WorkerError("Deze opname staat al in YouTube Studio, maar niet op deze pc.");
  }
  const begin = () =>
    call<UploadState>("/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, size: file.size, name: file.name, label, isTest }),
      signal,
    });
  let state = await begin();
  if (state.state === "complete") return { kind: "duplicate", fingerprint, recording: state.recording };

  let received = state.received;
  let failures = 0;
  for (let piece = nextChunk(received, file.size); piece; piece = nextChunk(received, file.size)) {
    onProgress("uploading", received, file.size);
    try {
      const res = await call<{ received: number }>(`/uploads/${fingerprint}?offset=${piece.start}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: file.slice(piece.start, piece.end),
        signal,
      });
      received = res.received;
      failures = 0;
    } catch (e) {
      if (signal.aborted) throw e;
      const status = (e as { status?: number }).status;
      if (status === 409 && typeof (e as { received?: number }).received === "number") {
        received = (e as { received: number }).received;
        continue;
      }
      if (status && status !== 409) throw e;
      // Connection hiccup: wait, ask the worker how much arrived, and continue from there.
      if (++failures > 5) throw e;
      await wait(1000 * failures, signal);
      state = await begin();
      if (state.state === "complete") return { kind: "duplicate", fingerprint, recording: state.recording };
      received = state.received;
    }
  }

  onProgress("verifying", file.size, file.size);
  const done = await call<CompleteResult>(`/uploads/${fingerprint}/complete`, { method: "POST", signal });
  return { kind: done.duplicateOf ? "duplicate" : "done", fingerprint, recording: done.recording };
}

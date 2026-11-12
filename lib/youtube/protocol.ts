// Shared between the dashboard (browser) and the worker on Milan's pc (worker/).
// Plain TypeScript without path aliases, so Node can run it directly.

/** The worker only listens on this pc (127.0.0.1). Port 3000 belongs to RegioActies, 3100 to the family app and 3200 to this studio. */
export const WORKER_PORT = 3210;
export const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;

/** Size of one upload piece. A broken connection loses at most this much. */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** The worker refuses larger pieces. */
export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
/** PS5 recordings are at most a few hours; this guards against mistakes, not against real files. */
export const MAX_RECORDING_SIZE = 200 * 1024 ** 3;

export const VIDEO_EXTENSIONS = ["mp4", "webm", "mkv", "mov"] as const;

export type ProbeInfo = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
};

export type LocalRecording = {
  fingerprint: string;
  sha256: string | null;
  label: string;
  originalName: string;
  size: number;
  isTest: boolean;
  file: string;
  receivedAt: string;
  probe: ProbeInfo | null;
  intakeError: string | null;
};

export type UploadStart = { fingerprint: string; size: number; name: string; label: string; isTest: boolean };

/** new: nothing received yet; partial: continue from `received`; complete: this file is already on the pc. */
export type UploadState = { state: "new" | "partial"; received: number } | { state: "complete"; received: number; recording: LocalRecording };

export type CompleteResult = { recording: LocalRecording; duplicateOf: LocalRecording | null };

export type WorkerHealth = { ok: true; version: string; ffmpeg: string | null; queue: "supabase" | "local"; dataDir: string; analysis?: string | null; voice?: boolean; youtube?: boolean };

export const isFingerprint = (value: string) => /^[0-9a-f]{64}$/.test(value);

/** "Gameplay 1.MP4" -> "mp4"; null when it is not a video type we accept. */
export function videoExtension(name: string): string | null {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

/** The next piece to send, or null when everything is there. */
export function nextChunk(received: number, size: number, chunkSize = CHUNK_SIZE): { start: number; end: number } | null {
  if (received >= size) return null;
  return { start: received, end: Math.min(size, received + chunkSize) };
}

// A fast fingerprint of a (multi-GB) recording: SHA-256 over the size plus the start, middle and end.
// The browser computes it before uploading, so a duplicate is recognised without sending gigabytes.
// The worker computes the same fingerprint on the received file (to check it arrived intact) and also
// the full SHA-256 of the whole file.

export const SAMPLE_SIZE = 4 * 1024 * 1024;
const VERSION = "fmk-v1";

/** Byte ranges [start, end) that go into the fingerprint. Small files are read completely. */
export function sampleRanges(size: number, sample = SAMPLE_SIZE): [number, number][] {
  if (size <= sample * 3) return [[0, size]];
  const mid = Math.floor(size / 2) - Math.floor(sample / 2);
  return [
    [0, sample],
    [mid, mid + sample],
    [size - sample, size],
  ];
}

const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

/** Works on a browser File and on a Node Blob (fs.openAsBlob). */
export async function computeFingerprint(file: Blob, sample = SAMPLE_SIZE): Promise<string> {
  const header = new TextEncoder().encode(`${VERSION}:${file.size}:`);
  const parts = await Promise.all(sampleRanges(file.size, sample).map(([start, end]) => file.slice(start, end).arrayBuffer()));
  const total = header.byteLength + parts.reduce((sum, p) => sum + p.byteLength, 0);
  const bytes = new Uint8Array(total);
  bytes.set(header, 0);
  let offset = header.byteLength;
  for (const part of parts) {
    bytes.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

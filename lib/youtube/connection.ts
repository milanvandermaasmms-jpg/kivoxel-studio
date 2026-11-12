// What the "YouTube-koppeling" block shows (fase D1), as pure logic so it can be tested.
import type { Channel } from "./channels";
import type { WorkerHealth } from "./protocol";

export type ConnectionView =
  | { kind: "migration" }
  | { kind: "worker-off" }
  | { kind: "worker-old" }
  | { kind: "not-configured" }
  | { kind: "other-linked" }
  | { kind: "ready" }
  | { kind: "connected"; reconnectBefore: string; error: string | null; tokensHere: boolean };

/** Google Testing mode: the consent ends 7 days after signing in. */
export const TESTING_DAYS = 7;
export function reconnectBefore(connectedAt: string): string {
  return new Date(Date.parse(connectedAt) + TESTING_DAYS * 86_400_000).toISOString();
}

/**
 * health: undefined while loading, null when the worker does not answer.
 * tokensFor: the YouTube channel ID the worker holds tokens for (from /youtube/status), or null.
 */
export function connectionView(channel: Channel, health: WorkerHealth | null, tokensFor: string | null, anotherLinked: boolean): ConnectionView {
  if (channel.youtube_connected_at === undefined) return { kind: "migration" };
  if (channel.youtube_connected_at) {
    const tokensHere = !!tokensFor && tokensFor === channel.youtube_channel_id;
    return { kind: "connected", reconnectBefore: reconnectBefore(channel.youtube_connected_at), error: channel.youtube_error ?? null, tokensHere };
  }
  if (anotherLinked) return { kind: "other-linked" };
  if (!health) return { kind: "worker-off" };
  if (health.youtube === undefined) return { kind: "worker-old" };
  if (!health.youtube) return { kind: "not-configured" };
  return { kind: "ready" };
}

/** "1 van 10.000 eenheden, 0 van 100 uploads". */
export function quotaText(q: { units: number; uploads: number; limitUnits: number; limitUploads: number }): string {
  const n = (v: number) => v.toLocaleString("nl-NL");
  return `${n(q.units)} van ${n(q.limitUnits)} eenheden, ${n(q.uploads)} van ${n(q.limitUploads)} uploads`;
}

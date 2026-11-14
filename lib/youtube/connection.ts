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

/**
 * Channel check before every upload (Dreamnest fase 0.5): the tokens on the pc must belong to the YouTube channel the
 * video's channel is linked to, so a video can never go to the wrong channel. Returns the reason to stop, or null.
 */
export function uploadChannelProblem(expected: { name: string; youtubeChannelId: string | null; isDefault?: boolean } | null, tokensFor: string | null): string | null {
  if (!expected) return "Bij deze video hoort geen kanaal in de Studio; kies eerst een kanaal.";
  // KIVOXEL (default channel) linked before the Studio stored the channel ID: keep uploading as before, with its own tokens.
  if (!expected.youtubeChannelId && expected.isDefault) return tokensFor ? null : "Er is geen YouTube-koppeling op deze pc. Koppel het kanaal opnieuw.";
  if (!expected.youtubeChannelId) return `Het kanaal ${expected.name} is nog niet aan YouTube gekoppeld (Instellingen > Kanalen).`;
  if (!tokensFor) return "Er is geen YouTube-koppeling op deze pc. Koppel het kanaal opnieuw.";
  if (tokensFor !== expected.youtubeChannelId) return `De YouTube-koppeling op deze pc hoort bij een ander kanaal dan ${expected.name}. Niets geüpload.`;
  return null;
}

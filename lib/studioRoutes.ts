// Fase 0.5: one Studio, one address per channel (/studio/kivoxel, /studio/dreamnest). Pure, tested.
type ChannelLike = { id: string; slug?: string | null; is_default: boolean; safety_profile?: string | null };

export const isDreamnestChannel = (c: ChannelLike) => c.safety_profile === "infant_sleep" || !!c.slug?.startsWith("dreamnest");

/** The address part for a channel: "kivoxel" for the default channel, "dreamnest" for the first Dreamnest channel, else its slug. */
export function routeSlug(c: ChannelLike, all: ChannelLike[]): string | null {
  if (c.is_default) return "kivoxel";
  if (isDreamnestChannel(c) && all.find(isDreamnestChannel)?.id === c.id) return "dreamnest";
  return c.slug ?? null;
}

/** The channel for an address part; an exact slug wins over the short names. */
export function findChannel<C extends ChannelLike>(channels: C[], slug: string): C | null {
  return channels.find((c) => c.slug === slug) ?? channels.find((c) => routeSlug(c, channels) === slug) ?? null;
}

export const isRouteSlug = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 40;

// Standard YouTube texts (Milan, 18-11-2026: "1x bouwen en daarna onbeperkt gebruiken"). Every new publication draft
// starts with a title, a description and tags that cost nothing: built from the script the video already has and a
// fixed channel block, with tags picked from the words of the title. The paid AI suggestions stay optional.
// The channel profile (gameProfile.ts) gives the name, the game and its tags; without one it is KIVOXEL + Minecraft.
// Video content is always English (decision 16-11-2026), so these texts are English too.
import { gameOf, PROFILES, type ChannelProfile, type GameId } from "./gameProfile";
import { TAGS_MAX } from "./publication";

type Ctx = { profile?: ChannelProfile; game?: GameId };
const ctx = (c: Ctx) => {
  const profile = c.profile ?? PROFILES.kivoxel;
  return { profile, game: gameOf(c.game ?? profile.defaultGame) };
};

/** Always on every video of the channel: the game's tags, "gaming" and the channel's own tag. */
export const baseTags = (c: Ctx = {}) => {
  const { profile, game } = ctx(c);
  return [...game.tags, "gaming", profile.tag];
};
/** Always on every KIVOXEL video. */
export const BASE_TAGS = baseTags();

export function standardTags(input: { kind: "short" | "long"; texts: string[] } & Ctx): string[] {
  const { game } = ctx(input);
  const words = input.texts.join(" ");
  const topical = game.topics.filter(([re]) => re.test(words)).flatMap(([, t]) => t);
  const all = [...baseTags(input), ...(input.kind === "short" ? game.shortTags : game.longTags), ...topical];
  const out: string[] = [];
  for (const t of all) {
    if (out.includes(t) || out.length >= 15) continue;
    if ([...out, t].join(",").length > TAGS_MAX) break;
    out.push(t);
  }
  return out;
}

/** The opening line (the hook of the script, or the title), the fixed channel block and 3 hashtags. */
export function standardDescription(input: { kind: "short" | "long"; title: string; hookLine?: string | null } & Ctx): string {
  const { profile, game } = ctx(input);
  const clean = (s: string) => s.replace(/[<>]/g, "").trim();
  const opening = clean(input.hookLine || input.title);
  const hashtags = `${game.hashtag} #gaming ${input.kind === "short" ? "#shorts" : game.longHashtag}`;
  return [opening, profile.block(game, input.kind), hashtags].filter(Boolean).join("\n\n");
}

/** The standard title: the first title the script already wrote (free), else the hook of the script. */
export function standardTitle(input: { scriptTitles?: string[] | null; hookLine?: string | null }): string {
  const t = input.scriptTitles?.find((x) => x.trim()) ?? input.hookLine ?? "";
  return t.replace(/[<>]/g, "").trim().slice(0, 100);
}

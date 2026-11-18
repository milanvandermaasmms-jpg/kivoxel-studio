// Standard YouTube texts (Milan, 18-11-2026: "1x bouwen en daarna onbeperkt gebruiken"). Every new publication draft
// starts with a title, a description and tags that cost nothing: built from the script the video already has and a
// fixed KIVOXEL block, with tags picked from the words of the title. The paid AI suggestions stay optional.
// Video content is always English (decision 16-11-2026), so these texts are English too.
import { TAGS_MAX } from "./publication";

/** Always on every KIVOXEL video. */
export const BASE_TAGS = ["minecraft", "minecraft survival", "minecraft bedrock", "minecraft ps5", "gaming", "kivoxel"];
const SHORT_TAGS = ["minecraft shorts", "shorts"];
const LONG_TAGS = ["minecraft lets play", "minecraft survival series"];

/** Words in a title that are worth a tag of their own (lower case), with the tag they become. */
const TOPICS: [RegExp, string[]][] = [
  [/\btnt\b|explo/i, ["minecraft tnt", "tnt explosion"]],
  [/creeper/i, ["minecraft creeper"]],
  [/zombie|husk/i, ["minecraft zombie"]],
  [/skeleton/i, ["minecraft skeleton"]],
  [/spider/i, ["minecraft spider"]],
  [/enderman|ender pearl|\bend\b/i, ["minecraft enderman"]],
  [/iron golem|golem/i, ["minecraft iron golem"]],
  [/diamond/i, ["minecraft diamonds"]],
  [/\bcave|mine ?shaft|underground/i, ["minecraft cave", "minecraft caves"]],
  [/lava|nether/i, ["minecraft lava"]],
  [/elytra/i, ["minecraft elytra"]],
  [/\bmace\b|wind (burst|charge)/i, ["minecraft mace"]],
  [/\bpvp\b|duel|fight/i, ["minecraft pvp"]],
  [/snow|ice|frozen/i, ["minecraft snow"]],
  [/hardcore/i, ["minecraft hardcore"]],
  [/\bbuild|base|house|tower/i, ["minecraft build"]],
  [/trap/i, ["minecraft trap"]],
  [/fail|death|dies|died|dead/i, ["minecraft fails"]],
  [/funny|lol/i, ["minecraft funny moments"]],
  [/\bpart \d|series/i, ["minecraft series"]],
];

export function standardTags(input: { kind: "short" | "long"; texts: string[] }): string[] {
  const words = input.texts.join(" ");
  const topical = TOPICS.filter(([re]) => re.test(words)).flatMap(([, t]) => t);
  const all = [...BASE_TAGS, ...(input.kind === "short" ? SHORT_TAGS : LONG_TAGS), ...topical];
  const out: string[] = [];
  for (const t of all) {
    if (out.includes(t) || out.length >= 15) continue;
    if ([...out, t].join(",").length > TAGS_MAX) break;
    out.push(t);
  }
  return out;
}

const CHANNEL_BLOCK = {
  short: "KIVOXEL plays Minecraft survival on PS5 – new Shorts every day: close calls, fails, finds and big moments.\n🔔 Subscribe so you never miss the next one!",
  long: "KIVOXEL plays Minecraft survival on PS5, told as a story: every close call, fail and find from the whole session.\n🔔 Subscribe for the next part!",
};

/** The opening line (the hook of the script, or the title), the fixed KIVOXEL block and 3 hashtags. */
export function standardDescription(input: { kind: "short" | "long"; title: string; hookLine?: string | null }): string {
  const clean = (s: string) => s.replace(/[<>]/g, "").trim();
  const opening = clean(input.hookLine || input.title);
  const hashtags = input.kind === "short" ? "#minecraft #gaming #shorts" : "#minecraft #gaming #minecraftsurvival";
  return [opening, CHANNEL_BLOCK[input.kind], hashtags].filter(Boolean).join("\n\n");
}

/** The standard title: the first title the script already wrote (free), else the hook of the script. */
export function standardTitle(input: { scriptTitles?: string[] | null; hookLine?: string | null }): string {
  const t = input.scriptTitles?.find((x) => x.trim()) ?? input.hookLine ?? "";
  return t.replace(/[<>]/g, "").trim().slice(0, 100);
}

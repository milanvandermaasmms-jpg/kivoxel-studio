// 24-11-2026: the text Milan pastes in the TikTok app when he posts a Short from his TikTok inbox ("Kopieer TikTok-tekst").
// TikTok's inbox upload carries no caption, so the studio prepares it: the English title plus a few hashtags. Always
// English, like every video text; a Dutch title is skipped for the next candidate.
import { looksDutch } from "./config.ts";

const BASE = ["minecraft", "minecraftshorts", "gaming"];
const MAX_TAGS = 6;

const asTag = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

/** Caption for TikTok from the candidate titles (first English one wins) and the YouTube tags. Pure, tested. */
export function tiktokCaption(titles: (string | null | undefined)[], tags: string[] = []): string {
  const clean = titles.map((t) => (t ?? "").replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = clean.find((t) => !looksDutch(t)) ?? "";
  const fromTitle = titles.flatMap((t) => (t ?? "").match(/#([^\s#]+)/g) ?? []).map((h) => asTag(h));
  const all = [...BASE, ...fromTitle, ...tags.map(asTag)].filter((t) => t.length >= 3 && t.length <= 30);
  const hashtags = [...new Set(all)].slice(0, MAX_TAGS).map((t) => `#${t}`);
  return [title, hashtags.join(" ")].filter(Boolean).join("\n\n");
}

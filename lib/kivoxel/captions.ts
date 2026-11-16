// KIVOXEL fase 1, section 7.4: animated burned-in captions. Spoken lines are cut into chunks of a few words
// (Shorts style), the word being said lights up, key words get an accent colour, everything stays inside the safe
// zone (above YouTube's buttons and title, away from the right column). Styles rotate between videos (section 7.8).
import { HEADER, assColourTag } from "./brand.ts";
import type { Settings } from "./config.ts";
import { assText, assTime, type Size } from "../youtube/render.ts";

export const CAPTION_STYLES = ["pop", "bounce", "highlight"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
/** A word the voice really said, with absolute times in the video (from Whisper on the voice clip). */
export type HeardWord = { text: string; startMs: number; endMs: number };
export type TimedLine = { startMs: number; endMs: number; text: string; /** When known: the words as really spoken, so the captions follow the voice exactly. */ heard?: HeardWord[] };
export type Word = { text: string; startMs: number; endMs: number; key: boolean };

/** Words that carry the moment: shown in the accent colour. Plus every word the script already wrote in CAPITALS. */
const KEY = /^(no+|dead|die[sd]?|gone|over|lava|creeper|tnt|diamonds?|hearts?|one|run|move|jump|fall|boom|insane|clutch|why|how|what|bro|careful|down|never|everything|all)$/i;
const isKey = (w: string) => {
  const bare = w.replace(/[^\p{L}\p{N}']/gu, "");
  return bare.length > 1 && (KEY.test(bare) || (bare === bare.toUpperCase() && /\p{L}{2,}/u.test(bare)));
};

/** Word timings inside a spoken line: in proportion to the length of each word (longer words take longer to say). */
export function wordTimes(line: TimedLine): Word[] {
  const words = line.text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const heard = line.heard ?? [];
  if (heard.length) {
    // Same number of words: every caption word gets the time its spoken word really has.
    if (heard.length === words.length) return words.map((w, i) => ({ text: w, startMs: heard[i].startMs, endMs: Math.max(heard[i].startMs + 80, heard[i].endMs), key: isKey(w) }));
    // Otherwise the script words are spread over the stretch where the voice really speaks (never over its silences).
    return wordTimes({ startMs: heard[0].startMs, endMs: Math.max(heard[0].startMs + 200, heard[heard.length - 1].endMs), text: line.text });
  }
  const weight = (w: string) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?…]$/.test(w) ? 2 : 0);
  const total = words.reduce((s, w) => s + weight(w), 0);
  const span = Math.max(1, line.endMs - line.startMs);
  let t = line.startMs;
  return words.map((w) => {
    const d = (span * weight(w)) / total;
    const word = { text: w, startMs: Math.round(t), endMs: Math.round(t + d), key: isKey(w) };
    t += d;
    return word;
  });
}

/** Chunks of at most `max` words, breaking early after punctuation, so a caption is readable in one glance. */
export function chunks(words: Word[], max = 3): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= max || /[.,!?…]$/.test(w.text)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export function captionLayout(size: Size, settings: Settings) {
  const vertical = size.height > size.width;
  const z = settings.shorts.safe_zone;
  return {
    fontSize: Math.round(size.height * (vertical ? 0.043 : 0.05)),
    // Bottom edge of the caption: above the Shorts title/buttons area (vertical); in a long video above the Minecraft
    // HUD (hotbar and hearts take the lowest ~18% of the picture).
    bottom: vertical ? z.bottom_px + 40 : Math.round(size.height * 0.22),
    left: vertical ? z.left_px : 120,
    right: vertical ? z.right_px : 120,
  };
}

export function captionStyleLine(size: Size, settings: Settings): string {
  const l = captionLayout(size, settings);
  return `Style: Word,${HEADER.font.family},${l.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,7,3,2,${l.left},${l.right},${l.bottom},1`;
}

const KEY_COLOUR = "#FF5A36";
const WHITE = "&HFFFFFF&";

/**
 * ASS events for the captions. One event per word moment: the chunk is shown with the current word in the brand
 * yellow (a bit bigger); key words stay in the accent colour. The first word of a chunk pops/bounces in.
 */
export function captionEvents(lines: TimedLine[], style: CaptionStyle, size: Size, settings: Settings, durationMs: number): string[] {
  const yellow = assColourTag(HEADER.color_hex);
  const accent = assColourTag(KEY_COLOUR);
  const events: string[] = [];
  for (const line of lines) {
    for (const chunk of chunks(wordTimes(line))) {
      const chunkEnd = Math.min(durationMs, chunk[chunk.length - 1].endMs);
      chunk.forEach((current, i) => {
        const start = current.startMs;
        const end = i === chunk.length - 1 ? chunkEnd : chunk[i + 1].startMs;
        if (end <= start) return;
        const intro = i > 0 ? "" : style === "pop" ? "\\fscx75\\fscy75\\t(0,110,\\fscx105\\fscy105)\\t(110,170,\\fscx100\\fscy100)" : style === "bounce" ? "\\frz-3\\t(0,140,\\frz0)\\fscy85\\t(0,140,\\fscy100)" : "";
        const text = chunk
          .map((w) => {
            const t = assText(w.text.toUpperCase());
            // Reset only colour (and size) after a word: a full reset would also stop the pop/bounce of the chunk.
            if (w === current && style !== "pop") return `{\\c${yellow}\\fscx112\\fscy112}${t}{\\c${WHITE}\\fscx100\\fscy100}`;
            if (w === current) return `{\\c${yellow}}${t}{\\c${WHITE}}`;
            return w.key ? `{\\c${accent}}${t}{\\c${WHITE}}` : t;
          })
          .join(" ");
        events.push(`Dialogue: 2,${assTime(start)},${assTime(end)},Word,,0,0,0,,${intro ? `{${intro}}` : ""}${text}`);
      });
    }
  }
  return events;
}

/** Spoken lines with their real end (from the sync gate) -> timed lines; without a length, until the next line. */
export function timedFromSpoken(spoken: { at_ms: number; text: string; ms?: number; heard?: HeardWord[] }[], durationMs: number): TimedLine[] {
  const sorted = [...spoken].sort((a, b) => a.at_ms - b.at_ms);
  return sorted.map((l, i) => {
    const heard = (l.heard ?? []).filter((w) => w.startMs < durationMs);
    return { startMs: l.at_ms, endMs: Math.min(durationMs, l.ms ? l.at_ms + l.ms : (sorted[i + 1]?.at_ms ?? durationMs)), text: l.text, ...(heard.length ? { heard } : {}) };
  });
}

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/**
 * How much of the script line the voice really said (0-1): the share of script words that come back, in order, in
 * what Whisper heard. A cloned voice sometimes skips or invents words; below ~0.6 the line is spoken again.
 */
export function heardMatch(script: string, heard: { text: string }[]): number {
  const want = script.split(/\s+/).map(normWord).filter(Boolean);
  const got = heard.flatMap((w) => w.text.split(/\s+/)).map(normWord).filter(Boolean);
  if (!want.length) return 1;
  // Longest common subsequence: order matters, and a repeat ("wait wait wait") counts each time.
  const dp = Array.from({ length: want.length + 1 }, () => new Array<number>(got.length + 1).fill(0));
  for (let i = 1; i <= want.length; i++) for (let j = 1; j <= got.length; j++) dp[i][j] = want[i - 1] === got[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[want.length][got.length] / want.length;
}

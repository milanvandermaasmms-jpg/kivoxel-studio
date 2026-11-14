// Dreamnest fase 5: packaging rules (chapters, title, description, tags, Shorts, thumbnail text) and the publish rules.
// Pure and tested. English first (decision 13-11-2026). Text is never drawn by the image model: it is our own layer.
import type { Segment } from "./timeline";

/** Scene names per keyframe id (b02 = "b02-lumi-rocking-chair"). */
export const SCENE_NAMES: Record<string, string> = {
  "b01-welcome-exterior": "Welcome to Lumi's cozy cottage",
  "b02-lumi-rocking-chair": "Lumi rocks by the fire",
  "b03-pip-arrives": "Pip comes to visit",
  "b04-tea": "Warm tea time",
  "b05-mo-by-fire": "Mo by the fireplace",
  "b06-window-momo": "Snow at the window",
  "b07-lumi-yawn": "A big sleepy yawn",
  "b08-blanket-together": "Cuddled under the blanket",
  "b09-lumi-falls-asleep": "Lumi falls asleep",
  "b10-sleep-loop-base": "Quiet fireplace glow",
};
const keyOf = (asset: string) => asset.replace(/^(story|loop)-/, "");

export const stamp = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

export type Chapter = { atS: number; title: string };

/**
 * Chapters from the timeline (YouTube: first at 0:00, at least 3, each at least 10 s). One per story keyframe,
 * then falling asleep, every sleep view and the quiet end.
 */
export function chaptersFrom(segs: Segment[]): Chapter[] {
  const out: Chapter[] = [];
  const add = (atS: number, title: string) => {
    const at = Math.round(atS);
    if (out.length && at - out[out.length - 1].atS < 10) return;
    if (out.length && out[out.length - 1].title === title) return;
    out.push({ atS: at, title });
  };
  let lastKey = "";
  for (const s of segs) {
    const key = keyOf(s.asset);
    if (s.part === "welcome") add(0, SCENE_NAMES[key] ?? "Welcome");
    else if (s.part === "story") {
      if (key !== lastKey) add(s.startS, SCENE_NAMES[key] ?? "Bedtime story");
    } else if (s.part === "falling_asleep") {
      if (!out.some((c) => c.title === "Drifting off to sleep")) add(s.startS, "Drifting off to sleep");
    } else if (s.part === "sleep") add(s.startS, `Sleep music · ${SCENE_NAMES[key] ?? "Night"}`);
    else if (s.part === "outro") add(s.startS, "Gentle fade into quiet");
    lastKey = key;
  }
  if (out.length) out[0].atS = 0;
  return out;
}

export type EpisodeText = { title: string; description: string; tags: string[] };

const lengthWord = (min: number) => (min >= 120 ? `${min / 60} Hours` : min === 90 ? "90 Minutes" : "1 Hour");
export const PLAYLIST = "DreamNest | Magical Sleep Worlds";

/** Title (≤ 100), description with chapters and honest notes, and tags (≤ 500 characters together). */
export function episodeText(o: { title: string; minutes: number; chapters: Chapter[] }): EpisodeText {
  const title = clip(`${o.title} 🌙 ${lengthWord(o.minutes)} Baby Sleep Music | Lullabies for Babies`, 100);
  const description = [
    `${o.title}: a calm bedtime story with Lumi van Dreamnest, then ${lengthWord(o.minutes).toLowerCase()} of soft lullabies by a crackling fireplace. The picture slowly gets darker and the music gets quieter, so your little one can drift off to sleep.`,
    "",
    "🌙 Inside",
    ...o.chapters.map((c) => `${stamp(c.atS)} ${c.title}`),
    "",
    "💤 Made for sleep",
    "• No flashes, no sudden sounds, no loud parts",
    "• Gentle volume that stays low and even",
    "• Slow cross-fades and a slowly dimming picture",
    "",
    "🎵 Music: Twinkle Twinkle Little Star and Brahms' Lullaby (public domain), plus our own original lullabies, all played and mixed by DreamNest.",
    "✨ The visuals are made with the help of AI tools and edited by DreamNest.",
    "",
    `More sleepy worlds with Lumi: see the playlist "${PLAYLIST}" on our channel.`,
    "",
    "#babysleepmusic #lullabies #sleepmusic",
  ].join("\n");
  const tags = fitTags(["baby sleep music", "lullabies for babies", "lullaby", "sleep music for babies", "bedtime music", "baby lullaby", "fireplace sleep music", "relaxing music for kids", "twinkle twinkle little star", "brahms lullaby", "calm music", "sleepy music", "dreamnest", "lumi"]);
  return { title, description, tags };
}

export function fitTags(tags: string[], max = 480): string[] {
  const out: string[] = [];
  let n = 0;
  for (const t of tags) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (n + cost > max) break;
    out.push(t);
    n += cost;
  }
  return out;
}
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export type ShortPlan = { id: string; fromS: number; lengthS: number; title: string; caption: string };

/** 3 vertical Shorts (20-40 s) from the calmest story moments: a keyframe's loop, so there is no cut inside. */
export function planShorts(segs: Segment[], count = 3): ShortPlan[] {
  const wanted = ["b02-lumi-rocking-chair", "b05-mo-by-fire", "b09-lumi-falls-asleep", "b08-blanket-together", "b04-tea"];
  const out: ShortPlan[] = [];
  for (const key of wanted) {
    const s = segs.find((x) => x.part === "story" && x.asset === `loop-${key}`);
    if (!s) continue;
    const lengthS = Math.min(30, Math.max(20, Math.floor(s.lengthS - 8)));
    if (s.lengthS - 8 < 20) continue;
    out.push({ id: `short-${key}`, fromS: Math.round(s.startS + 4), lengthS, title: clip(`${SCENE_NAMES[key]} 🌙 Lullaby for babies #shorts`, 100), caption: SCENE_NAMES[key] });
    if (out.length === count) break;
  }
  return out;
}

export const shortText = (p: ShortPlan, episodeTitle: string): EpisodeText => ({
  title: p.title,
  description: `${p.caption}: a tiny moment from "${episodeTitle}" with Lumi van Dreamnest. The full sleep video is on our channel.\n\n✨ Visuals made with the help of AI tools and edited by DreamNest. Music: our own lullabies and public domain melodies.\n\n#shorts #lullaby #babysleepmusic`,
  tags: fitTags(["lullaby", "baby sleep music", "shorts", "dreamnest", "lumi"]),
});

/** Thumbnail title: at most 2 short lines, big and readable on a phone. */
export function thumbLines(title: string): string[] {
  const words = title.replace(/[^\p{L}\p{N}' ]/gu, "").split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [words.join(" ")];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

export type PublishInput = { kind: "long" | "short"; title: string; description: string; tags: string[]; publishAt: string | null; qcOk: boolean; channelLinked: boolean };

/**
 * The publish rules (megaprompt §7.13): never without QC ✅, always Made for Kids and the AI label, private until a
 * planned moment (at least 1 hour ahead). Returns the problem in Dutch, or null.
 */
export function publishProblem(p: PublishInput, now = Date.now()): string | null {
  if (!p.channelLinked) return "Het Dreamnest-kanaal is niet aan YouTube gekoppeld.";
  if (p.kind === "long" && !p.qcOk) return "De controle (QC) is niet ✅: er wordt niet gepubliceerd.";
  if (!p.title.trim() || p.title.length > 100) return "De titel is leeg of langer dan 100 tekens.";
  if (/[<>]/.test(p.title + p.description)) return "YouTube staat < en > niet toe in titel of beschrijving.";
  if (p.description.length > 5000) return "De beschrijving is langer dan 5000 tekens.";
  if (p.tags.join(",").length > 500) return "De tags zijn samen te lang (500 tekens).";
  if (p.publishAt) {
    const at = Date.parse(p.publishAt);
    if (!Number.isFinite(at) || at < now + 60 * 60_000) return "Kies een moment minstens een uur vanaf nu.";
  }
  return null;
}

/** What always goes to YouTube for Dreamnest, whatever the screen says. */
export const DN_FIXED = { made_for_kids: true, contains_synthetic_media: true, category_id: "10", language: "en" } as const;

// ---------- Text layers (ASS for FFmpeg/libass): our own crisp text, never drawn by the image model ----------
const assText = (s: string) => s.replace(/[{}\\]/g, "").replace(/\n/g, " ");
/** ASS colour from #RRGGBB, with alpha 00 (solid) .. FF (invisible). */
export const assColour = (hex: string, alpha = 0) => `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const circle = (cx: number, cy: number, r: number) => {
  const k = 0.5523 * r;
  const f = (n: number) => Math.round(n);
  return `m ${f(cx - r)} ${f(cy)} b ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} b ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} b ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} b ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}`;
};
const header = (w: number, h: number, styles: string[]) => [
  "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  ...styles, "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
const FONT = "Arial Rounded MT Bold";
const GOLD = "#F3D98B", NIGHT = "#2A2160", MINT = "#BFEFE2";

/** Thumbnail text layer (1280x720): a soft night cloud on the right with the title in gold and a small mint line. */
export function dnThumbAss(lines: string[], sub: string, variant = 0): string {
  const cx = [905, 930, 880][variant % 3], cy = [300, 260, 330][variant % 3];
  const cloud = [circle(cx - 170, cy + 30, 120), circle(cx - 40, cy - 40, 150), circle(cx + 120, cy - 10, 135), circle(cx + 220, cy + 50, 100), circle(cx + 30, cy + 90, 140), circle(cx - 220, cy + 100, 90)].join(" ");
  const size = Math.max(...lines.map((l) => l.length)) > 12 ? 74 : 92;
  return [
    ...header(1280, 720, [
      `Style: Cloud,${FONT},20,${assColour(NIGHT, 0x50)},${assColour(NIGHT)},${assColour(NIGHT)},${assColour(NIGHT)},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
      `Style: Title,${FONT},${size},${assColour(GOLD)},${assColour(GOLD)},${assColour("#1B1440")},${assColour("#000000", 0x80)},-1,0,0,0,100,100,1,0,1,5,3,5,0,0,0,1`,
      `Style: Sub,${FONT},40,${assColour(MINT)},${assColour(MINT)},${assColour("#1B1440")},${assColour("#000000", 0x80)},-1,0,0,0,100,100,1,0,1,3,2,5,0,0,0,1`,
    ]),
    `Dialogue: 0,0:00:00.00,0:00:10.00,Cloud,,0,0,0,,{\\blur6\\p1}${cloud}{\\p0}`,
    `Dialogue: 1,0:00:00.00,0:00:10.00,Title,,0,0,0,,{\\pos(${cx},${cy + 10})\\blur0.6}${lines.map(assText).join("\\N")}`,
    `Dialogue: 1,0:00:00.00,0:00:10.00,Sub,,0,0,0,,{\\pos(${cx},${cy + (lines.length > 1 ? 135 : 95)})}${assText(sub)}`,
    "",
  ].join("\n");
}

/** Short text layer (1080x1920): the scene on top, the way to the full video at the bottom; soft fades. */
export function dnShortAss(caption: string, lengthS: number, bottom = "Full sleep video on DreamNest"): string {
  const end = `0:00:${String(Math.min(59, Math.ceil(lengthS))).padStart(2, "0")}.00`;
  return [
    ...header(1080, 1920, [
      `Style: Top,${FONT},76,${assColour(GOLD)},${assColour(GOLD)},${assColour("#1B1440")},${assColour("#000000", 0x80)},-1,0,0,0,100,100,1,0,1,5,3,8,60,60,260,1`,
      `Style: Bottom,${FONT},54,${assColour(MINT)},${assColour(MINT)},${assColour("#1B1440")},${assColour("#000000", 0x80)},-1,0,0,0,100,100,1,0,1,4,2,2,60,60,300,1`,
    ]),
    `Dialogue: 0,0:00:00.00,${end},Top,,0,0,0,,{\\fad(900,900)}${assText(caption)}`,
    `Dialogue: 0,0:00:02.00,${end},Bottom,,0,0,0,,{\\fad(900,900)}${assText(bottom)}`,
    "",
  ].join("\n");
}

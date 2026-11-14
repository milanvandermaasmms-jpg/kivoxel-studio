// Dreamnest fase 4: the timeline of a long episode and how it is cut into render pieces. Pure functions, tested.
// Structure (megaprompt §4): welcome -> story -> falling asleep -> sleep loop (variant every 4-8 min) -> outro.
// Transitions are our own slow cross-fades (fase-4-eisen.md): 3 s in the story, 5 s later on.

export type Asset = { id: string; kind: "story" | "loop"; lengthS: number };
export type Segment = { asset: string; startS: number; lengthS: number; part: "welcome" | "story" | "falling_asleep" | "sleep" | "outro"; xfadeS: number };
export type Piece =
  | { kind: "body"; id: string; asset: string; fromS: number; lengthS: number; globalS: number }
  | { kind: "transition"; id: string; from: { asset: string; fromS: number }; to: { asset: string; fromS: number }; lengthS: number; globalS: number };

export const PARTS = { welcomeEnd: 30, storyEnd: 6 * 60, asleepEnd: 12 * 60 };

/**
 * Story order follows the keyframes. A keyframe without its own loop is held with its story piece (ping-pong);
 * one with a loop continues on the loop. Sleep: rotate calm loops, each 4-8 min, never the same one twice in a row.
 */
export function buildTimeline(assets: Asset[], totalMin: number, seed = 1): Segment[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const segs: Segment[] = [];
  let t = 0;
  const push = (asset: string, lengthS: number, part: Segment["part"], xfadeS: number) => {
    segs.push({ asset, startS: t, lengthS, part, xfadeS });
    t += lengthS - xfadeS;
  };
  const order = ["b01-welcome-exterior", "b02-lumi-rocking-chair", "b03-pip-arrives", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep"];
  // Welcome -> first room: a long 10 s cross-fade, from outside (night, darker) to inside (warm light).
  push(`story-${order[0]}`, 40, "welcome", 10);
  // Every keyframe moves the clock by its length minus one 3 s cross-fade, so add that back.
  const storyEach = (PARTS.storyEnd - t) / (order.length - 1) + 3;
  for (const k of order.slice(1)) {
    const loop = `loop-${k}`;
    // A segment must outlast its incoming and outgoing cross-fade (plus a calm second); the first one after the long
    // welcome fade gets that extra time from its loop, so the clock (and every later piece) stays the same.
    const minLen = segs[segs.length - 1].xfadeS + 3 + 1;
    if (has(loop)) {
      const len = Math.max(9, minLen);
      push(`story-${k}`, len, "story", 3);
      push(loop, storyEach - 6 - (len - 9), "story", 3);
    } else push(`story-${k}`, Math.max(storyEach, minLen), "story", 3);
  }
  // Falling asleep: Lumi asleep, then everyone asleep; slow and getting darker.
  const asleep = ["loop-b09-lumi-falls-asleep", "loop-b08-blanket-together", "loop-b10-sleep-loop-base"].filter((a) => has(a) && a !== segs[segs.length - 1].asset);
  const asleepEach = (PARTS.asleepEnd - t) / asleep.length + 5;
  for (const a of asleep) push(a, asleepEach, "falling_asleep", 5);
  // Sleep: rotate the calmest loops, 4-8 min each.
  const calm = ["loop-b10-sleep-loop-base", "loop-b06-window-momo", "loop-b08-blanket-together", "loop-b05-mo-by-fire", "loop-b09-lumi-falls-asleep"].filter(has);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const end = totalMin * 60;
  const outroS = 120;
  let last = segs[segs.length - 1].asset;
  while (t < end - outroS - 60) {
    const choices = calm.filter((c) => c !== last);
    const pick = choices[Math.floor(rand() * choices.length)];
    const len = Math.min(240 + rand() * 240, end - outroS - t + 5);
    push(pick, len, "sleep", 5);
    last = pick;
  }
  push("loop-b10-sleep-loop-base" === last ? calm.find((c) => c !== last)! : "loop-b10-sleep-loop-base", end - t, "outro", 5);
  return segs;
}

export const episodeLength = (segs: Segment[]) => {
  const l = segs[segs.length - 1];
  return l.startS + l.lengthS;
};

/**
 * Cut the timeline into render pieces: the calm middle of every segment ("body", split into pieces of at most
 * maxPieceS so a render can resume) and the cross-fade between two segments ("transition").
 */
export function planPieces(segs: Segment[], maxPieceS = 120): Piece[] {
  const pieces: Piece[] = [];
  segs.forEach((seg, i) => {
    const inX = i > 0 ? segs[i - 1].xfadeS : 0;
    const outX = i < segs.length - 1 ? seg.xfadeS : 0;
    let from = inX;
    const bodyEnd = seg.lengthS - outX;
    let k = 0;
    while (from < bodyEnd - 1e-6) {
      const len = Math.min(maxPieceS, bodyEnd - from);
      pieces.push({ kind: "body", id: `${String(i).padStart(3, "0")}-b${k++}`, asset: seg.asset, fromS: from, lengthS: len, globalS: seg.startS + from });
      from += len;
    }
    if (outX) pieces.push({ kind: "transition", id: `${String(i).padStart(3, "0")}-x`, from: { asset: seg.asset, fromS: bodyEnd }, to: { asset: segs[i + 1].asset, fromS: 0 }, lengthS: outX, globalS: seg.startS + bodyEnd });
  });
  return pieces;
}

/**
 * Dimming (megaprompt §4): full light in the story, then slowly warmer and darker; near black in the outro.
 * Returns 0 (no dimming) .. 1 (near black) for a moment in the episode.
 */
export function dimAt(tS: number, totalS: number): number {
  if (tS <= PARTS.storyEnd) return 0;
  const sleepDim = 0.45;
  if (tS <= totalS - 120) return Math.min(sleepDim, ((tS - PARTS.storyEnd) / (totalS - 120 - PARTS.storyEnd)) * sleepDim + (tS < PARTS.asleepEnd ? 0 : 0));
  return sleepDim + ((tS - (totalS - 120)) / 120) * (0.9 - sleepDim);
}

/** FFmpeg expression for the dim curve inside one piece (t is the piece's own time, offset is its global start). */
export function dimFilter(globalS: number, lengthS: number, totalS: number): string {
  const a = dimAt(globalS, totalS), b = dimAt(globalS + lengthS, totalS);
  const d = (x: number) => x.toFixed(5);
  // Linear inside a piece (pieces are short, the curve is smooth). Darker = lower brightness and gamma, a bit warmer.
  const dim = `(${d(a)}+(${d(b - a)})*t/${lengthS.toFixed(3)})`;
  return `eq=eval=frame:brightness='-0.30*${dim}':gamma='1-0.35*${dim}':saturation='1-0.25*${dim}',colorbalance=rm=${d(0.04 * ((a + b) / 2))}:bm=${d(-0.04 * ((a + b) / 2))}`;
}

// ---------- Fase 6: crisp motion (Milan: "beweging wazig/raar") ----------
// No slowing down, no blending of frames, no playing backwards. Story clips play at their own speed (only the calm
// part), then the scene's seamless loop or its still with a very slow zoom. The sleep part alternates stills (with
// the living layers, 4-7 min) and breathing loops (1.5-3 min), never the same view twice in a row.

export type AssetV2 = { id: string; kind: "story" | "loop" | "still"; lengthS: number };

const STORY_X = 1.5;
export const STORY_MIN_S = 2 * STORY_X + 1;
export const STORY_ORDER = ["b01-welcome-exterior", "b02-lumi-rocking-chair", "b03-pip-arrives", "b04-tea", "b05-mo-by-fire", "b06-window-momo", "b07-lumi-yawn", "b08-blanket-together", "b09-lumi-falls-asleep"];

export function buildEpisodeTimeline(assets: AssetV2[], totalMin: number, seed = 1): Segment[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const len = (id: string) => assets.find((a) => a.id === id)?.lengthS ?? 0;
  const segs: Segment[] = [];
  let t = 0;
  const push = (asset: string, lengthS: number, part: Segment["part"], xfadeS: number) => {
    segs.push({ asset, startS: t, lengthS, part, xfadeS });
    t += lengthS - xfadeS;
  };
  push(`story-${STORY_ORDER[0]}`, 40, "welcome", 10);
  const keys = STORY_ORDER.slice(1);
  const storyEach = (PARTS.storyEnd - t) / keys.length;
  // A story moment is used when it outlasts its two soft 1.5 s cross-fades plus a second (>= 4 s at its own speed).
  // Not right after the welcome: that long 10 s cross-fade (outside to inside) goes into the scene's loop or still.
  const usable = (k: string) => k !== keys[0] && has(`story-${k}`) && len(`story-${k}`) >= STORY_MIN_S;
  keys.forEach((k, i) => {
    const target = PARTS.welcomeEnd + 10 + storyEach * (i + 1); // where this scene should hand over (keeps the clock)
    const story = `story-${k}`;
    const hold = has(`loop-${k}`) ? `loop-${k}` : `still-${k}`;
    if (usable(k)) {
      // The cross-fade into a short story moment is 1.5 s (the one before it is shortened to match).
      if (segs.length > 1 && segs[segs.length - 1].xfadeS > STORY_X) segs[segs.length - 1].xfadeS = Math.min(segs[segs.length - 1].xfadeS, STORY_X), (t = segs[segs.length - 1].startS + segs[segs.length - 1].lengthS - STORY_X);
      push(story, Math.min(len(story), 8), "story", STORY_X);
    }
    const prevX = segs[segs.length - 1].xfadeS;
    const nextX = i + 1 < keys.length && usable(keys[i + 1]) ? STORY_X : 3;
    const holdLen = Math.max(prevX + nextX + 3, target - t + nextX);
    if (has(hold)) push(hold, holdLen, "story", nextX);
  });
  // Falling asleep: Lumi asleep, everyone asleep, the quiet room; a breathing loop between two stills.
  const asleep = ["loop-b09-lumi-falls-asleep", "still-b08-blanket-together", "loop-b10-sleep-loop-base"].filter((a) => has(a) && a !== segs[segs.length - 1].asset);
  const asleepEach = (PARTS.asleepEnd - t) / asleep.length + 5;
  for (const a of asleep) push(a, asleepEach, "falling_asleep", 5);
  // Sleep: alternate still and loop, each from a different view than the one before.
  const stills = ["still-b10-sleep-loop-base", "still-b06-window-momo", "still-b08-blanket-together", "still-b05-mo-by-fire", "still-b09-lumi-falls-asleep"].filter(has);
  const loops = ["loop-b10-sleep-loop-base", "loop-b06-window-momo", "loop-b08-blanket-together", "loop-b05-mo-by-fire", "loop-b09-lumi-falls-asleep"].filter(has);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const end = totalMin * 60;
  const outroS = 120;
  const view = (id: string) => id.replace(/^(story|loop|still)-/, "");
  let last = segs[segs.length - 1].asset;
  let useStill = !last.startsWith("still-");
  while (t < end - outroS - 60) {
    const pool = (useStill && stills.length ? stills : loops.length ? loops : stills).filter((c) => view(c) !== view(last));
    const pick = pool[Math.floor(rand() * pool.length)];
    const want = pick.startsWith("still-") ? 240 + rand() * 180 : 90 + rand() * 90;
    push(pick, Math.min(want, end - outroS - t + 5), "sleep", 5);
    last = pick;
    useStill = !useStill;
  }
  const outro = ["still-b10-sleep-loop-base", "still-b08-blanket-together"].find((c) => has(c) && view(c) !== view(last)) ?? last;
  push(outro, end - t, "outro", 5);
  return segs;
}

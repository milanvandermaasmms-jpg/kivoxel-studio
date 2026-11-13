// Smarter analysis (KIVOXEL Studio fase 3): free signals from FFmpeg, before the paid analysis.
// One FFmpeg pass over a small copy of the picture and the sound finds:
// - scene changes (lavfi.scene_score), standing still (freezedetect), black picture (blackdetect),
// - silence (silencedetect) and loud moments (momentary loudness from ebur128).
// From that the studio knows which parts are dead (AFK, loading, menus) and which loud moments are worth a look.
// Nothing here costs money, and nothing leaves the pc.

export type Span = { startMs: number; endMs: number };
export type DeadKind = "afk" | "still" | "black";
export type DeadSpan = Span & { kind: DeadKind };
export type Peak = { atMs: number; loudness: number; rise: number };

export type Signals = {
  version: 1;
  durationMs: number;
  sceneCutsMs: number[];
  freezes: Span[];
  blacks: Span[];
  silences: Span[];
  /** Momentary loudness (LUFS) every 100 ms, rounded to whole numbers to keep the file small. */
  loudness: number[];
};

export type Timeline = { dead: DeadSpan[]; peaks: Peak[]; sceneCutsMs: number[]; deadMs: number };

/** The FFmpeg arguments for the signal pass (runFfmpeg adds -progress and -nostats). Picture at 10 fps and 320 px wide: enough to see stillness and cuts, and fast. */
export function signalArgs(input: string): string[] {
  return [
    "-hide_banner",
    "-i",
    input,
    "-vf",
    "fps=10,scale=320:-2,freezedetect=n=-50dB:d=5,blackdetect=d=1:pix_th=0.10,select='gt(scene,0.3)',metadata=print:key=lavfi.scene_score",
    "-af",
    "silencedetect=n=-45dB:d=3,ebur128=metadata=1,ametadata=print:key=lavfi.r128.M",
    "-f",
    "null",
    "-",
  ];
}

const sec = (s: string) => Math.max(0, Math.round(Number(s) * 1000));

/** Reads FFmpeg's log as it streams in (the log of an hour of gameplay is many MB, so line by line, not all at once). */
export function createSignalParser(durationMs: number) {
  let rest = "";
  let lastPtsMs: number | null = null;
  let lastKind: "video" | "audio" | null = null;
  let freezeStart: number | null = null;
  let silenceStart: number | null = null;
  const out: Signals = { version: 1, durationMs, sceneCutsMs: [], freezes: [], blacks: [], silences: [], loudness: [] };

  function line(text: string) {
    let m: RegExpExecArray | null;
    if ((m = /Parsed_(metadata|ametadata)_\d+ .* pts_time:(-?[\d.]+)/.exec(text))) {
      lastKind = m[1] === "metadata" ? "video" : "audio";
      lastPtsMs = sec(m[2]);
    } else if ((m = /lavfi\.scene_score=([\d.]+)/.exec(text)) && lastKind === "video" && lastPtsMs !== null) {
      if (lastPtsMs > 0) out.sceneCutsMs.push(lastPtsMs);
    } else if ((m = /lavfi\.r128\.M=(-?[\d.]+|-?inf)/.exec(text)) && lastKind === "audio") {
      const v = Number(m[1]);
      out.loudness.push(Number.isFinite(v) ? Math.max(-120, Math.round(v)) : -120);
    } else if ((m = /freeze_start: ([\d.]+)/.exec(text))) {
      freezeStart = sec(m[1]);
    } else if ((m = /freeze_end: ([\d.]+)/.exec(text)) && freezeStart !== null) {
      out.freezes.push({ startMs: freezeStart, endMs: sec(m[1]) });
      freezeStart = null;
    } else if ((m = /black_start:([\d.]+) black_end:([\d.]+)/.exec(text))) {
      out.blacks.push({ startMs: sec(m[1]), endMs: sec(m[2]) });
    } else if ((m = /silence_start: (-?[\d.]+)/.exec(text))) {
      silenceStart = sec(m[1]);
    } else if ((m = /silence_end: ([\d.]+)/.exec(text)) && silenceStart !== null) {
      out.silences.push({ startMs: silenceStart, endMs: sec(m[1]) });
      silenceStart = null;
    }
  }

  return {
    feed(chunk: string) {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const l of lines) line(l);
    },
    /** A freeze or silence that lasts until the end has no end line: it ends with the recording. */
    finish(): Signals {
      if (rest) line(rest);
      rest = "";
      if (freezeStart !== null) out.freezes.push({ startMs: freezeStart, endMs: durationMs });
      if (silenceStart !== null) out.silences.push({ startMs: silenceStart, endMs: durationMs });
      freezeStart = silenceStart = null;
      return out;
    },
  };
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/** Joins spans that touch or overlap (within `gapMs`). */
export function mergeSpans<T extends Span>(spans: T[], gapMs = 0, same: (a: T, b: T) => boolean = () => true): T[] {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  const out: T[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.startMs <= last.endMs + gapMs && same(last, s)) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Turns raw signals into what the studio uses:
 * - dead parts: AFK (still for 20 s or more), still (5-20 s: often a menu, inventory or pause) and black (loading or transition);
 * - loud peaks: at least 10 LU above the median of the 20 seconds around it, at most one per 5 seconds, the loudest 15.
 */
export function buildTimeline(s: Signals): Timeline {
  const dead: DeadSpan[] = [
    ...s.freezes.map((f) => ({ ...f, kind: (f.endMs - f.startMs >= 20_000 ? "afk" : "still") as DeadKind })),
    ...s.blacks.map((b) => ({ ...b, kind: "black" as DeadKind })),
  ].filter((d) => d.endMs > d.startMs);
  // A black screen inside a longer freeze belongs to that freeze.
  const merged = mergeSpans(dead, 500, (a, b) => a.kind === b.kind);

  const peaks: Peak[] = [];
  const step = 100;
  const window = 100; // 10 s on each side
  const L = s.loudness;
  for (let i = 0; i < L.length; i++) {
    const v = L[i];
    if (v < -35) continue;
    if (v < (L[i - 1] ?? -120) || v < (L[i + 1] ?? -120)) continue;
    const around = L.slice(Math.max(0, i - window), Math.min(L.length, i + window)).filter((x) => x > -70).sort((a, b) => a - b);
    const usual = around.length ? around[Math.floor(around.length / 2)] : -70;
    const rise = v - usual;
    if (rise < 10) continue;
    const atMs = i * step;
    if (merged.some((d) => atMs >= d.startMs && atMs <= d.endMs)) continue;
    const near = peaks.findIndex((p) => Math.abs(p.atMs - atMs) < 5_000);
    if (near >= 0) {
      if (peaks[near].loudness < v) peaks[near] = { atMs, loudness: v, rise };
    } else peaks.push({ atMs, loudness: v, rise });
  }
  peaks.sort((a, b) => b.rise - a.rise || b.loudness - a.loudness);
  const top = peaks.slice(0, 15).sort((a, b) => a.atMs - b.atMs);
  const deadMs = merged.reduce((sum, d) => sum + (d.endMs - d.startMs), 0);
  return { dead: merged, peaks: top, sceneCutsMs: s.sceneCutsMs, deadMs };
}

const tc = (ms: number) => {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Extra lines for the analysis prompt: where nothing happens, and loud moments worth checking. Short, to keep tokens low. */
export function signalHints(full: Timeline, window?: { startMs: number; endMs: number }): string {
  // For one part of a long recording (fase C): only what lies in that part, with times counted from its start.
  const t: Timeline = window
    ? {
        ...full,
        dead: full.dead.filter((d) => d.endMs > window.startMs && d.startMs < window.endMs).map((d) => ({ ...d, startMs: Math.max(0, d.startMs - window.startMs), endMs: Math.min(window.endMs, d.endMs) - window.startMs })),
        peaks: full.peaks.filter((p) => p.atMs >= window.startMs && p.atMs <= window.endMs).map((p) => ({ ...p, atMs: p.atMs - window.startMs })),
      }
    : full;
  const lines: string[] = [];
  const dead = t.dead.filter((d) => d.endMs - d.startMs >= 3_000).slice(0, 25);
  if (dead.length) {
    const label = { afk: "standing still (AFK)", still: "still picture (menu, inventory or pause)", black: "black screen (loading)" } as const;
    lines.push("Measured by FFmpeg, nothing happens in these parts; do not report moments there:");
    lines.push(dead.map((d) => `${tc(d.startMs)}-${tc(d.endMs)} ${label[d.kind]}`).join("; "));
  }
  if (t.peaks.length) {
    lines.push("Sudden loud sound (explosion, damage, mob) at these times; check them, but only report them if the picture shows a real moment:");
    lines.push(t.peaks.map((p) => tc(p.atMs)).join(", "));
  }
  return lines.join("\n");
}

/** A moment whose peak lies in a dead part, or that is mostly dead, is not a real moment. */
export function deadReason(moment: { startMs: number; endMs: number; peakMs: number | null }, t: Timeline): string | null {
  const span = { startMs: moment.startMs, endMs: moment.endMs };
  const length = Math.max(1, span.endMs - span.startMs);
  const peak = moment.peakMs ?? Math.round((span.startMs + span.endMs) / 2);
  const hit = t.dead.find((d) => peak >= d.startMs && peak <= d.endMs);
  if (hit) return `piek valt in een stilstaand of zwart stuk (${tc(hit.startMs)}-${tc(hit.endMs)})`;
  const deadShare = t.dead.reduce((sum, d) => sum + overlap(span, d), 0) / length;
  if (deadShare > 0.6) return `${Math.round(deadShare * 100)}% van het moment staat stil of is zwart`;
  return null;
}

/** Short Dutch summary for the log and the studio. */
export function timelineSummary(t: Timeline, durationMs: number): string {
  const pct = durationMs ? Math.round((t.deadMs / durationMs) * 100) : 0;
  const afk = t.dead.filter((d) => d.kind === "afk").length;
  const black = t.dead.filter((d) => d.kind === "black").length;
  return `${t.sceneCutsMs.length} scènewissels, ${t.peaks.length} geluidspieken, ${pct}% dood beeld (${afk}× AFK, ${black}× zwart/laden)`;
}

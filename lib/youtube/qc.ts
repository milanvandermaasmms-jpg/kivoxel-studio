// Fase C1: quality control with real measurements of the finished montage (2.2, chapter 19 and 24.3).
// The worker measures with ffprobe and one FFmpeg pass (ebur128, silencedetect, blackdetect, freezedetect, scdet);
// these pure functions turn that into a checklist. Thresholds are starting values (DECISIONS.md), not YouTube rules,
// except where marked as a YouTube limit.

export type QcLevel = "green" | "orange" | "red" | "na";
export type QcItem = { key: string; label: string; level: QcLevel; value: string; note: string };

export type QcLog = {
  integratedLufs: number | null;
  truePeakDb: number | null;
  sceneTimes: number[];
  blackSeconds: number[];
  freezeSeconds: number[];
  silenceSeconds: number[];
};

const num = (s: string | undefined) => (s === undefined ? null : Number.isFinite(Number(s)) ? Number(s) : null);

/** Reads the summary lines FFmpeg writes to stderr for the quality pass. */
export function parseQcLog(stderr: string): QcLog {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const all = (re: RegExp) => [...stderr.matchAll(re)].map((m) => Number(m[1])).filter(Number.isFinite);
  return {
    integratedLufs: summary.includes("Summary:") ? num(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]) : null,
    truePeakDb: summary.includes("Summary:") ? num(summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1]) : null,
    sceneTimes: all(/lavfi\.scd\.time=([\d.]+)/g),
    blackSeconds: all(/black_duration:([\d.]+)/g),
    freezeSeconds: all(/lavfi\.freezedetect\.freeze_duration: ([\d.]+)/g),
    silenceSeconds: all(/silence_duration: ([\d.]+)/g),
  };
}

export type QcProbe = { width: number; height: number; fps: number | null; bitrateBps: number | null; durationMs: number; hasAudio: boolean };
export type QcContext = {
  format: "A" | "B" | "C";
  expected: { width: number; height: number };
  /** Starting values per format (brand kit later): target length in ms. */
  targetMs: { min: number; max: number };
  /** Output time of the first analysed moment in the montage; null when unknown. */
  firstActionMs: number | null;
  hasVoice: boolean;
  /** Captions are placed by our own subtitle settings, not measured on the picture. */
  captionsInSafeZone: boolean;
};

/** Lower bound of green loudness; below this the worker tries one extra loudness pass. */
export const LOUD_GREEN = -17.5;
const SHORT_MAX_MS = 180_000; // YouTube limit for a Short (3 minutes); check again in phase D.
const fmt = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}`;
const sec = (s: number) => `${s.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} s`;
const longest = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);

/** The checklist: green, orange, red or not applicable. Red asks for a conscious confirmation, it does not block. */
export function qcChecklist(p: QcProbe, log: QcLog, c: QcContext): QcItem[] {
  const short = c.format !== "C";
  const items: QcItem[] = [];
  const sizeOk = p.width === c.expected.width && p.height === c.expected.height;
  items.push({ key: "resolution", label: "Resolutie en beeldverhouding", level: sizeOk ? "green" : "red", value: `${p.width}×${p.height}`, note: sizeOk ? (short ? "9:16 vullend" : "16:9") : `Verwacht ${c.expected.width}×${c.expected.height}` });
  items.push({ key: "fps", label: "Beelden per seconde", level: p.fps === null ? "orange" : Math.abs(p.fps - 30) < 0.2 ? "green" : "orange", value: p.fps === null ? "onbekend" : `${p.fps.toLocaleString("nl-NL")} fps`, note: "Montage maakt 30 fps" });
  const mbps = p.bitrateBps === null ? null : p.bitrateBps / 1_000_000;
  items.push({ key: "bitrate", label: "Bitrate", level: mbps === null ? "orange" : mbps >= 2 ? "green" : mbps >= 1 ? "orange" : "red", value: mbps === null ? "onbekend" : `${mbps.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} Mbit/s`, note: "Startwaarde: vanaf 2 Mbit/s" });

  const inTarget = p.durationMs >= c.targetMs.min && p.durationMs <= c.targetMs.max;
  items.push({
    key: "duration",
    label: "Lengte",
    level: short && p.durationMs > SHORT_MAX_MS ? "red" : inTarget ? "green" : "orange",
    value: fmt(p.durationMs),
    note: short && p.durationMs > SHORT_MAX_MS ? "Langer dan 3 minuten: geen Short" : `Richtlengte ${fmt(c.targetMs.min)}–${fmt(c.targetMs.max)}`,
  });

  if (!p.hasAudio || log.integratedLufs === null) items.push({ key: "loudness", label: "Luidheid", level: "red", value: "geen geluid gemeten", note: "Er is geen geluidsspoor" });
  else {
    const l = log.integratedLufs;
    items.push({ key: "loudness", label: "Luidheid (LUFS)", level: l >= LOUD_GREEN && l <= -12 ? "green" : l >= -21 && l <= -10 ? "orange" : "red", value: `${l.toLocaleString("nl-NL")} LUFS`, note: "YouTube speelt af rond −14 LUFS; startwaarde −17,5 tot −12 (alleen gamegeluid haalt zonder vervorming ongeveer −17)" });
  }
  if (log.truePeakDb !== null) items.push({ key: "peak", label: "Pieken (clipping)", level: log.truePeakDb > 0 ? "red" : log.truePeakDb > -1 ? "orange" : "green", value: `${log.truePeakDb.toLocaleString("nl-NL")} dBFS`, note: "Onder −1 dBFS blijft het zuiver, ook na AAC" });
  const silence = longest(log.silenceSeconds);
  items.push({ key: "silence", label: "Stiltes", level: silence > 3 ? "orange" : "green", value: silence ? `langste ${sec(silence)}` : "geen", note: "Startwaarde: niet langer dan 3 s stil" });
  const black = longest(log.blackSeconds);
  items.push({ key: "black", label: "Zwart beeld", level: black >= 3 ? "red" : black >= 1 ? "orange" : "green", value: black ? `langste ${sec(black)}` : "geen", note: "Startwaarde: korter dan 1 s" });
  const freeze = longest(log.freezeSeconds);
  items.push({ key: "freeze", label: "Stilstaand beeld", level: freeze >= 3 ? "orange" : "green", value: freeze ? `langste ${sec(freeze)}` : "geen", note: "Startwaarde: korter dan 3 s" });

  const changes = log.sceneTimes.length;
  const perChange = p.durationMs / 1000 / (changes + 1);
  items.push({
    key: "rhythm",
    label: "Shotritme",
    level: !short ? "na" : perChange <= 3 ? "green" : "orange",
    value: `${changes} ${changes === 1 ? "beeldwissel" : "beeldwissels"}, gemiddeld elke ${sec(perChange)}`,
    note: short ? "Startwaarde voor Shorts: elke 2–3 s een visuele verandering" : "Alleen als richtlijn voor Shorts",
  });
  items.push({
    key: "first_action",
    label: "Tijd tot de eerste actie",
    level: c.firstActionMs === null ? "orange" : c.firstActionMs <= 1000 ? "green" : c.firstActionMs <= 3000 ? "orange" : "red",
    value: c.firstActionMs === null ? "onbekend" : sec(c.firstActionMs / 1000),
    note: "Volgens het montageplan en de gevonden momenten; doel: binnen 1 s",
  });
  items.push({ key: "safe_zone", label: "Ondertitels in de veilige zone", level: c.captionsInSafeZone ? "green" : "orange", value: c.captionsInSafeZone ? "ja" : "onbekend", note: "Volgens de ondertitelinstellingen (niet in het beeld gemeten)" });
  items.push({ key: "voice_sync", label: "Voice-over gelijk met ondertitels", level: c.hasVoice ? "green" : "na", value: c.hasVoice ? "ja" : "geen voice-over", note: "Ondertitels starten op dezelfde tijd als de gesproken regel" });
  items.push({ key: "license", label: "Muziek en geluidseffecten", level: "green", value: "geen gebruikt", note: "Alleen eigen gamegeluid en eigen stem" });
  items.push({ key: "metadata", label: "Titel, beschrijving, doelgroep, thumbnail", level: "na", value: "nog niet", note: "Komt met de YouTube-koppeling (fase D)" });
  return items;
}

/** Output time of the first moment of action: where the montage first shows a part of an analysed moment. */
export function firstActionMs(segments: { src_start_ms: number; src_end_ms: number; out_start_ms: number; speed: number }[], moments: { start_ms: number; end_ms: number }[]): number | null {
  let best: number | null = null;
  for (const s of segments) {
    for (const m of moments) {
      const from = Math.max(s.src_start_ms, m.start_ms);
      if (from >= Math.min(s.src_end_ms, m.end_ms)) continue;
      const out = s.out_start_ms + (from - s.src_start_ms) / (s.speed > 0 ? s.speed : 1);
      if (best === null || out < best) best = Math.round(out);
    }
  }
  return best;
}

export const QC_LEVEL_LABEL: Record<QcLevel, string> = { green: "goed", orange: "let op", red: "rood", na: "n.v.t." };

export type Loudness = { integratedLufs: number | null; truePeakDb: number | null };
/** Highest true peak we accept after the sound pass: AAC overshoots the limiter, so keep a margin (measured 12-11-2026). */
export const SAFE_PEAK_DB = -1;

/** Does the montage need the extra sound pass: too quiet, or peaks that clip? */
export const needsLoudnessFix = (l: Loudness) => (l.integratedLufs !== null && l.integratedLufs < LOUD_GREEN) || (l.truePeakDb !== null && l.truePeakDb > SAFE_PEAK_DB);

/**
 * Picks the best version after the extra sound pass, or null to keep the original. A candidate must have safe peaks.
 * When the original clipped, a safe candidate may be up to 1 LU quieter; otherwise it must be at least 1 LU louder.
 * Among acceptable candidates the loudest wins.
 */
export function pickLoudnessFix(before: Loudness, candidates: (Loudness & { id: string })[]): (Loudness & { id: string }) | null {
  if (before.integratedLufs === null) return null;
  const clipped = before.truePeakDb !== null && before.truePeakDb > SAFE_PEAK_DB;
  const ok = candidates.filter((c) => c.integratedLufs !== null && c.truePeakDb !== null && c.truePeakDb <= SAFE_PEAK_DB && (clipped ? c.integratedLufs >= before.integratedLufs! - 1 : c.integratedLufs > before.integratedLufs! + 1));
  return ok.sort((a, b) => b.integratedLufs! - a.integratedLufs!)[0] ?? null;
}

// The Event Timeline of one recording on this pc: <data>/events/<fingerprint>.json.
// Made from the cached sound signals and picture signals (free), plus the AI moments when there are any.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eventTypeForMoment } from "../lib/kivoxel/config.ts";
import { buildEvents, EVENT_RULES, type AiMoment, type EventTimeline } from "../lib/kivoxel/events.ts";
import type { Moment } from "../lib/youtube/analysis.ts";
import type { Signals } from "../lib/youtube/footage.ts";
import { detectSignals } from "./ffmpeg.ts";
import { visualFor } from "./visualSignals.ts";
import { buildTimeline } from "../lib/youtube/footage.ts";
import type { SpeechStore } from "./kidsSpeech.ts";

export const toAiMoments = (moments: Moment[]): AiMoment[] =>
  moments.map((m) => ({ kind: m.kind, type: eventTypeForMoment(m.kind), startMs: m.startMs, peakMs: m.peakMs, endMs: m.endMs, score: m.score, reason: m.reason }));

export type TimelineOptions = { signal?: AbortSignal; onFrames?: (frames: number) => void; moments?: Moment[]; refresh?: boolean };

/** `speech`: the kids' reactions (Whisper, section 7.8) are merged in when given. */
export function createEventStore(ffmpeg: string, dataDir: string, speech?: SpeechStore | null) {
  const file = (fp: string) => join(dataDir, "events", `${fp}.json`);
  async function cached(fingerprint: string): Promise<EventTimeline | null> {
    try {
      const t = JSON.parse(await readFile(file(fingerprint), "utf8")) as EventTimeline;
      // Older detection rules (e.g. before menus were found by the missing hearts): build it again.
      return t.version === 1 && t.rules === EVENT_RULES ? t : null;
    } catch {
      return null;
    }
  }
  return {
    cached,
    /** Builds (or reads) the timeline. With AI moments or `refresh`, it is built again so the moments are merged in. */
    async timeline(fingerprint: string, recordingFile: string, durationMs: number, options: TimelineOptions = {}): Promise<EventTimeline> {
      if (!options.refresh && !options.moments?.length) {
        const t = await cached(fingerprint);
        if (t) return t;
      }
      const path = join(dataDir, "recordings", recordingFile);
      let signals: Signals | null = null;
      try {
        signals = JSON.parse(await readFile(join(dataDir, "signals", `${fingerprint}.json`), "utf8")) as Signals;
      } catch {
        await mkdir(join(dataDir, "signals"), { recursive: true });
        signals = await detectSignals(ffmpeg, path, durationMs, join(dataDir, "signals"), { signal: options.signal });
        await writeFile(join(dataDir, "signals", `${fingerprint}.json`), JSON.stringify(signals));
      }
      const visual = await visualFor(ffmpeg, dataDir, fingerprint, path, durationMs, { signal: options.signal, onFrames: options.onFrames });
      const ai = options.moments ? toAiMoments(options.moments) : undefined;
      let t = buildEvents({ visual, signals, ai });
      if (speech && signals) {
        // Listen only around the strongest moments and the loud peaks: that is where the kids shout.
        const times = [...[...t.events].sort((a, b) => b.payoff - a.payoff).slice(0, 40).map((e) => e.t_peak), ...buildTimeline(signals).peaks.map((p) => p.atMs)];
        const reactions = await speech.reactions(fingerprint, path, durationMs, times, signals.loudness, options.signal);
        if (reactions.length) t = buildEvents({ visual, signals, ai, reactions });
      }
      await mkdir(join(dataDir, "events"), { recursive: true });
      await writeFile(file(fingerprint), JSON.stringify(t));
      return t;
    },
  };
}
export type EventStore = ReturnType<typeof createEventStore>;

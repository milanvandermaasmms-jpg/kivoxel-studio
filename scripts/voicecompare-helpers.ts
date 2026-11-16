// Small re-exports for scripts/kivoxel-voicecompare.ts (one import line for the script engine helpers).
export { freeScript, gateSummary, seeded } from "../lib/kivoxel/voiceScript.ts";
import { topPayoffs, type EventTimeline } from "../lib/kivoxel/events.ts";

/** The best events of a recording for a test Short. */
export const topPayoffsFor = (t: EventTimeline) => topPayoffs(t, 5, 0);

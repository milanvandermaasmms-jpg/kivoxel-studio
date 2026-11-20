// 20-11-2026 (Milan: "Roblox en Fortnite staan in KIVOXEL"): on a channel's page the Studio shows only that channel.
// The database was right; the recordings list, analysis, Video Maker, live view and worker queue showed every channel.
import type { AnalysisState } from "./analysisData";
import type { DbState } from "./studio";

/** Only this channel's recordings, moments, videos, scripts and montages. No channel ("alle kanalen") = everything. */
export function analysisForChannel(state: AnalysisState | null, channel: string | null): AnalysisState | null {
  if (!state || !state.ready || !channel) return state;
  const recordings = state.recordings.filter((r) => r.channel_id === channel);
  const recIds = new Set(recordings.map((r) => r.id));
  const videos = state.videos.filter((v) => (v.channel_id ? v.channel_id === channel : v.recording_id !== null && recIds.has(v.recording_id)));
  const videoIds = new Set(videos.map((v) => v.id));
  const scriptIds = new Set(state.scripts.filter((s) => videoIds.has(s.video_id)).map((s) => s.id));
  return {
    ...state,
    recordings,
    moments: state.moments.filter((m) => recIds.has(m.recording_id)),
    videos,
    scripts: state.scripts.filter((s) => videoIds.has(s.video_id)),
    analyseJobs: Object.fromEntries(Object.entries(state.analyseJobs).filter(([id]) => recIds.has(id))),
    montage: state.montage && {
      ...state.montage,
      renders: state.montage.renders.filter((r) => videoIds.has(r.video_id)),
      jobs: state.montage.jobs.filter((j) => !j.script_id || scriptIds.has(j.script_id)),
    },
  };
}

/** The worker queue and the recordings in the database, for this channel only. */
export function dbForChannel(db: DbState | null, channel: string | null): DbState | null {
  if (!db || !db.ready || !channel) return db;
  return { ...db, recordings: db.recordings.filter((r) => r.channel_id === channel), jobs: db.jobs.filter((j) => j.channel_id === channel) };
}

// AI Video Maker (2.2 chapter 2): the wizard "gameplay kiezen -> format kiezen -> instellingen -> starten".
// It does not add a second pipeline: every step uses the existing actions (analysis, script, montage), and every
// decision that needs a human (approving the script, approving the video, publishing) stays Milan's click.
import type { AnalysisState, DbScript } from "./analysisData";

type Ready = Extract<AnalysisState, { ready: true }>;

export type MakerStep =
  | { kind: "intake"; text: string }
  | { kind: "analyse"; text: string; test: boolean }
  | { kind: "analysing"; text: string }
  | { kind: "no-videos"; text: string }
  | { kind: "script"; text: string; videoId: string; version: number }
  | { kind: "scripting"; text: string }
  | { kind: "approve-script"; text: string; script: DbScript }
  | { kind: "render"; text: string; script: DbScript; attempt: number }
  | { kind: "rendering"; text: string }
  | { kind: "review"; text: string }
  | { kind: "publish"; text: string }
  | { kind: "done"; text: string };

const running = (s: string | undefined) => s === "queued" || s === "running";

/** The recordings that can start a production: newest first, real gameplay before test data. */
export function makerRecordings(state: Ready) {
  return [...state.recordings].sort((a, b) => Number(a.is_test) - Number(b.is_test));
}

/** The videos (format + moments) the analysis proposed for a recording. */
export function makerVideos(state: Ready, recordingId: string) {
  return state.videos.filter((v) => v.recording_id === recordingId);
}

/** What the next step for this recording and (optional) chosen video is, in plain Dutch. */
export function makerStep(state: Ready, recordingId: string, videoId: string | null): MakerStep {
  const rec = state.recordings.find((r) => r.id === recordingId);
  if (!rec) return { kind: "intake", text: "Kies een opname." };
  if (rec.status !== "ready") return { kind: "intake", text: rec.status === "failed" ? "De intake van deze opname is mislukt; kijk in de wachtrij." : "De werker leest de opname nog in (intake)." };
  const analyse = state.analyseJobs[recordingId];
  const hasMoments = state.moments.some((m) => m.recording_id === recordingId);
  if (running(analyse)) return { kind: "analysing", text: "De analyse loopt: de AI zoekt de beste momenten." };
  const videos = makerVideos(state, recordingId);
  if (!hasMoments && videos.length === 0)
    return rec.is_test
      ? { kind: "analyse", test: true, text: "Testdata: de werker maakt gratis een testanalyse (zonder AI)." }
      : { kind: "analyse", test: false, text: "Start de analyse: de AI zoekt de momenten en stelt formats voor (betaald, binnen je maandplafond)." };
  if (videos.length === 0) return { kind: "no-videos", text: "De analyse vond geen moment dat bij een format past. Probeer een andere opname." };
  if (!videoId) return { kind: "no-videos", text: "Kies een format hieronder." };
  const video = videos.find((v) => v.id === videoId);
  if (!video) return { kind: "no-videos", text: "Kies een format hieronder." };

  const scripts = state.scripts.filter((s) => s.video_id === video.id).sort((a, b) => b.version - a.version);
  const approved = scripts.find((s) => s.status === "approved");
  // A script being written is not in this state (only analysis and montage jobs are); the screen shows that itself.
  if (!approved) {
    const latest = scripts[0];
    if (!latest) return { kind: "script", videoId: video.id, version: 1, text: "Laat de AI het script schrijven: hook, tekst en montageplan." };
    if (latest.status === "draft") return { kind: "approve-script", script: latest, text: "Lees het script en keur het goed. Pas daarna maakt de werker de montage." };
    return { kind: "script", videoId: video.id, version: latest.version + 1, text: "Het laatste script is afgekeurd: laat een nieuwe versie schrijven." };
  }

  const jobs = state.montage?.jobs.filter((j) => j.script_id === approved.id) ?? [];
  if (jobs.some((j) => running(j.status))) return { kind: "rendering", text: "De werker maakt de montage met stem; volg het in Live." };
  const renders = state.montage?.renders.filter((r) => r.video_id === video.id && r.script_id === approved.id) ?? [];
  if (!renders.length || video.status === "scripted" || video.status === "idea") return { kind: "render", script: approved, attempt: jobs.length + 1, text: "Alles staat klaar: start de montage." };
  if (video.status === "review") return { kind: "review", text: "De montage is klaar. Bekijk hem in de Productiestudio en keur de video goed of af." };
  if (video.status === "approved") return { kind: "publish", text: "Goedgekeurd. Vul het publicatiescherm in de Productiestudio in; publiceren doe je zelf." };
  return { kind: "done", text: video.status === "published" ? "Deze video is gepubliceerd." : video.status === "scheduled" ? "Deze video is ingepland." : "Deze video is klaar." };
}

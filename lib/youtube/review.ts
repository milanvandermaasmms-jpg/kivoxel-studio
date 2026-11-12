// Fase 1 of the viral engine: honest status per step of the production line, and the gate before a
// finished montage may be approved. Pure functions, so the rules are tested without a database.
import type { PrivacyFlag } from "./analysis";

export type StepState = "works" | "connect" | "later" | "offline";
export type PipelineStep = { key: string; label: string; state: StepState; note: string };

export type PipelineInput = {
  /** undefined while checking, null when the worker on the pc is not reachable. */
  worker: { ffmpeg: string | null; analysis: string | null; voice: boolean; youtube?: boolean } | null | undefined;
  /** Migration 009 has run and paid processing is switched on with a cap. */
  paidEnabled: boolean;
  /** Migration 030 has run (renders and voice settings). */
  montageReady: boolean;
  /** Migration 031 has run (fixed corners blurred, game sound muted when a voice is heard). */
  privacyReady?: boolean;
};

/** Every step of the line, from upload to publication, with what it needs right now. */
export function pipelineSteps({ worker, paidEnabled, montageReady, privacyReady = false }: PipelineInput): PipelineStep[] {
  const off = worker === null || worker === undefined;
  const needsWorker = (state: StepState, note: string): Pick<PipelineStep, "state" | "note"> => (off ? { state: "offline", note: "Start de werker op de pc." } : { state, note });
  const ffmpeg = !!worker?.ffmpeg;
  const realAnalysis = !!worker?.analysis && paidEnabled;
  return [
    { key: "upload", label: "Uploaden", ...needsWorker("works", "Met voortgang, hervatten en herkenning van dubbele opnames.") },
    { key: "intake", label: "Intake", ...needsWorker(ffmpeg ? "works" : "connect", ffmpeg ? "FFmpeg leest lengte, beeld en geluid uit." : "FFmpeg niet gevonden op de pc.") },
    {
      key: "analyse",
      label: "Analyse en script",
      ...needsWorker(
        realAnalysis ? "works" : "connect",
        realAnalysis ? "Gemini zoekt momenten en schrijft scripts, binnen het maandplafond." : !worker?.analysis ? "Gemini-sleutel ontbreekt op de pc; alleen testdata wordt (gratis) verwerkt." : "Zet betaalde verwerking aan bij Instellingen; alleen testdata wordt (gratis) verwerkt.",
      ),
    },
    { key: "montage", label: "Montage", ...needsWorker(montageReady && ffmpeg ? "works" : "connect", montageReady ? "Shorts verticaal, lange video's horizontaal, met ondertitels." : "Komt er met migratie 030.") },
    { key: "voice", label: "Stem", ...needsWorker(worker?.voice ? "works" : "connect", worker?.voice ? "Google TTS, alleen binnen het gratis deel." : "Google TTS-sleutel ontbreekt op de pc; montages komen er zonder stem.") },
    privacyReady
      ? { key: "privacy", label: "Vervagen en dempen", state: "works", note: "Vaste PS5-hoeken vervaagd; gamegeluid uit bij een stem. Controleer in de preview." }
      : { key: "privacy", label: "Vervagen en dempen", state: "connect", note: "Komt er met migratie 031. Tot die tijd kan een video met een privacyvlag niet worden goedgekeurd." },
    { key: "review", label: "Video goedkeuren", state: "works", note: "Na de preview, per video." },
    { key: "publish", label: "Publiceren op YouTube", ...needsWorker(worker?.youtube ? "works" : "connect", worker?.youtube ? "Privé uploaden, inplannen of publiceren; elke stap pas na jouw klik." : "Koppel YouTube bij Instellingen.") },
    { key: "business", label: "Businesscase en kosten", state: "later", note: "Pakket 55." },
    { key: "analytics", label: "Cijfers en signaleringen", ...needsWorker(worker?.youtube ? "works" : "connect", worker?.youtube ? "Elk uur bijgewerkt; zie het tabblad Cijfers. Experimenten (Growth Lab) komen later." : "Koppel YouTube bij Instellingen.") },
  ];
}

export type ReviewInput = {
  approvedScriptId: string | null;
  /** The newest montage of this video, if any. */
  latestRender: { script_id: string; privacy_blur?: boolean; game_muted?: boolean } | null;
  renderBusy: boolean;
  privacyFlags: PrivacyFlag[];
};

/** Why a finished montage cannot be approved yet; an empty list means it can. */
export function reviewBlockers({ approvedScriptId, latestRender, renderBusy, privacyFlags }: ReviewInput): string[] {
  const reasons: string[] = [];
  if (!approvedScriptId) reasons.push("Er is geen goedgekeurd script.");
  else if (renderBusy) reasons.push("De montage is nog bezig.");
  else if (!latestRender) reasons.push("Er is nog geen montage.");
  else if (latestRender.script_id !== approvedScriptId) reasons.push("De nieuwste montage hoort bij een ander script. Maak de montage opnieuw.");
  if (privacyFlags.includes("face")) reasons.push("Er is een gezicht in beeld. Deze video kan niet online.");
  if (VISUAL.some((f) => privacyFlags.includes(f)) && !latestRender?.privacy_blur) reasons.push("Er staat een gamertag, chat of melding in beeld. Maak de montage opnieuw met vervaagde hoeken.");
  if (privacyFlags.includes("voice") && !latestRender?.game_muted) reasons.push("Er is een stem te horen. Maak de montage opnieuw met het gamegeluid uit.");
  return reasons;
}

const VISUAL: PrivacyFlag[] = ["gamertag", "chat", "notification"];

/** What to look at in the preview before approving, when blurring and muting were applied. */
export function reviewChecks(privacyFlags: PrivacyFlag[]): string[] {
  const out: string[] = [];
  if (VISUAL.some((f) => privacyFlags.includes(f))) out.push("Kijk of de gamertag, chat of melding onder een vervaagde hoek valt. Een naam boven een speler midden in beeld wordt niet vervaagd.");
  if (privacyFlags.includes("voice")) out.push("Luister of er geen stem meer te horen is.");
  return out;
}

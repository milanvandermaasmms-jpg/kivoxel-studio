// Live Production Center: what the worker tells about each step. Shared by the worker (writes) and the dashboard
// (reads). The notes are built from the real outcome of a step, never from a template with invented numbers.
// Not imported from studio.ts: that file loads the browser's Supabase client, which the worker must not load.
import { HOOK_TYPE_LABEL, type HookType } from "./hooks.ts";
function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** What the worker is doing at the start of a step (shown as the phase). */
export const STEP_PHASE: Record<string, string> = {
  intake: "Opname uitlezen met FFmpeg",
  suggest: "AI-suggesties maken",
  viral: "Viral-check: video toetsen",
  reference: "Referentievideo's ophalen bij YouTube",
  analyse: "Gameplay analyseren",
  script: "Script schrijven",
  render: "Montage voorbereiden",
  upload: "Upload voorbereiden",
  publish: "Zichtbaarheid bijwerken",
};

/** Shown when a step completes. */
export const STEP_MILESTONE: Record<string, string> = {
  intake: "Gameplay ingelezen",
  suggest: "Suggesties voor tags, titels en beschrijving klaar",
  viral: "Viral-score klaar",
  reference: "Referentievideo's bijgewerkt",
  analyse: "Momenten geselecteerd",
  script: "Script geschreven",
  render: "Montage klaar, preview beschikbaar",
  upload: "Op YouTube gezet",
  publish: "Zichtbaarheid bij YouTube bijgewerkt",
};

const amsterdam = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" });
const STATE_WORD: Record<string, string> = { published: "Gepubliceerd", scheduled: "Ingepland", uploaded: "Privé" };

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Short notes about what a step really did, from the result the worker stored. */
export function stepNotes(step: string, result: Record<string, unknown> | null | undefined): string[] {
  if (!result) return [];
  const notes: string[] = [];
  if (step === "intake") {
    const ms = n(result.durationMs);
    const w = n(result.width);
    const h = n(result.height);
    if (ms !== null) notes.push(`Opname van ${formatDuration(ms)}${w && h ? `, ${w}×${h}` : ""}`);
  } else if (step === "analyse") {
    const moments = n(result.moments);
    const usable = n(result.usable);
    const videos = n(result.videos);
    if (result.source === "test") notes.push("Testanalyse met vaste posities (geen AI)");
    if (moments !== null) notes.push(`${moments} ${moments === 1 ? "moment" : "momenten"} gevonden${usable !== null ? `, ${usable} met context en afloop` : ""}`);
    if (videos !== null) notes.push(`${videos} ${videos === 1 ? "video" : "video's"} voorgesteld`);
  } else if (step === "viral") {
    const o = n(result.overall);
    if (o !== null) notes.push(`Viral-score ${o.toLocaleString("nl-NL")} van 10 (stem ${n(result.voice) ?? "–"}, script ${n(result.script) ?? "–"}, gameplay ${n(result.gameplay) ?? "–"}); een voorspelling, geen garantie`);
  } else if (step === "reference") {
    const saved = n(result.saved);
    if (saved !== null) notes.push(`${saved} referentievideo's opgeslagen`);
  } else if (step === "script") {
    const version = n(result.version);
    const ms = n(result.targetMs);
    if (version !== null) notes.push(`Script versie ${version}${ms !== null ? `, lengte ${formatDuration(ms)}` : ""}`);
    const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
    if (warnings) notes.push(`${warnings} ${warnings === 1 ? "waarschuwing" : "waarschuwingen"} bij het montageplan`);
    const hooks = n(result.hooks);
    if (hooks) notes.push(`${hooks} ${hooks === 1 ? "hookvariant" : "hookvarianten"} geschreven`);
  } else if (step === "upload") {
    const bytes = n(result.bytes);
    if (result.adopted) notes.push("Stond al op YouTube: overgenomen, niet opnieuw geüpload");
    else if (bytes) notes.push(`${(bytes / 1048576).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB geüpload`);
    if (typeof result.youtube_video_id === "string") notes.push(`${STATE_WORD[String(result.status)] ?? "Privé"} op YouTube: https://youtu.be/${result.youtube_video_id}`);
    if (typeof result.publish_at === "string") notes.push(`Gaat openbaar op ${amsterdam(result.publish_at)}`);
    if (result.processed === false) notes.push("YouTube was na 10 minuten nog bezig met verwerken; dat gaat vanzelf verder");
  } else if (step === "publish") {
    const id = typeof result.youtube_video_id === "string" ? result.youtube_video_id : "";
    if (result.extras) {
      if (typeof result.captions === "string") notes.push(`Ondertitels: ${result.captions}`);
      if (typeof result.thumbnail === "string") notes.push(`Thumbnail: ${result.thumbnail}`);
    } else if (result.status === "published") notes.push(`Gepubliceerd: https://youtu.be/${id}`);
    else if (result.status === "scheduled" && typeof result.publish_at === "string") notes.push(`Ingepland: gaat openbaar op ${amsterdam(result.publish_at)}`);
    else notes.push("Weer privé op YouTube");
  } else if (step === "render") {
    const from = n(result.recordingMs);
    const to = n(result.durationMs);
    if (from !== null && to !== null) notes.push(`Lengte teruggebracht van ${formatDuration(from)} naar ${formatDuration(to)}`);
    const segments = n(result.segments);
    if (segments !== null) notes.push(`${segments} ${segments === 1 ? "fragment" : "fragmenten"} gemonteerd`);
    const blurred = n(result.blurredRegions);
    if (blurred) notes.push(`${blurred} ${blurred === 1 ? "hoek" : "hoeken"} vervaagd`);
    if (result.gameMuted === true) notes.push("Gamegeluid gedempt (stem van een ander gehoord)");
    notes.push(typeof result.voice === "string" ? `Stem: ${result.voice}` : typeof result.note === "string" ? result.note : "Zonder stem");
    if (typeof result.hookType === "string") notes.push(`Hook: ${HOOK_TYPE_LABEL[result.hookType as HookType] ?? result.hookType}${result.coldOpen === true ? ", opent met het hoogtepunt" : ""}`);
    const qc = result.qc as { green?: number; orange?: number; red?: number; lufs?: number | null } | null | undefined;
    if (qc && typeof qc.green === "number") notes.push(`Kwaliteitscontrole: ${qc.green} goed, ${qc.orange ?? 0} let op, ${qc.red ?? 0} rood${typeof qc.lufs === "number" ? `; luidheid ${qc.lufs.toLocaleString("nl-NL")} LUFS` : ""}`);
  }
  return notes;
}

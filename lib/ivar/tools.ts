// Ivar's tools: name, kind and validated input. The handlers live in worker/ivar/tools.ts (server side, service key on
// the pc). "read" only reads, "draft" changes a concept that can be undone, "job" puts a step in the existing queue and
// only runs on a concrete request (lib/ivar/intent.ts). There is no tool that publishes, deletes or runs SQL. Pure.
import { uuid, type ObjectSchema } from "./schema.ts";
import type { ToolKind } from "./intent.ts";

export type ToolDef = { name: string; kind: ToolKind; description: string; input: ObjectSchema };

const obj = (properties: ObjectSchema["properties"], required: string[] = []): ObjectSchema => ({ type: "object", properties, required });
const text = (maxLength: number, description?: string) => ({ type: "string" as const, maxLength, description });
const ms = (description: string) => ({ type: "integer" as const, min: 0, max: 6 * 3_600_000, description });
const KIND = { type: "string" as const, maxLength: 10, enum: ["recording", "video", "episode"] as const, description: "recording = KIVOXEL-opname, video = KIVOXEL-video (Short of lang), episode = Dreamnest-aflevering" };

export const TOOLS: ToolDef[] = [
  // ---------- read ----------
  { name: "list_channels", kind: "read", description: "De kanalen van deze studio met naam, soort en status.", input: obj({}) },
  {
    name: "list_projects",
    kind: "read",
    description: "Opnames, video's (KIVOXEL) of afleveringen (Dreamnest) van het kanaal in de scope, nieuwste eerst. Zoek op titel met query.",
    input: obj({ query: text(80, "Deel van de titel"), limit: { type: "integer", min: 1, max: 25 } }),
  },
  { name: "get_project", kind: "read", description: "Alles over één project: status, script, montage, publicatieconcept, momenten met tijdcodes, lopende stappen.", input: obj({ kind: KIND, id: uuid("Project-ID") }, ["kind", "id"]) },
  { name: "get_channel_guidelines", kind: "read", description: "Kanaalrichtlijnen: doelgroep, taal, verboden woorden, stem, en wat in het geheugen staat.", input: obj({}) },
  { name: "get_transcript", kind: "read", description: "De voice-overtekst van een KIVOXEL-video met tijdcodes (de nieuwste versie). Gameplay zelf heeft geen gesproken tekst.", input: obj({ video_id: uuid("Video-ID") }, ["video_id"]) },
  { name: "get_quality_report", kind: "read", description: "Bewijs voor een kwaliteitsoordeel: meetwaarden van de laatste montage (lengte, luidheid, controles), de viral-check met tijdcodes, en stille/dode stukken.", input: obj({ video_id: uuid("Video-ID") }, ["video_id"]) },
  { name: "get_analytics", kind: "read", description: "Echte YouTube-cijfers (weergaven, kijkduur, behoud) van een video of het kanaal. Zegt het eerlijk als er (nog) te weinig data is.", input: obj({ video_id: uuid("Video-ID (leeg = kanaal)") }) },
  { name: "list_tasks", kind: "read", description: "Lopende en recente stappen (analyse, script, montage, upload, Dreamnest) met hun echte status.", input: obj({ active_only: { type: "boolean" } }) },
  // ---------- draft (reversible) ----------
  {
    name: "save_idea",
    kind: "draft",
    description: "Sla een videoconcept op als idee voor het kanaal in de scope (werknaam, premisse, opening, bronmateriaal, mogelijke Shorts). Het is een idee, geen opdracht.",
    input: obj(
      { title: text(120), premise: text(1000), opening: text(500), source_material: text(500), shorts: { type: "array", maxItems: 5, items: text(200) } },
      ["title", "premise"],
    ),
  },
  {
    name: "propose_titles",
    kind: "draft",
    description: "Leg 1 tot 3 titelvoorstellen met toelichting klaar voor een video. Er verandert niets tot Milan op 'Als concept toepassen' klikt.",
    input: obj({ video_id: uuid("Video-ID"), options: { type: "array", minItems: 1, maxItems: 3, items: obj({ title: text(100), why: text(200) }, ["title", "why"]) } }, ["video_id", "options"]),
  },
  {
    name: "update_metadata_draft",
    kind: "draft",
    description: "Wijzig het publicatieconcept (titel, beschrijving, tags) van een video. apply=true past het meteen toe als concept (altijd terug te draaien); apply=false toont alleen het voorstel. Nooit publiceren.",
    input: obj({ video_id: uuid("Video-ID"), title: text(100), description: text(5000), tags: { type: "array", maxItems: 30, items: text(60) }, apply: { type: "boolean" }, note: text(300) }, ["video_id", "apply"]),
  },
  {
    name: "save_voiceover_text",
    kind: "draft",
    description: "Nieuwe tekst voor regels van de voice-over (zelfde timing), als nieuwe conceptversie van het script. De vorige versie blijft bewaard; Milan keurt goed.",
    input: obj({ video_id: uuid("Video-ID"), lines: { type: "array", minItems: 1, maxItems: 40, items: obj({ index: { type: "integer", min: 0, max: 200 }, text: text(300) }, ["index", "text"]) }, note: text(300) }, ["video_id", "lines", "note"]),
  },
  {
    name: "propose_edit",
    kind: "draft",
    description: "Editvoorstel: knip stukken uit de montage (tijdcodes van de eindvideo). Wordt een nieuwe conceptversie van het script; bron en vorige versies blijven. Milan keurt goed, daarna kan de montage.",
    input: obj({ video_id: uuid("Video-ID"), cuts: { type: "array", minItems: 1, maxItems: 8, items: obj({ from_ms: ms("Begin in de eindvideo"), to_ms: ms("Einde in de eindvideo") }, ["from_ms", "to_ms"]) }, note: text(300) }, ["video_id", "cuts", "note"]),
  },
  {
    name: "show_analysis",
    kind: "draft",
    description: "Toon een videoanalyse als kaart: observaties en prioriteiten met tijdcodes, wat onzeker is, en welke bronnen echt zijn bekeken. Alleen op basis van gelezen data.",
    input: obj(
      {
        video_id: uuid("Video-ID (optioneel)"),
        project_label: text(120),
        whole_video: { type: "boolean", description: "Is de hele video bekeken (true) of alleen een deel?" },
        audio_analysed: { type: "boolean", description: "Is de audio echt geanalyseerd?" },
        sources: { type: "array", maxItems: 6, items: text(120) },
        observations: { type: "array", minItems: 1, maxItems: 8, items: obj({ at_ms: ms("Tijdcode"), text: text(300) }, ["text"]) },
        priorities: { type: "array", maxItems: 5, items: obj({ at_ms: ms("Tijdcode"), text: text(300) }, ["text"]) },
        uncertain: { type: "array", maxItems: 5, items: text(300) },
      },
      ["project_label", "whole_video", "audio_analysed", "sources", "observations"],
    ),
  },
  {
    name: "save_memory",
    kind: "draft",
    description: "Leg een blijvende voorkeur of afspraak vast. scope: studio, channel of project. confirmed=true alleen als Milan het expliciet vroeg ('onthoud', 'voortaan'); anders wordt het een vraag aan Milan. Een brainstormidee is geen voorkeur.",
    input: obj({ content: text(500), scope: { type: "string", maxLength: 10, enum: ["studio", "channel", "project"] }, confirmed: { type: "boolean" } }, ["content", "scope", "confirmed"]),
  },
  // ---------- jobs (existing queue) ----------
  {
    name: "start_analysis",
    kind: "job",
    description: "Analyse van een opname (momenten zoeken, Shorts en lange video plannen). mode: first (eerste keer), again (opnieuw), series (lange opname vertellen in delen Deel 1..N, uit opgeslagen momenten). Betaalde stappen krijgen eerst een kostenkaart voor Milan.",
    input: obj({ recording_id: uuid("Opname-ID"), mode: { type: "string", maxLength: 6, enum: ["first", "again", "series"] } }, ["recording_id", "mode"]),
  },
  { name: "start_render", kind: "job", description: "Start de montage (render) van een video met een goedgekeurd script. Gratis (FFmpeg op de pc). Nooit dubbel.", input: obj({ video_id: uuid("Video-ID") }, ["video_id"]) },
  { name: "start_quality_check", kind: "job", description: "Viral-check/kwaliteitscontrole van de nieuwste montage. Kan een klein betaald luisterdeel hebben: eerst een kostenkaart.", input: obj({ video_id: uuid("Video-ID") }, ["video_id"]) },
  { name: "shorts_from_recording", kind: "job", description: "Shorts uit een opname: toont de Shorts die uit de momenten gepland zijn en hun status. Analyseert eerst (met kostenkaart) als dat nog niet gebeurd is.", input: obj({ recording_id: uuid("Opname-ID"), count: { type: "integer", min: 1, max: 6 } }, ["recording_id"]) },
  { name: "cancel_task", kind: "job", description: "Annuleer een wachtende of lopende stap (yt = KIVOXEL, dn = Dreamnest).", input: obj({ job_id: uuid("Stap-ID"), queue: { type: "string", maxLength: 2, enum: ["yt", "dn"] } }, ["job_id", "queue"]) },
  { name: "retry_task", kind: "job", description: "Zet een mislukte of geannuleerde KIVOXEL-stap opnieuw in de wachtrij (dezelfde stap: geen tweede betaalde reservering, geen tweede upload).", input: obj({ job_id: uuid("Stap-ID") }, ["job_id"]) },
  { name: "prepare_publish", kind: "read", description: "Als Milan expliciet vraagt om te publiceren: controleer kanaal, bestand, zichtbaarheid en tijdstip en toon de publicatiekaart. Ivar publiceert nooit zelf; de klik is van Milan.", input: obj({ video_id: uuid("Video-ID") }, ["video_id"]) },
];

export const TOOL_BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Things people may ask that Ivar honestly cannot do (yet). */
export const NOT_AVAILABLE = [
  "publiceren of inplannen zelf uitvoeren (dat blijft jouw klik in het publicatiescherm)",
  "video's of opnames definitief verwijderen, of bronmateriaal overschrijven",
  "Dreamnest-stappen starten (beeld, animatie, muziek kosten Google-tegoed): dat doe je in de Dreamnest-werkbank",
  "nieuwe beelden of video genereren",
  "spraak in de gameplay uitschrijven (er is geen transcriptie van de opname, alleen de voice-overtekst)",
  "berichten of e-mails versturen",
];

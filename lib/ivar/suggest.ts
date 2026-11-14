// Quiet suggestions under an empty chat, from the real state of the project in scope. Never a pop-up. Pure, tested.
import type { ChannelKind, ProjectKind } from "./types";

export type ProjectState = {
  kind: ProjectKind;
  /** yt_videos.status, yt_recordings.status or dn_episodes.status */
  status: string;
  analysed?: boolean;
  hasRender?: boolean;
  onYouTube?: boolean;
  hasStats?: boolean;
};

export function suggestions(channel: ChannelKind | null, project: ProjectState | null): string[] {
  if (!channel) return ["Welk kanaal heeft nu de meeste aandacht nodig?", "Wat staat er klaar om te keuren?"];
  if (!project) {
    return channel === "dreamnest"
      ? ["Bedenk vijf nieuwe video's voor Lumi", "Welke video moeten we hierna maken?"]
      : ["Welke video moeten we hierna maken?", "Wat kunnen we bij de volgende video verbeteren?"];
  }
  if (project.kind === "episode") return project.status === "concept" ? ["Help me met het concept", "Maak een productieplan"] : ["Waar is deze aflevering nu mee bezig?", "Waarom voelt deze video nog zo statisch?"];
  if (project.kind === "recording") return project.analysed ? ["Zoek geschikte Shortmomenten", "Analyseer het begin"] : ["Analyseer deze opname", "Wat kan ik van deze opname maken?"];
  if (project.onYouTube) return project.hasStats ? ["Analyseer deze resultaten", "Wat kunnen we bij de volgende video verbeteren?"] : ["Hoe doet deze video het?", "Wat kunnen we bij de volgende video verbeteren?"];
  if (project.hasRender || ["review", "approved"].includes(project.status)) return ["Controleer de kwaliteit", "Maak drie titels voor deze video"];
  if (project.status === "rendering") return ["Waar is mijn render nu mee bezig?"];
  return ["Bekijk waar de intro te langzaam is", "Maak drie titels voor deze video"];
}

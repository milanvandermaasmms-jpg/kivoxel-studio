// What kind of message is this? Ivar may only start work (analysis, montage, cancelling) on a concrete request;
// a brainstorm or a question never starts anything, and nothing ever publishes. Pure, tested.

export type Intent = "action" | "progress" | "brainstorm" | "question";

const ACTION = [
  /\b(maak|maken|start|begin|render|renderen|monteer|analyseer|analyseren|zet|pas\b.*\btoe|verander|wijzig|herschrijf|kort\b.*\bin|korter|langer|annuleer|stop de|probeer\b.*\bopnieuw|vertel\b.*\bin delen|sla\b.*\bop|bewaar|onthoud|plan|verwijder|knip|haal\b.*\bweg|controleer|check)\b/i,
  /\b(make|create|start|render|analy[sz]e|apply|change|rewrite|shorten|cancel|retry|save|remember|cut|trim|check)\b/i,
];
const PROGRESS = /\b(waar is|hoe ver|hoe lang nog|status|voortgang|al klaar|is .* klaar|bezig met|loopt er)\b|\bprogress\b/i;
const BRAINSTORM = /\b(bedenk|ideeën|idee|brainstorm|sparren|wat vind je|waarom|hoe kan|hoe kunnen|wat als|zou het|wat denk je|welke video|wat kunnen we)\b/i;

export function classifyIntent(text: string): Intent {
  const t = text.trim();
  if (PROGRESS.test(t) && !/\b(maak|start|annuleer|stop de)\b/i.test(t)) return "progress";
  const action = ACTION.some((r) => r.test(t));
  // "Bedenk vijf video's" asks for ideas, not for production; "maak drie titels" is a concrete (reversible) request.
  if (BRAINSTORM.test(t) && !/\b(maak|start|render|analyseer|annuleer|pas\b.*\btoe|sla\b.*\bop)\b/i.test(t)) return "brainstorm";
  if (action) return "action";
  return "question";
}

/** Explicit "remember this" (voortaan, onthoud): only then does Ivar store a memory without asking. */
export const asksToRemember = (text: string) => /\b(onthoud|voortaan|vanaf nu|altijd|nooit meer|remember|from now on)\b/i.test(text);

/** Explicit publish request: Ivar then shows the publish card (checks), the click itself stays Milan's. */
export const asksToPublish = (text: string) => /\b(publiceer|publiceren|upload\b.*\bnaar youtube|zet\b.*\bop youtube|publish)\b/i.test(text);

export type ToolKind = "read" | "draft" | "job";

/** Can this tool run for this message? A job never runs from a brainstorm or a question. */
export function toolAllowed(kind: ToolKind, intent: Intent): { ok: true } | { ok: false; why: string } {
  if (kind !== "job") return { ok: true };
  if (intent === "action") return { ok: true };
  return { ok: false, why: "Dit was geen concrete opdracht (sparren of een vraag), dus Ivar start niets. Vraag het met bijvoorbeeld 'start de montage' als je dat wilt." };
}

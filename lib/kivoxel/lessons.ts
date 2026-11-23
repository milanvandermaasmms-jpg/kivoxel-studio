// 23-11-2026 (Milan): the studio learns from his rejections, simply and checkably. His reasons are sorted into kinds of
// mistakes per channel and format. A kind seen at least twice becomes a lesson the script writer gets for the next
// comparable production; once is only a hypothesis (one outlier never becomes a rule). Every lesson shows where it
// comes from (which videos, how many), and the producer dossier says which lesson was applied. Reversible: a lesson is
// computed from the rejections every time, never stored as a rule. Pure, tested.

export type Rejection = { title: string; note: string; at: string };
export type LessonKey = "geen_actie" | "tekst_klopt_niet" | "crop" | "uitkomst" | "opening" | "stem" | "muziek";
export type Lesson = { key: LessonKey; rule: string; label: string; count: number; examples: { title: string; note: string; at: string }[]; status: "regel" | "hypothese" };

const KINDS: { key: LessonKey; label: string; match: RegExp; rule: string }[] = [
  { key: "geen_actie", label: "Er gebeurt te weinig", match: /geen (goede )?content|gebeurt niks|gebeurt niets|saai|zwak|te weinig|verkeerde clip|alleen lucht|menu|inventaris/i, rule: "Milan rejected Shorts where little visibly happens (menus, inventory, only sky). Only write tension for what the event list really shows; never promise action the clip does not have." },
  { key: "tekst_klopt_niet", label: "Tekst klopt niet met het beeld", match: /tekst klopt niet|klopt niet|gekke tekst|niet waar|hearts?|hartjes|health|not true|klopt het niet/i, rule: "Milan rejected texts that did not match the picture (wrong health, wrong events). Never mention hearts, health or anything not in the event list; when unsure, say less." },
  { key: "crop", label: "Uitsnede", match: /crop|uitsnede|uit beeld|buiten beeld/i, rule: "Milan rejected a crop that lost the action. Keep the subject in the middle of the vertical crop." },
  { key: "uitkomst", label: "Uitkomst niet te zien", match: /payoff|uitkomst|afgekapt|te vroeg (af|gestopt)|einde/i, rule: "Milan rejected endings that cut off the outcome. Leave the outcome on screen and do not talk over it." },
  { key: "opening", label: "Zwakke opening", match: /opening|begin|hook/i, rule: "Milan rejected weak openings. The first line names something specific the viewer can see or hear right now." },
  { key: "stem", label: "Stem", match: /\bstem\b|voice|\bai\b|robot|onnatuurlijk/i, rule: "Milan rejected a voice-over that sounded like AI. Short, natural sentences; no shouting, no stacked exclamations." },
  { key: "muziek", label: "Muziek", match: /muziek|music/i, rule: "Milan rejected the music choice. Let the game sound carry the key moment." },
];

/** System notes the studio wrote itself (not Milan's judgement). */
const SYSTEM = /^(Niet gebruikt|Vervangen|Producer:|test$|Eindredacteur:)/i;

export function lessonsFrom(rejections: Rejection[]): Lesson[] {
  const mine = rejections.filter((r) => r.note.trim() && !SYSTEM.test(r.note.trim()));
  const out: Lesson[] = [];
  for (const k of KINDS) {
    const hits = mine.filter((r) => k.match.test(r.note)).sort((a, b) => b.at.localeCompare(a.at));
    if (!hits.length) continue;
    out.push({ key: k.key, rule: k.rule, label: k.label, count: hits.length, examples: hits.slice(0, 3).map((h) => ({ title: h.title, note: h.note.slice(0, 120), at: h.at })), status: hits.length >= 2 ? "regel" : "hypothese" });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** The lines for the script writer: only lessons that are rules (seen at least twice). */
export const lessonPrompt = (lessons: Lesson[]) => lessons.filter((l) => l.status === "regel").map((l) => `- ${l.rule} (seen ${l.count}×)`);

/** One sentence for the dossier: which lesson was applied, with its origin. */
export function lessonSentence(l: Lesson): string {
  const ex = l.examples[0];
  return `${l.label} (${l.count}× afgekeurd${l.status === "hypothese" ? ", nog een hypothese" : ""}): bij "${ex.title}" schreef Milan "${ex.note}". ${l.status === "regel" ? "Deze versie kreeg die les mee in de schrijfopdracht." : "Nog niet toegepast; pas na een tweede keer."}`;
}

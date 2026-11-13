// Poortwachter (fase B): the checks of migration 046 as a checklist for the app. Red blocks (the database refuses
// too), orange asks Milan to look, green is fine. Pure functions, no database.
import type { PrivacyFlag } from "./analysis";
import type { Channel } from "./channels";

export type GateLevel = "green" | "orange" | "red";
export type GateItem = { key: string; label: string; level: GateLevel; note: string };
export type GateChannel = Pick<Channel, "name"> & Partial<Pick<Channel, "safety_profile" | "banned_words" | "synthetic_media">>;
export type GateScript = { top_line: string | null; hook: string; lines: { text: string }[]; loop_line?: string | null; hooks?: { first_line: string; overlay: string }[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first word of the list that appears as a whole word (any case), like yt_term_hit in the database. */
export function termHit(text: string, terms: string[]): string | null {
  for (const raw of terms) {
    const t = raw.trim();
    if (t.length < 2) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) return raw;
  }
  return null;
}

/** An e-mail address or Dutch phone number, like yt_personal_data in the database. */
export function personalData(text: string): string | null {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return "een e-mailadres";
  if (/(\+31|0031|(^|[^0-9])0)[ .-]?[1-9]([ .-]?[0-9]){8}([^0-9]|$)/.test(text)) return "een telefoonnummer";
  return null;
}

/** A Dutch postcode (1234 AB): only orange, because a number and two capitals can also be something else. */
export const postcode = (text: string) => /(^|[^0-9])[1-9][0-9]{3} ?[A-Z]{2}([^A-Za-z]|$)/.test(text);

export function scriptText(s: GateScript | null | undefined): string {
  if (!s) return "";
  return [s.top_line, s.hook, s.loop_line, ...s.lines.map((l) => l.text), ...(s.hooks ?? []).flatMap((h) => [h.first_line, h.overlay])].filter(Boolean).join(" ");
}

const item = (key: string, label: string, level: GateLevel, note = ""): GateItem => ({ key, label, level, note });

/** Checks on what the video says and shows: for the concept (Keur 1) and the final version (Keur 2). */
export function videoGate({ script, channel, privateTerms, flags }: { script: GateScript | null | undefined; channel: GateChannel | null; privateTerms: string[]; flags: PrivacyFlag[] }): GateItem[] {
  const text = scriptText(script);
  const out: GateItem[] = [];
  const priv = termHit(text, privateTerms);
  out.push(priv ? item("script-private", "Privé-woorden in het script", "red", `Het script noemt "${priv}". Pas het script aan.`) : item("script-private", "Privé-woorden in het script", "green", privateTerms.length ? "" : "Er staan nog geen privé-woorden in de lijst (Instellingen)."));
  const banned = termHit(text, channel?.banned_words ?? []);
  out.push(banned ? item("script-banned", "Verboden woorden in het script", "red", `"${banned}" mag niet op ${channel?.name ?? "dit kanaal"}.`) : item("script-banned", "Verboden woorden in het script", "green"));
  const data = personalData(text);
  out.push(data ? item("script-data", "Persoonsgegevens in het script", "red", `Het script bevat ${data}.`) : postcode(text) ? item("script-data", "Persoonsgegevens in het script", "orange", "Er staat iets dat op een postcode lijkt. Kijk het na.") : item("script-data", "Persoonsgegevens in het script", "green"));
  out.push(flags.includes("face") ? item("face", "Gezichten", "red", "Er is een gezicht in beeld. Deze video kan niet online.") : item("face", "Gezichten", "green"));
  if (flags.includes("real_name")) out.push(item("real-name", "Echte naam in beeld of geluid", "orange", "De analyse zag of hoorde een echte naam. Kijk de video na voordat je goedkeurt."));
  return out;
}

export type GateDraft = { title: string; description: string; tags: string[]; made_for_kids: boolean | null; contains_synthetic_media: boolean | null };

/** Checks before uploading to YouTube (on top of videoGate). */
export function publicationGate({ draft, channel, privateTerms }: { draft: GateDraft; channel: GateChannel | null; privateTerms: string[] }): GateItem[] {
  const text = [draft.title, draft.description, draft.tags.join(" ")].join(" ");
  const out: GateItem[] = [];
  const priv = termHit(text, privateTerms);
  out.push(priv ? item("text-private", "Privé-woorden in titel, beschrijving en tags", "red", `"${priv}" staat erin.`) : item("text-private", "Privé-woorden in titel, beschrijving en tags", "green"));
  const banned = termHit(text, channel?.banned_words ?? []);
  out.push(banned ? item("text-banned", "Verboden woorden", "red", `"${banned}" mag niet op ${channel?.name ?? "dit kanaal"}.`) : item("text-banned", "Verboden woorden", "green"));
  const data = personalData(text);
  out.push(data ? item("text-data", "Persoonsgegevens", "red", `De tekst bevat ${data}.`) : postcode(text) ? item("text-data", "Persoonsgegevens", "orange", "Er staat iets dat op een postcode lijkt. Kijk het na.") : item("text-data", "Persoonsgegevens", "green"));

  const sleep = channel?.safety_profile === "infant_sleep";
  if (draft.made_for_kids === null) out.push(item("kids", "Made for Kids", "red", "Kies zelf of de video voor kinderen gemaakt is."));
  else if (sleep && !draft.made_for_kids) out.push(item("kids", "Made for Kids", "red", "Een slaapvideo voor baby's is altijd Made for Kids."));
  else if (channel?.safety_profile === "kids_gaming" && !draft.made_for_kids) out.push(item("kids", "Made for Kids", "orange", "Minecraft voor jonge kijkers is bijna altijd Made for Kids. Weet je het zeker?"));
  else out.push(item("kids", "Made for Kids", "green", draft.made_for_kids ? "Ja: reacties, de bel, eindschermen en kaarten werken dan niet." : "Nee."));
  if (draft.made_for_kids && /eindscherm|end ?screen|abonneer|subscribe|meldingsbel|notification bell|link in de beschrijving|link below/i.test(text)) out.push(item("kids-cta", "Oproepen die bij Made for Kids niet werken", "orange", "Eindscherm, bel of 'abonneer' werken niet bij Made for Kids. Haal ze weg."));

  if (draft.contains_synthetic_media === null) out.push(item("ai", "AI-melding", "red", "Kies zelf of de video AI-beeld of -geluid bevat."));
  else if (channel?.synthetic_media && !draft.contains_synthetic_media) out.push(item("ai", "AI-melding", "red", "Dit kanaal gebruikt AI-beeld of AI-muziek: zet de AI-melding aan."));
  else out.push(item("ai", "AI-melding", "green"));

  if (sleep) out.push(/2 ?(m|meter)/i.test(draft.description) ? item("volume", "Volumetip", "green") : item("volume", "Volumetip", "red", "Zet in de beschrijving: apparaat minstens 2 meter van het bedje, volume laag."));
  if (/(^|[^\p{L}\p{N}])lumi($|[^\p{L}\p{N}])/iu.test(draft.title) && !/dreamnest/i.test(draft.title)) out.push(item("lumi", "Naam Lumi", "red", 'Noem Lumi in de titel altijd samen met Dreamnest ("Lumi van Dreamnest").'));
  return out;
}

export const hasRed = (items: GateItem[]) => items.some((i) => i.level === "red");

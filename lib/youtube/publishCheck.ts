// 23-11-2026 (Milan, superprompt V5 fase 19): the publication check before "Naar YouTube sturen". Ten points, each with
// what was checked and why; "blokkeert" stops the upload button, "let op" only warns, "zelf kijken" is something only
// Milan can judge (does the title fit the video). Nothing goes online automatically: publishing stays his click.
// Pure, tested.

import { looksDutch } from "../kivoxel/config";
import { hashtags, type PublicationDraft } from "./publication";

export type CheckStatus = "ok" | "blokkeert" | "let op" | "zelf kijken";
export type PublishItem = { key: string; label: string; status: CheckStatus; why: string };

export type PublishFacts = {
  /** yt_videos.status of the video. */
  videoStatus: string | null;
  kind: "short" | "long";
  gameName: string;
  /** Does the export exist on the pc (HEAD /renders/<file>)? null = not known (worker off). */
  exportOk: boolean | null;
  /** Export length and the format it should have. */
  durationMs: number | null;
  thumbnailChosen: boolean;
  thumbnailsAvailable: number;
  /** The channel the video goes to and whether its YouTube sign-in is there. */
  channel: { name: string; linked: boolean } | null;
  /** Music in this version: per file whether a licence is on record and the credit line (empty = none needed). */
  music: { file: string; licensed: boolean; credit: string }[];
  clonedVoice: boolean;
  /** The viral score status of this version, when there is one. */
  viralStatus?: string | null;
};

export function publishCheck(d: PublicationDraft, f: PublishFacts): PublishItem[] {
  const out: PublishItem[] = [];
  // 1. Goedgekeurd
  const approved = f.videoStatus === "approved" || f.videoStatus === "scheduled";
  out.push({ key: "approved", label: "Video goedgekeurd", status: approved ? "ok" : "blokkeert", why: approved ? "Jij hebt deze versie goedgekeurd." : "Keur de video eerst goed in de keuring." });
  // 2. Titel
  const t = d.title.trim();
  out.push(
    !t
      ? { key: "title", label: "Titel", status: "blokkeert", why: "Er is nog geen titel." }
      : looksDutch(t)
        ? { key: "title", label: "Titel", status: "blokkeert", why: `"${t}" lijkt Nederlands; video's zijn altijd Engels.` }
        : { key: "title", label: "Titel past bij de inhoud", status: "zelf kijken", why: `"${t}". Of de titel klopt met wat je ziet, kan alleen jij beoordelen.${t.toLowerCase().includes(f.gameName.toLowerCase()) ? "" : ` Tip: zet "${f.gameName}" vooraan.`}` },
  );
  // 3. Beschrijving
  const desc = d.description.trim();
  out.push(!desc ? { key: "description", label: "Beschrijving", status: "let op", why: "De beschrijving is leeg; een of twee zinnen helpen YouTube de video te plaatsen." } : looksDutch(desc) ? { key: "description", label: "Beschrijving", status: "blokkeert", why: "De beschrijving lijkt Nederlands; video's zijn altijd Engels." } : { key: "description", label: "Beschrijving", status: hashtags(desc) > 5 ? "let op" : "ok", why: hashtags(desc) > 5 ? `${hashtags(desc)} hashtags; 3 tot 5 werkt beter.` : "Ingevuld, in het Engels." });
  // 4. Tags
  const n = d.tags.length;
  const dutchTag = d.tags.find(looksDutch);
  out.push(dutchTag ? { key: "tags", label: "Tags", status: "blokkeert", why: `De tag "${dutchTag}" lijkt Nederlands.` } : { key: "tags", label: "Tags", status: n >= 3 && n <= 15 ? "ok" : "let op", why: n === 0 ? "Geen tags; 5 tot 15 passende tags helpen." : n < 3 ? `${n} tag(s); 5 tot 15 werkt beter.` : n > 15 ? `${n} tags; meer dan 15 heeft weinig zin.` : `${n} tags.` });
  // 5. Thumbnail
  out.push(f.kind === "short" ? { key: "thumbnail", label: "Thumbnail", status: "ok", why: "Een Short gebruikt een beeld uit de video; een eigen thumbnail is optioneel." } : { key: "thumbnail", label: "Thumbnail", status: f.thumbnailChosen ? "ok" : f.thumbnailsAvailable ? "let op" : "let op", why: f.thumbnailChosen ? "Gekozen." : f.thumbnailsAvailable ? `Nog niet gekozen (${f.thumbnailsAvailable} voorstellen klaar).` : "Nog geen thumbnail; kies een beeld." });
  // 6. Playlist
  out.push({ key: "playlist", label: "Playlist", status: "let op", why: "De studio zet video's (nog) niet in een playlist; doe dat zo nodig zelf in YouTube Studio." });
  // 7. Kanaal
  out.push(!f.channel ? { key: "channel", label: "Kanaal", status: "blokkeert", why: "Bij deze video hoort geen kanaal." } : { key: "channel", label: "Juiste kanaal", status: f.channel.linked ? "ok" : "blokkeert", why: f.channel.linked ? `Gaat naar ${f.channel.name}; de werker controleert vóór het uploaden nog eens of de aanmelding bij dat YouTube-kanaal hoort.` : `${f.channel.name} is niet met YouTube gekoppeld (Instellingen).` });
  // 8. Doelgroep en AI-melding
  if (d.made_for_kids === null) out.push({ key: "audience", label: "Doelgroep", status: "blokkeert", why: "Kies of de video voor kinderen gemaakt is (verplicht bij YouTube)." });
  else if (d.contains_synthetic_media === null) out.push({ key: "audience", label: "AI-melding", status: "blokkeert", why: "Kies of de video realistische AI-inhoud bevat." });
  else if (f.clonedVoice && !d.contains_synthetic_media) out.push({ key: "audience", label: "AI-melding", status: "blokkeert", why: "Deze versie heeft de gekloonde stem: YouTube verplicht dan de AI-melding." });
  else out.push({ key: "audience", label: "Doelgroep en AI-melding", status: "ok", why: `${d.made_for_kids ? "Voor kinderen" : "Niet voor kinderen gemaakt"}; AI-melding ${d.contains_synthetic_media ? "aan" : "uit"}.` });
  // 9. Muzieklicenties
  const unlicensed = f.music.filter((m) => !m.licensed);
  const credits = f.music.filter((m) => m.credit.trim());
  out.push(!f.music.length ? { key: "music", label: "Muzieklicentie", status: "ok", why: "Geen muziek in deze versie." } : unlicensed.length ? { key: "music", label: "Muzieklicentie", status: "blokkeert", why: `Geen licentie vastgelegd voor ${unlicensed.map((m) => m.file).join(", ")}.` } : { key: "music", label: "Muzieklicentie", status: "ok", why: credits.length ? `Licentie vastgelegd; de vermelding (${credits.length}) zet de werker zelf onder de beschrijving.` : "Licentie vastgelegd; geen vermelding nodig." });
  // 10. Export
  out.push(f.exportOk === false ? { key: "export", label: "Export compleet", status: "blokkeert", why: "Het videobestand staat niet (meer) op de pc." } : f.exportOk === null ? { key: "export", label: "Export compleet", status: "let op", why: "Niet te controleren: de werker antwoordt niet." } : { key: "export", label: "Export compleet", status: f.kind === "short" && (f.durationMs ?? 0) > 180_000 ? "blokkeert" : "ok", why: f.kind === "short" && (f.durationMs ?? 0) > 180_000 ? "Een Short mag hoogstens 3 minuten zijn." : `Staat op de pc${f.durationMs ? ` (${Math.round(f.durationMs / 1000)} s)` : ""}.` });
  // Extra: viral score (information, the 8.0 norm never blocks Milan's own choice).
  if (f.viralStatus && f.viralStatus !== "publicatiegereed") out.push({ key: "viral", label: "Viralscore", status: "let op", why: `Viralscore: ${f.viralStatus}. Je kunt toch publiceren; dat is jouw keuze.` });
  return out;
}

export const blocking = (items: PublishItem[]) => items.filter((i) => i.status === "blokkeert");

# Ivar: volgende opdrachten (plan, 14-11-2026)

Startpunt: branch `feature/ivar` = `feature/dreamnest` (37f8be8). Lees eerst `docs/ivar.md`.

## 1. Postadvies: wat en wanneer, met klaargezette kaarten
- Nieuwe pure module `lib/ivar/posting.ts`: beste momenten uit **eigen** cijfers (`yt_video_snapshots`: weergaven per uur/dag na publicatie per weekdag en uur, Short vs. lang) plus de niche (`yt_reference_videos.published_at` van de best scorende video's). Zonder genoeg eigen data: de vaste tijden van het kanaal (`publish_slots`), en dat eerlijk melden.
- Wat posten: uit "Klaar voor YouTube" kiezen op viral-score, inzichten (trend die past), afwisseling Short/lang en de verhaalvolgorde van delen (Deel 1 vóór Deel 2).
- Onderdeel van de weekronde (`insight`) als kind `tip` met een planning voor de komende 7 dagen, en tool `plan_posts`.
- Kaarten klaarzetten = publicatieconcept (`yt_publications`, status draft) met titel, beschrijving, tags en voorgesteld `publish_at`, via `ivar_revisions` (terug te draaien). **Inplannen/publiceren blijft Milans klik** (`request_yt_publish`).
- Ivar controleert zichzelf: na 7 en 28 dagen vergelijkt hij de video's op zijn tijdstip met de rest en leert daarvan (les in de weekronde).

## 2. Ivar blijft de beste: vaste verbeterlus (geen eenmalige taak)
- Elk advies krijgt een meetpunt (bijv. weergaven per dag na 7 dagen); de weekronde rapporteert "advies → resultaat" en past zijn eigen regels aan (als les, Milan omarmt).
- Tevredenheid: duim omhoog/omlaag bij antwoorden en kaarten (`ivar_actions`), meegenomen in de weekronde.
- Maandelijks rapport in Ivar: wat werkte, wat niet, wat hij anders gaat doen.

## 3. Verhaal, stem en Short-keuze op basis van YouTube-data
- Short-keuze: in `planVideos` een gewicht per soort moment (bijna-dood, zeldzame vondst, ...) uit onze eigen Shorts: weergaven per dag en kijkpercentage, gekoppeld via `yt_video_moments`. Alleen bij genoeg data; anders zoals nu.
- Verhaal: de omarmde lessen en trends van het kanaal gaan mee in `scriptPrompt` (kanaalrichtlijnen-blok), plus de beste openingen (hooks) uit onze eigen video's met het hoogste kijkpercentage in de eerste 30 s (`retention`).
- Stem: vergelijk kijkpercentage per stem en tempo (`yt_renders.voice_name`, `speaking_rate`); bij een duidelijk verschil een inzicht met het voorstel; de instelling wijzigen blijft Milans klik.
- Let op: `scriptPrompt`, `FORMAT_RULES` en de stemsnelheid zijn ook door een andere sessie aangepast; voeg alleen een blok toe en verander niets aan hun regels.

Kosten Gemini: ± 1-3 cent extra per kanaal per week. Migratie: waarschijnlijk geen (alles past in bestaande tabellen); anders eerst plan aan Milan.

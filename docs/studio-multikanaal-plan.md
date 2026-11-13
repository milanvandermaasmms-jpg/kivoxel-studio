# Multi-kanaal-Studio (KIVOXEL + Dreamnest NL): plan

Bron: `C:\Users\famdj\Downloads\SUPERPROMPT_STUDIO.md`. Opgesteld 13-11-2026. Niets gebouwd zolang Milan dit plan niet heeft goedgekeurd.

## Beslissingen van Milan (13-11-2026)

| Botsing | Besluit |
|---|---|
| Kinderen (superprompt: echte stem, facecam, voornaam) | **Huisregel blijft.** Maes nooit met gezicht, stem, naam of gamertag. AI-verteller + gameplay. Shorts met facecam/split-screen en "reactie van de kinderen" vervallen. De privacy-scan wordt wél gebouwd, als harde blokkade. |
| Kosten (superprompt: Claude, ElevenLabs, Suno, Kling/Veo/Runway) | **Wisselbaar, gratis standaard.** Provider-stekkers bouwen, maar alles draait op Gemini Flash-Lite (≤ € 5/maand) en Google TTS (gratis deel). Elke betaalde dienst pas na akkoord + budget van Milan. |
| Database (superprompt: familie-Supabase, schema `studio`) | **Eigen project `kivoxel-studio`**, de bestaande `yt_*`-tabellen uitbreiden. Geen herbouw, geen apart schema. |
| Dreamnest | **Eerst KIVOXEL.** Dreamnest krijgt alvast profiel, Lumi-bible, opdrachtscherm en de gratis checks; de dure render pas als Milan een videogenerator, muziekdienst en budget kiest. |
| Naam Lumi | **"Lumi van Dreamnest"**, nooit "Lumi" los als kanaalnaam of zoekterm. De linter controleert dit. |
| Natasja | **Later.** Nu alleen Milan. De rol `beheerder` bestaat al. |
| Keur 1 (concept) | **Schakelaar per kanaal, standaard handmatig.** |
| Muziek bij KIVOXEL | **Geen muziek.** Alleen verteller + gamegeluid. |
| Publiceren | Blijft altijd Milans klik (huisregel én superprompt). |

## Wat er al staat (niet opnieuw bouwen)

- Kanalen in `yt_channels` (naam, taal, doelgroep, merkkleur, stem, YouTube-koppeling).
- Pijplijn intake → analyse (FFmpeg-signalen + Gemini) → script → stem → montage, met de werker op poort 3210.
- Momenten met score (`yt_moments`), Short-formats A/B/C en lange video C, hooks, kwaliteitskaart (`034`), privacy-vervaging en dempen (`031`), originaliteitscheck.
- Review, publicatie als privé/ingepland (`037`-`040`), statistieken (`041`-`043`), kostenregistratie (`yt_costs`).
- Na samenvoegen (andere sessie, branch `samenvoegen-fase-2-3`): inbox-map en FFmpeg-signalen vóór Gemini.

## Fasen

Elke fase begint pas als de vorige op `main` staat en de samenvoeg-sessie klaar is. Elke fase eigen branch. Per fase: `npx tsc --noEmit`, `npm test`, `npm run build`, controle in de browser (poort 3200), testvideo voor Milan, korte demo-instructie, open punten en kosten. Migraties via Milans klembord; pushen alleen na zijn akkoord.

### Fase A: Kanaalprofielen en Pijplijnbord
- Migratie 045: `yt_channels` uitbreiden met `slug`, `mode` (upload/generate/hybrid), `safety_profile` (kids_gaming/infant_sleep/general), `banned_words`, `made_for_kids_default`, `synthetic_media`, `concept_auto_approve` (standaard uit), publicatieslots, `providers` (standaard gemini/google-tts/geen). Taal `nl` blijft de standaard voor nieuwe kanalen.
- Map `channels/<slug>/` met `style.md` en prompts; KIVOXEL-profiel invullen, Dreamnest als "gepland".
- Startscherm **Pijplijnbord**: kolommen per status (bestaande statussen van `yt_videos` vertaald), projectkaart met kanaalkleur, aantal Shorts, kosten en rode badge bij een blokkade, filter per kanaal, knop "Te keuren (n)".
- **Keur-modus** (mobiel eerst): één item tegelijk, Goedkeuren / Aanpassen / Afkeuren met reden.
- ✔ Een opname verschijnt als kaart, doorloopt de statussen en is te keuren op de telefoon.

### Fase B: Poortwachter (harde checks)
- Status "Geblokkeerd" met reden op de kaart.
- Privacy-scan op transcript en tekst in beeld (Gemini, binnen het budget): namen, school, woonplaats, telefoonnummers, gamertags. Gevonden → vervagen/dempen voorstellen + blokkeren tot Milan keurt. Maes-regel als vaste check.
- Tekst-linter per kanaal (verboden woorden, "Lumi" nooit los), Made for Kids per video, geen "zie eindscherm"-teksten bij Made for Kids.
- Poortwachter-widget: groen/oranje/rood per regel met uitleg.

### Fase C: KIVOXEL per opname 1 lange video + 3-6 Shorts
- Uitbreiden van de bestaande analyse: per opname een lange video (8-15 min: cold open, payoff vóór 0:45, re-hooks elke 60-90 s, dode stukken versneld met timer) en 3-6 Shorts (doel 30-45 s, naadloze loop). Formats A/B/C blijven, typen zonder kindstem/facecam.
- Keur 1 (concept) met de kanaalschakelaar; terugsturen met opmerking → alleen dat blok opnieuw, met verschil (diff) en versies.
- Packaging: 3 titelvarianten + 3 echt verschillende thumbnails (voor Test & Compare), beschrijving met hoofdstukken, geen persoonsgegevens.
- Geen muziek (besluit Milan).
- ✔ 1 opname → 1 lange video + ≥ 3 Shorts op de Keurtafel, bewerkbaar script, 3 titels en 3 thumbnails; na Milans klik privé/ingepland op YouTube.

### Fase D: Provider-stekkers en kosten per project
- Interfaces voor LLM, TTS, muziek en video in de werker; nu alleen Gemini en Google TTS aangesloten. Een betaalde dienst toevoegen = nieuwe stekker + akkoord + budget.
- Kosten per project op de kaart (uit `yt_costs`), met de bestaande maandgrens.

### Fase E: Dreamnest voorbereiden (zonder kosten)
- Profiel `dreamnest-nl`, `channels/dreamnest/lumi.bible.md` en de referentiebeelden in `assets/channels/dreamnest/lumi/` (Milan levert ze aan).
- Variatie-engine met "Verras me" (blokkeert gebruikte combinaties), opdrachtscherm, titel- en beschrijvingssjablonen (volumetip, AI-disclosure, Made for Kids).
- Gratis checks met FFmpeg: helderheid na donker-scherm-punt, flitsen, loudness/pieken, loop-naden; Dark Screen-export (1/3/8/10 u) uit één render.
- De render zelf (Animator, Componist) staat uit tot Milan een dienst en budget kiest.

### Fase F: Leren
- Na 48 u en 7 dagen statistieken ophalen (bestaande stats-koppeling uitbreiden), Leer-widget, lessen terug in de prompts, batch-modus voor Shorts.

## Open punten voor later
- Videogenerator, muziekdienst met commerciële rechten en budget voor Dreamnest.
- Natasja als keurder.
- YouTube Analytics-rechten (mogelijk opnieuw koppelen met extra toestemming).

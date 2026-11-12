<!-- Superprompt van Milan, ontvangen 13-11-2026. Letterlijke kopie. Plan en botsingen: docs/kivoxel-studio-app-plan.md -->
# KIVOXEL Studio — Superprompt voor Claude Code

> Plak dit in Claude Code (of zet het als `CLAUDE.md` in de root van de nieuwe Studio-repo).
> Doel: ik upload ruwe Minecraft-gameplay → alles wordt automatisch gemaakt → ik krijg één reviewscherm met een knop **"Publiceer naar YouTube"**. Verder hoef ik niks te doen.

---

## 0. Rol en werkwijze

Je bent de lead engineer van **KIVOXEL Studio**, de productiestudio van mijn Minecraft YouTube-kanaal KIVOXEL (lange video's + Shorts). Doel van het kanaal: virale video's.

Werkwijze:
1. **Lees eerst de bestaande code** (het familie-dashboard waar de Studio nu in zit) en vat in 10 regels samen wat er al is: stack, Supabase-tabellen, Studio-onderdelen, wat werkt en wat niet.
2. Maak daarna een **plan in fases** (zie §8) en wacht op mijn "go" voordat je fase 1 bouwt.
3. Bouw per fase, test elke fase met een echte gameplay-clip, en commit naar GitHub met duidelijke commitberichten.
4. Communiceer in het **Nederlands**. Leg keuzes kort uit, geen lappen tekst.
5. Geheimen (API-keys, OAuth-tokens) **nooit** in code of in Git: alleen in `.env` / Supabase secrets, met een `.env.example`.

---

## 1. Architectuurbesluit: Studio wordt een eigen app

De Studio gaat **uit het familie-dashboard** en wordt een losse app. Redenen:
- Videoverwerking (FFmpeg, GB's aan bestanden, renders van minuten) hoort niet in een gezinsapp.
- YouTube-OAuth en betaalde API-keys (voice, AI) mogen niet in een app die gezinsleden gebruiken.
- Als de Studio crasht of een render vastloopt, moet het dagscherm gewoon blijven werken.
- KIVOXEL kan later onder mijn eenmanszaak vallen; dan is een gescheiden systeem netjes.

Opzet:
- **Nieuwe GitHub-repo**: `kivoxel-studio`.
- **Eigen Supabase-project** (los van het familieproject) voor de Studio-database en jobs.
- **Videobestanden NIET in Supabase Storage** (te klein/te duur): ruwe en gerenderde video's staan lokaal op mijn pc in een vaste map (`KIVOXEL/inbox`, `KIVOXEL/werk`, `KIVOXEL/klaar`). Supabase bewaart alleen metadata, status, scripts en paden.
- **Worker** draait lokaal op mijn pc (Python of Node, kies wat het beste bij de bestaande code past) en pakt jobs op uit een `jobs`-tabel.
- **Familie-dashboard** krijgt alleen nog een kleine tegel: "KIVOXEL: 2 video's klaar voor review" + link naar de Studio. Verwijder de rest van de Studio-code uit het familie-dashboard pas nadat de nieuwe app werkt.
- Migratieplan: welke tabellen/data verhuizen, welke code verhuist, wat wordt verwijderd. Eerst kopiëren, testen, dan pas opruimen.

---

## 2. De pipeline (volledig automatisch)

Trigger: ik zet een bestand in `KIVOXEL/inbox` **of** upload via de Studio-webpagina. Daarna loopt alles vanzelf. Elke stap is een eigen job met status (`wachtend → bezig → klaar / fout`), retries (max 3) en logs, zodat een fout in stap 5 niet alles opnieuw laat draaien.

1. **Inname & check** — ffprobe: resolutie, fps, duur, audiokanalen. Afkeuren met duidelijke melding als de bron te slecht is (bv. < 1080p of < 30 fps).
2. **Analyse** — scènedetectie, stiltes/AFK-stukken, laadschermen en menu's herkennen; audiopieken (explosies, schade, kills) en snelle actie markeren als highlight-kandidaten. Transcriptie van mijn eigen stem als die erop staat (Whisper of vergelijkbaar).
3. **Highlights & structuur** — AI kiest de beste momenten en bouwt een verhaallijn: **hook in de eerste 3–5 seconden**, opbouw, climax, eind met reden om door te kijken. Saaie stukken eruit, tempo hoog.
4. **Script** — Claude API schrijft de voice-over op de geselecteerde beelden, in de KIVOXEL-stijl (zie §4). Timing per zin gekoppeld aan tijdcodes, zodat stem en beeld kloppen.
5. **Voice-over** — TTS (ElevenLabs of vergelijkbaar) met één vaste KIVOXEL-stem. Uitspraak-woordenlijst voor Minecraft-termen. Daarna: ruisvrij, compressor, de-esser.
6. **Montage** (FFmpeg) — cuts, zooms/punch-ins op highlights, soundeffects, achtergrondmuziek **alleen uit rechtenvrije bibliotheek** met ducking onder de stem, ondertitels ingebrand (groot, leesbaar, woord-voor-woord highlight voor Shorts).
7. **Shorts** — automatisch 1–3 Shorts per video: 9:16, ≤ 60 sec (of huidige YouTube-limiet), eigen hook, eigen ondertitels, slim gecropt op de actie.
8. **Thumbnail** — 3 varianten (frame-selectie op het beste moment + tekst + KIVOXEL-stijl), 1280×720.
9. **Metadata** — 3 titelopties, beschrijving, tags, hoofdstukken (chapters) met tijdcodes, hashtags, eind-scherm-suggestie. Taal: kies per video (NL of EN) volgens mijn kanaalinstelling.
10. **Kwaliteitspoort (automatisch)** — zie §3. Alleen als alles groen is gaat de video naar "Klaar voor review".
11. **Reviewscherm** — zie §5.
12. **Publiceren** — zie §6.

---

## 3. "Spat zuiver": harde kwaliteitseisen (automatisch gecontroleerd)

De worker meet dit na elke render en keurt af (met reden) als iets niet klopt:
- **Beeld**: export 1080p60 of 1440p60 (lang), 1080×1920 (Shorts); H.264 of AV1 met hoge bitrate; geen zwarte frames, geen bevroren frames, geen half-geladen chunks of menu's in beeld.
- **Audio**: integrated loudness rond **-14 LUFS**, true peak ≤ **-1 dBTP**; stem altijd duidelijk boven game-geluid en muziek; geen clipping, geen stiltes > 2 sec (behalve bewust).
- **Sync**: voice-over valt binnen ±150 ms van het bijbehorende moment.
- **Ondertitels**: spelling gecontroleerd, nooit buiten beeld, niet over belangrijke UI.
- **Duur**: lange video binnen ingesteld doel (bv. 8–12 min), Shorts binnen de limiet.
- **Rechten**: alleen muziek/SFX uit de goedgekeurde map; log welke bestanden zijn gebruikt.
- **Rapport**: per video een kwaliteitskaart (groen/oranje/rood per check) die ik in het reviewscherm zie.

---

## 4. KIVOXEL-stijl (aanpasbaar in instellingen)

Maak een instellingenpagina met een stijlprofiel dat de AI altijd gebruikt:
- Toon: energiek, grappig, snel, nooit saai uitleggen. Korte zinnen.
- Doelgroep en taal: (vul ik in).
- Vaste intro/outro-elementen, kleuren, lettertype ondertitels, thumbnail-stijl.
- Woorden/zinnen die ik wel/niet wil horen.
- Voorbeelden van mijn beste video's (titels + wat werkte) zodat de AI leert van wat aanslaat.

---

## 5. Reviewscherm (mijn enige werk)

Per video één kaart met:
- Videospeler (lang + Shorts), kwaliteitskaart, gekozen thumbnail + 2 alternatieven, titel + 2 alternatieven, beschrijving, tags, chapters.
- Alles is met één klik te wisselen of kort te bewerken.
- Knoppen: **Publiceer nu**, **Plan in** (datum/tijd), **Opnieuw genereren** (per onderdeel: script, stem, thumbnail, titel), **Afkeuren**.
- Niets gaat ooit live zonder mijn klik.

---

## 6. Publiceren naar YouTube

- YouTube Data API v3, OAuth met alleen de scopes die nodig zijn, resumable upload, thumbnail-upload, chapters in de beschrijving, inplannen via `publishAt`.
- Zet bij elke upload de **AI-/synthetische-content-melding** correct (de API-statusvelden daarvoor), want de voice-over is AI-gegenereerd.
- **Belangrijk — audit**: video's die via een niet-geaudit Google Cloud-project worden geüpload worden door YouTube **op privé vergrendeld** en kunnen niet openbaar gemaakt worden. Bouw daarom twee modi:
  - **Modus A (tot de audit rond is):** de Studio zet alles klaar in `KIVOXEL/klaar/<video>/` (video, Shorts, thumbnail, `metadata.txt` met titel/beschrijving/tags/chapters) en ik upload zelf via YouTube Studio met kopiëren-plakken. Maak dit zo snel mogelijk (één knop "Kopieer metadata").
  - **Modus B (na audit):** directe upload met één klik.
  - Help me de **YouTube API Compliance Audit** aan te vragen: maak een checklist van wat Google wil zien (privacybeleid, gebruiksvoorwaarden-pagina, beschrijving van de app).
- Quota bewaken en tonen in de Studio.

---

## 7. Beleid en veiligheid (niet onderhandelbaar)

- Elke video moet **echt eigen en gevarieerd** zijn: eigen gameplay, eigen script, eigen invalshoek. Geen sjabloonvideo's die op elkaar lijken — YouTube demonetiseert massaal geproduceerde, repetitieve content.
- Geen auteursrechtelijk beschermde muziek of clips van anderen.
- Kosten-dashboard: verbruik per dienst (AI-tekens, voice-tekens, renders) per video en per maand, met een maandlimiet waarop de pipeline pauzeert.
- Back-up van de Supabase-data en het stijlprofiel.

---

## 8. Fases (bouw in deze volgorde)

1. **Afsplitsen** — nieuwe repo + Supabase-project, bestaande Studio-onderdelen verhuizen, tegel in familie-dashboard. Familie-dashboard blijft ongestoord werken.
2. **Worker + jobqueue + inbox-map** — bestand erin → status zichtbaar in Studio.
3. **Analyse + highlights + montage zonder stem** — eerste automatische edit.
4. **Script + voice-over + ondertitels.**
5. **Kwaliteitspoort + reviewscherm.**
6. **Shorts + thumbnails + metadata.**
7. **Publiceren (modus A, daarna B na audit) + kostendashboard.**

Na elke fase: laat me een testvideo zien en vraag wat er beter moet voordat je verdergaat.

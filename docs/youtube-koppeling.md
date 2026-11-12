# YouTube-koppeling (fase D): onderzoek, ontwerp en stappen voor Milan

Peildatum: 12 november 2026. Alles hieronder komt uit de officiële documentatie, met de bron erbij. Wat de documentatie niet zegt, staat als **open**. Opdracht: `masterprompt-kivoxel-studio-2.2.md`, hoofdstuk 6, 7 en 24.7.

## 1. Wat de documentatie zegt

| Onderwerp | Wat er staat | Bron |
|---|---|---|
| Niet-gecontroleerd project | "Videos uploaded from unverified API projects are not restricted to private viewing mode." Er is dus geen audit nodig om openbaar te kunnen publiceren. | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| Quotum | 10.000 eenheden per dag. **Uploads hebben een eigen bakje: 100 per dag, 1 eenheid per upload.** `videos.update` 50, `videos.list` 1, `thumbnails.set` 50, `captions.insert` 400, `search.list` 1 (hoogstens 100 per dag). | [quotakosten](https://developers.google.com/youtube/v3/determine_quota_cost) |
| Inplannen | `status.publishAt` kan alleen als `privacyStatus` op `private` staat en de video nog nooit openbaar is geweest. YouTube zet hem zelf openbaar: de pc hoeft niet aan te staan. | [video-resource](https://developers.google.com/youtube/v3/docs/videos) |
| Doelgroep | `status.selfDeclaredMadeForKids`: de eigenaar geeft aan of de video voor kinderen is. Milan bevestigt dit altijd zelf. | idem |
| AI-content | `status.containsSyntheticMedia`: melding van realistische, gewijzigde of synthetische inhoud. | idem |
| Metadata | Titel: hoogstens 100 tekens, geen `<` of `>`. Beschrijving: hoogstens 5000 bytes. Tags: samen hoogstens 500 tekens. Verder `defaultLanguage`, `defaultAudioLanguage` en `categoryId` (lijst via `videoCategories.list`). | idem |
| Thumbnail | `thumbnails.set` werkt ook voor Shorts, maar pas als de verwerking klaar is. JPEG of PNG, hoogstens 50 MB. Een 403 betekent dat het account nog geen eigen thumbnails mag gebruiken. | [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) |
| Hervatbaar uploaden | Een lege PUT met `Content-Range: bytes */TOTAAL` vraagt op hoeveel er binnen is: 308 met een `Range`-header. Daarna verder vanaf de volgende byte. Een 404 betekent dat de sessie verlopen is. | [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) |
| Ondertitels | `captions.insert` werkt alleen met de scope `youtube.force-ssl` en kost 400 eenheden. | [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert) |
| Inloggen (desktop) | De loopback `http://127.0.0.1:poort` wordt aanbevolen voor desktop-apps op Windows, met PKCE. | [OAuth native app](https://developers.google.com/identity/protocols/oauth2/native-app) |
| Testmodus | In "Testing" vervalt de toestemming **7 dagen** na het inloggen; daarna is opnieuw inloggen nodig. "In production" zonder controle door Google: een waarschuwingsscherm, en hoogstens 100 gebruikers over de hele levensduur van het project. Voor Milan alleen is dat ruim genoeg. | [Google Cloud help](https://support.google.com/cloud/answer/15549945) |
| Analytics | `engagedViews` bestaat. Retentie via `audienceWatchRatio` per `elapsedVideoTimeRatio`, plus `averageViewPercentage`. Er is **geen** metric voor "viewed vs swiped away". | [Analytics-metrics](https://developers.google.com/youtube/analytics/metrics) |
| Shorts | Tot 3 minuten lang, verticaal geüpload, hoogstens 1080p. Er is geen API-veld dat een video als Short markeert. | [YouTube Help](https://support.google.com/youtube/answer/10059070) |

**Open, nog na te gaan bij het bouwen:**
- Of `youtube.upload` als "gevoelig" of "beperkt" geldt. Dat bepaalt alleen welk waarschuwingsscherm je ziet.
- ~~Of het kanaal Kivoxel al eigen thumbnails mag gebruiken.~~ Nog niet (403 op 12-11-2026); eerst verifiëren via https://www.youtube.com/verify.
- De exacte namen van de analytics-scopes. Die controleer ik op de OAuth-scopepagina voordat ik ze aanvraag.

## 2. Ontwerp

- **De werker op de pc doet de koppeling en het uploaden.** De renders staan daar al, dus er gaat geen video via Vercel. Inloggen gaat via de loopback `http://127.0.0.1:3210/oauth/callback`, met PKCE.
- **De tokens blijven op de pc**, versleuteld met AES-256-GCM. De sleutel `YT_TOKEN_KEY` staat in `worker\.env.local`. De tokens gaan nooit naar de browser of naar Supabase (2.2, hoofdstuk 17). Supabase krijgt alleen de stand van de koppeling: kanaal-ID, kanaalnaam, laatste synchronisatie en eventuele fouten.
- **Scopes:**
  - begin met `youtube.upload` en `youtube.force-ssl` (bijwerken, ondertitels en thumbnails);
  - `yt-analytics.readonly` pas in fase E;
  - de scope voor omzet pas als het kanaal in het Partner Program zit.
- **Publicatie** (migratie 037, nog te schrijven): een tabel `yt_publications` per video. Daarin staan:
  - de metadata, met tekentellers en de limieten hierboven;
  - de keuzes voor doelgroep en AI-melding, altijd expliciet door Milan;
  - de zichtbaarheid en `publish_at` (Europe/Amsterdam);
  - de status, `youtube_video_id` en de link;
  - de voortgang van de upload (bytes, snelheid) via de bestaande live voortgang (migratie 033).
- **Knoppen:**
  - **Concept opslaan:** alleen in de database.
  - **Privé uploaden:** `privacyStatus=private`.
  - **Inplannen:** privé met `publishAt`.
  - **Nu publiceren:** `public`.

  Elke knop is een bewuste klik van Milan; een automatisering mag hoogstens een tijdslot voorstellen.
- **Geen dubbele upload:**
  - de URI van de upload-sessie en het aantal verzonden bytes worden opgeslagen;
  - na een time-out vraagt de werker eerst bij YouTube op hoeveel er binnen is, en gaat dan verder;
  - is de sessie verlopen terwijl het onduidelijk is of de upload klaar was, dan kijkt de werker eerst in de uploadlijst van het kanaal (1 eenheid), op titel en tijdstip;
  - een nieuwe upload start pas als de video daar niet staat;
  - een uniek `youtube_video_id` in de database is de laatste vangrail (bestaat al sinds migratie 007).
- **Quotum:** de werker telt het verbruik per dag, volgens de kosten hierboven. Instellingen toont wat er over is; bij een leeg quotum weigert de werker netjes, met de reden.
- **Ondertitels:** uploaden als apart `.srt`-bestand, naast de ingebrande versie (400 eenheden, ruim binnen het quotum).

## 3. Stappen voor Milan (eenmalig, gratis)

Doe dit in het Google Cloud-project **"Familie MK YouTube"** (hetzelfde als voor Gemini), ingelogd met het Google-account dat het kanaal **Kivoxel** beheert.

1. **API's aanzetten:** ga naar "API's en services", dan "Bibliotheek", en zet aan:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
2. **Toestemmingsscherm** (Google Auth Platform, "Branding" en "Doelgroep"):
   - Soort gebruiker: **Extern**. App-naam: **Kivoxel Studio**. Vul je eigen e-mailadres in als ondersteunings- en contactadres.
   - Zet bij "Doelgroep" jezelf als testgebruiker.
   - **Keuze:** laat de app op "Testing" staan (dan moet je **elke 7 dagen** opnieuw inloggen), of zet hem op "In production" (dan zie je eenmalig een waarschuwing "Google heeft deze app niet geverifieerd", die je zelf wegklikt). Ik raad **In production** aan, omdat de koppeling anders elke week stopt.
3. **OAuth-client maken:** ga naar "Clients" en kies "Client maken". Soort: **Desktop-app**, naam: **Kivoxel werker**.
4. **De gegevens in de werker zetten:** zet de client-ID en het clientgeheim **zelf** in `worker\.env.local`:
   ```
   YOUTUBE_CLIENT_ID=...
   YOUTUBE_CLIENT_SECRET=...
   ```
   Plak ze **niet** in de chat.
5. **Later, eenmalig inloggen:** na de bouw klik je in YouTube Studio bij Instellingen op **"YouTube koppelen"**. Kies daar het kanaal Kivoxel. Is het een merkaccount, kies dan bij het inloggen het juiste kanaal.

## 4. Volgorde van bouwen

- **D1 (gebouwd, werker 56.0 en migratie 036):** de koppeling (OAuth via de werker, versleutelde tokens, kaart "YouTube-koppeling" met kanaal, ID, naam, foto, status en laatste synchronisatie) en de quotumteller.
- **D2 (gebouwd, migratie 037):** het publicatiescherm: metadata met tekentellers, de doelgroep en de AI-melding verplicht kiezen.
- **D3 (gebouwd, werker 57.0 en migratie 038):** hervatbaar uploaden met live voortgang en een controle tegen dubbele uploads, plus de status van de verwerking.
- **D4a (gebouwd, werker 57.1 en migratie 039):** inplannen (`publishAt`), Nu publiceren en Terug naar privé.
- **D4b (gebouwd, werker 57.2 en migratie 040):** ondertitels en de thumbnail.
- **D5 (gedaan, 12-11-2026):** een echte privé-test-upload naar Kivoxel, nooit openbaar tijdens tests (2.2, hoofdstuk 23).

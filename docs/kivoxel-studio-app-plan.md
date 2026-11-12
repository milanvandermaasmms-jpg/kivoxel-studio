# KIVOXEL Studio als eigen app: stand, botsingen en fasenplan

Opdracht: `docs/masterprompt-kivoxel-superprompt.md` (13-11-2026). Dit document is stap 1 en 2 uit §0: wat er is, en het plan. Bouwen begint pas na Milans "go" per fase.

## 1. Wat er al is (10 regels)

1. **Stack:** Next.js 16 + React 19 + Tailwind 4 op Vercel, Supabase (familieproject) met RLS, Vitest; YouTube Studio zit onder `/youtube` in het familie-dashboard.
2. **Werker op de pc** (Node, `worker/`, poort 3210): ontvangt uploads, FFmpeg-intake, Gemini-analyse, scripts, montage met stem (Google TTS), kwaliteitscontrole, YouTube-upload, cijfers. Jobs via `yt_jobs` met status, pogingen, live voortgang en logboek.
3. **Database:** 16 YouTube-migraties (007-043), onder meer `yt_recordings`, `yt_moments`, `yt_videos`, `yt_scripts`, `yt_renders`, `yt_jobs`, `yt_channels`, `yt_publications`, `yt_video_snapshots`. Video's staan op de pc, niet in Supabase.
4. **Werkt (aangetoond):** upload met hervatten, intake, analyse van echte gameplay, hook-first scripts met 3 hooks, montage (Short 9:16 en lang 16:9) met vervagen, ondertitels, stem en luidheidscorrectie, kwaliteitskaart (groen/oranje/rood), editor, privé-upload naar Kivoxel, koppeling "In production", cijfers en kijkcurve.
5. **Gebouwd, nog niet met een echte video getest:** inplannen en openbaar publiceren, ondertitelspoor, prestatierapport, signaleringen.
6. **Thumbnail:** één beeld uit de montage, zelf gekozen. Geen varianten met tekst. Eigen thumbnails vragen nog kanaalverificatie (403).
7. **Ontbreekt t.o.v. de superprompt:** watch-map `inbox`, scènedetectie/AFK/laadschermen, transcriptie, zooms op highlights, muziek en SFX, automatische Shorts uit een lange video, 3 thumbnailvarianten, 3 titelopties en chapters, stijlprofiel, kostendashboard per dienst, "Opnieuw genereren" per onderdeel, export voor handmatig uploaden.
8. **Menselijke stappen nu:** script goedkeuren, video goedkeuren, publiceren. De superprompt wil alleen het reviewscherm.
9. **Kosten nu:** Gemini Flash-Lite (betaald, plafond € 5 per maand), Google TTS (gratis deel), YouTube API (gratis).
10. **Privacy:** Maes nooit met gezicht, stem, naam of gamertag; vaste PS5-hoeken worden vervaagd; RLS per gezin; tokens versleuteld op de pc.

## 2. Botsingen (eerst beslissen)

| # | Superprompt | Feit of huisregel | Voorstel |
|---|---|---|---|
| 1 | Nieuwe GitHub-repo en eigen Supabase-project | CLAUDE.md: een repo of Supabase-project maken pas na Milans akkoord; Milan maakt het project zelf aan (iCloud-account) | Milan maakt `kivoxel-studio` (GitHub) en een nieuw Supabase-project; ik begeleid stap voor stap |
| 2 | §6: uploads van een niet-geaudit project worden op privé vergrendeld; daarom modus A (handmatig uploaden) | De documentatie van `videos.insert` (gelezen 12-11-2026): "Videos uploaded from unverified API projects are not restricted to private viewing mode." Openbaar publiceren is nog niet echt getest | Eerst één echte video openbaar zetten (Milans klik). Lukt dat, dan is modus A niet nodig; anders modus A bouwen en de audit aanvragen |
| 3 | Script via de Claude API | Nu Gemini Flash-Lite binnen € 5 per maand; Claude kost extra | Bij Gemini blijven, tenzij Milan een extra budget goedkeurt |
| 4 | Voice via ElevenLabs | Nu Google TTS in het gratis deel (€ 0); ElevenLabs is betaald | Google TTS houden; ElevenLabs alleen met een budget van Milan |
| 5 | Shorts ≤ 60 s | YouTube staat Shorts tot 3 minuten toe (YouTube Help, 12-11-2026) | Doel 20-45 s (formats A en B), grens 3 min |
| 6 | Bron afkeuren onder 1080p of 30 fps | De opnames zijn 1920×1088 op 60 fps (PS5), dus dat gaat goed | Eis overnemen, met een duidelijke melding |
| 7 | "Alles automatisch", alleen reviewen | Nu keurt Milan eerst het script goed | Script automatisch doorzetten naar de montage; in het reviewscherm "Opnieuw genereren" per onderdeel. Publiceren blijft altijd Milans klik |
| 8 | Muziek en SFX | Er is nog geen rechtenvrije bibliotheek | Milan levert een map met rechtenvrije muziek en SFX (met licentie); de Studio gebruikt alleen die map en logt elk bestand |

## 3. Fasenplan

| Fase | Wat | Nodig van Milan |
|---|---|---|
| 1. Afsplitsen | Nieuwe repo en Supabase-project. De YouTube-tabellen en -code kopiëren (eerst kopiëren, testen, dan pas opruimen). Eigen Vercel-project. In het familie-dashboard alleen een tegel "KIVOXEL: X klaar voor review". De werker gaat naar de nieuwe repo. | Repo en Supabase-project aanmaken, migraties draaien, Vercel koppelen; akkoord vóór het opruimen in het familie-dashboard |
| 2. Inbox-map | `KIVOXEL/inbox` → automatisch naar intake; status in de Studio. Mappen `werk` en `klaar`. | Map kiezen |
| 3. Slimmere analyse | Scènedetectie, stiltes/AFK, laadschermen en menu's (FFmpeg), audiopieken als kandidaat, transcriptie alleen als Milan er zelf op spreekt (niet Maes). Zooms op highlights. | — |
| 4. Script en stem automatisch | Script zonder tussenklik naar de montage; stijlprofiel in Instellingen; uitspraaklijst; stemfilter (ruis, compressor, de-esser). | Stijlprofiel invullen |
| 5. Kwaliteitspoort en reviewscherm | De bestaande kwaliteitskaart uitbreiden (sync ±150 ms, stiltes > 2 s, ondertitels in beeld); alleen bij groen naar "Klaar voor review"; één reviewkaart met Opnieuw genereren per onderdeel. | — |
| 6. Shorts, thumbnails en metadata | 1-3 Shorts uit een lange video; 3 thumbnailvarianten met tekst (1280×720); 3 titels, chapters en hashtags. | Kanaal verifiëren (thumbnails) |
| 7. Publiceren en kosten | Directe upload (bestaat al) of modus A als blijkt dat het nodig is; kostendashboard per dienst met pauze bij de maandlimiet; back-up van de data en het stijlprofiel. | Eerste openbare test |

Na elke fase: een testvideo laten zien en vragen wat beter moet.

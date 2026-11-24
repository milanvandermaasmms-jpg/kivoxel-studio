# Eindrapport superprompts V1 t/m V7 (24-11-2026)

**Legenda**
- ✅ in de echte productie getest (echte werker, echte opname of de live studio), met bewijs;
- 🟡 gebouwd en geautomatiseerd getest, maar nog niet in productie bewezen;
- 🟠 deels gebouwd;
- ❌ niet gebouwd;
- ⛔ wacht op Milans keuze of toestemming.

**Stand van de tests op 24-11:** 986 tests (133 bestanden), typecheck schoon, build schoon. 4 Playwright-browsertests zijn geschreven, maar nog niet gedraaid (zie V7-6).

**Welke prompt is welke:**
- **V1:** `docs/masterprompt-kivoxel-superprompt.md`
- **V2:** "opschonen, fixen en slimmer maken"
- **V3:** "montagekwaliteit van Kivoxel"
- **V4:** "voice-oververdeling en vertelstijl"
- **V5:** "Ultra master V5.0"
- **V6:** "Aanvulling V6.0"
- **V7:** "Vervolgopdracht" plus "Definitieve acceptatie"

De volledige tekst van V6 staat alleen nog als samenvatting in het transcript; de eisen komen uit `docs/v6-impactanalyse.md`.

## V1 — De Studio als eigen app
| Eis | Status | Bewijs |
|---|---|---|
| Eigen app, los van het familie-dashboard; eigen Supabase | ✅ | Draait op 3200 en Vercel; eigen project |
| Pipeline: upload → analyse → script → montage → keuring → YouTube | ✅ | Praktijktest 24-11: inbox → intake → analyse → script → montage → AI-check |
| Harde kwaliteitseisen automatisch gecontroleerd | ✅ | QC-lijst plus eindredacteur bij elke montage; praktijktest |
| Reviewscherm als enige werk van Milan | ✅ | Keurscherm V6 (23-11), gebruikt door Milan |
| Publiceren naar YouTube, altijd Milans klik | ✅ | Wachtrij YouTube: 23 → 9 na de reparatie van 24-11; 47 live |
| Beleid: niets automatisch publiek | ✅ | Upload altijd privé of ingepland; publicatiecheck |

## V2 — Opschonen, fixen, slimmer maken
| Eis | Status | Bewijs |
|---|---|---|
| 1.1 Teller "X klaar voor YouTube", eigen tab, badge | ✅ | Bovenbalk "21 klaar voor YouTube" (gezien 24-11) |
| 1.2 "Naar YouTube sturen" als primaire knop, statussen en voortgang | ✅ | Kaarten in "Klaar voor YouTube" |
| 1.3 Overzicht: tabs per stap, inklapbaar | ✅ | 9 tabs |
| 1.4 Geen verspringende lijst | 🟡 | Stabiele keys en skeletons; niet apart gemeten |
| 1.5 Privé / niet vermeld / openbaar, inplannen | ✅ | Gebruikt bij uploads (ingepland: 15) |
| 1.6 AI-suggesties voor tags, titel en beschrijving | ✅ | studio_events: 53 tags, 34 titels, 45 beschrijvingen gebruikt |
| 2.1 `studio_events` bijhouden | ✅ | Meer dan 3.000 gebeurtenissen |
| 2.2 Studio-tips (toepassen / negeren) | ✅ | 15× toegepast |
| 3.1 Referentievideo's (YouTube Data API) | ✅ | `yt_reference_videos`, wekelijks |
| 3.2 Toets op stem, script en gameplay | ✅ | "Script- en stemcheck" plus viralscore |
| 3.3 Leren van echte YouTube-resultaten | ✅ | Kijkduur per soort moment weegt mee in de keuze van Shorts |

## V3 — Montagekwaliteit
| Eis | Status | Bewijs |
|---|---|---|
| 1 Vastgelopen Fortnite-montage traceren en herstellen | ✅ | 23-11 |
| 2 Kijken wat de kijker ziet: opening, aanloop, uitkomst, crop, sync, stem | 🟡 | Eindredacteur meet de export; crop volgen niet apart bewezen |
| 3 Goedkeuren / afkeuren / afkeuren en opnieuw monteren | ✅ | Keurscherm plus Afgekeurd-lijst |
| 4 SpawnNado Fortnite-montage | ✅ | Live Fortnite-Shorts |
| 5 Uppbeat in video's en Shorts | ✅ | 12 Uppbeat-tracks; credit in het uploadblad |
| 6 Viral check vóór en na de montage | ✅ | Producer-poort plus Content Value Gate, praktijktest |
| 7 Aantoonbaar leren | ✅ | Ivar-lessen v1, "Uitkomst 1,5 s langer" toegepast in de praktijktest |
| 8 Bewijs via de normale interface | 🟠 | Praktijktest plus rapport; voor/na-vergelijking in de studio niet opnieuw gedemonstreerd |

## V4 — Stemverdeling en vertelstijl
| Eis | Status | Bewijs |
|---|---|---|
| 1 Stemverdeling exact bijhouden (1 op 3 Shorts, 1 op 5 lang) | ✅ | Bibliotheek → Stemverdeling; render-log "plek 2 van 3" |
| 2 Onderzoek naar de vertelstijl | ✅ | Toonregels 23-11 in CLAUDE.md |
| 3 Eerst het verhaal, dan de stem; één taak per zin, niets verklappen | ✅ | Controle per zin op 7 punten; 55 sjablonen rustiger (24-11) |
| 4 Viral check tweemaal, de export zonder uitleg beoordelen | ✅ | AI-check zonder script (24-11, praktijktest) |
| 5 Het geleverde bestand controleren | ✅ | Eindredacteur plus Techniek-score op de export |
| 6 Oorzaak corrigeren en nieuwe versie tonen | ✅ | Herkansing bij Content, editor_fix, viral_fix |
| 7 Laten zien dat de studio leert | ✅ | "Wat Ivar leerde", met teller |
| 8 Afspeelbaar bewijs | 🟠 | Rapport met beelden; geen voor/na-speler voor deze ronde |

## V5 — Complete rebuild
| Fase | Status | Bewijs / open |
|---|---|---|
| 1-3 Audit (pagina's, performance, beveiliging) | ✅ | Leesbaarheid donker thema (9.600 teksten), RLS-test in `npm test`, minder Supabase-verzoeken |
| 4-6 Alle content herbeoordelen en zwakke content hermonteren | 🟠 | Register: 405 producties technisch gemeten; inhoudelijke AI-herkeuring loopt (V7-5); hermonteren ⛔ |
| 7 Nieuw voice-oversysteem | 🟠 | Stemonderzoek: geen betaalde stem nodig; controle per zin ✅; nieuwe aanbieder niet nodig bevonden |
| 8 Muziek via Uppbeat met regels | ✅ | Muziekgeschiktheid 8,0, licentie verplicht |
| 9 Geluidseffectenmotor | 🟡 | Per soort moment, gebouwd 24-11; nog niet in een gekeurde Short beluisterd |
| 10-13 Uploadaudit en slimme briefing | ✅ | Briefing-proefproductie 23-11 (viralscore 9,0) |
| 14 Gameplay intelligence (Minecraft, Roblox, Fortnite) | 🟠 | Minecraft ✅; Fortnite-levensbalk 🟡 (getest op opnames, niet in productie); Roblox 🟡 (getest op 2 opnames) |
| 15-16 Content quality engine en viral check | ✅ | Content Value Gate plus drie scores, praktijktest 24-11 |
| 17 LUMI herbeoordelen; lange video's | 🟠 | LUMI-controle in het register; 8 uur: migratie 058 ⛔ |
| 18 Rendering en wachtmenu | ✅ | Wachtrij van de werker; storingen opgelost (vastlopers, slapende pc) |
| 19 Publicatieworkflow | ✅ | Publicatiecheck van 10 punten; uploadcontrole van 214 video's |
| 20 Ivar als assistent | ✅ | Ivar-gezondheid, incidenten, leercyclus |
| 21 Dashboard | ✅ | Tabs, Studio-gezondheid, Bibliotheek |
| 22 Automatische testsuite | 🟠 | 986 unittests ✅; browsertests geschreven, nog niet gedraaid |
| 23 Credits en kosten | ✅ | Kosten per productie en per uur opname; maandplafond € 100 |

## V6 — Aanvulling
| Eis | Status | Bewijs |
|---|---|---|
| Ivar als proactieve studiomanager met permissieniveaus | ✅ | Incidentmonitor: niveau 1 zelf, niveau 2/3 aan Milan |
| Viralscore minimaal 8,0, eerlijk (geen kunstmatige scores) | ✅ | Bron per onderdeel; drie losse scores; de poort blokkeert |
| Drie audio-opties met previews, los te kiezen | ✅ | Preview B afgespeeld (23-11) |
| Muziekgeschiktheid minimaal 8,0 | ✅ | "9 tracks halen de 8,0" in de render-log |
| Nieuwe keurpagina | ✅ | Herbouwd na Milans feedback (23-11) |
| Professioneel en gebruiksvriendelijk | ✅ | Donker thema geaudit; Milan gebruikt hem dagelijks |

## V7 — Vervolgopdracht en definitieve acceptatie
| Opdracht | Status | Bewijs / open |
|---|---|---|
| 1 Schijf D: veilig afronden | ⛔ | Kopie gecontroleerd: 52 van 53 goed, 1 mislukt; **schijf onbetrouwbaar** (viel 3× weg, Windows vraagt chkdsk); niet omgeschakeld, alles staat op C: |
| 1 Volledige productie van upload tot export | ✅ | 3 proefopnames via de inbox tot en met de export (`docs/praktijktest-2026-11-24.md`) |
| 2 Content Value Gate: saai herkennen, geen Short zonder gebeurtenis, payoff vereist, onvoldoende afwijzen | ✅ | Negatieve test tegengehouden (AI 3/4); geen saaie Short bij Te keuren |
| 2 Beste fragmenten kiezen | 🟠 | Herkansing plus voorrang voor bevestigde momenten gebouwd; positieve test bleef steken op 6/6 (grens 7, besluit Milan) |
| 3 Drie scores onafhankelijk, geen compensatie; AI blokkeert alleen automatisch | ✅ | Tests plus praktijk: "Content 6,7 onder de norm" ondanks Techniek 10 |
| 4 Ivar-leercyclus: afkeuringen, goedkeuringen, audio, YouTube | ✅ | Lessen v1 uit echte data; toegepast in de praktijktest; uit te zetten |
| 5 Overzicht technisch / inhoudelijk; gefaseerd herkeuren | 🟠 | Live 224, Klaar 39, Te keuren 7, Afgekeurd 150; AI-herkeuring fase 1 (38 Shorts) loopt; fase 2 (live) ⛔ |
| 5 LUMI en Roblox meenemen | 🟠 | Roblox-herkenning gebouwd; LUMI 8 uur wacht op migratie 058 |
| 6 Playwright-browsertests | 🟠 | 4 tests van de hoofdflows geschreven (nepgegevens, geen account); Chromium-download hangt |
| 6 Wekelijkse back-up zonder sleutels in Git | 🟡 | Gebouwd en getest; de eerste echte back-up komt 5 minuten na de start van de werker |
| 6 Rendering, wachtrij en meldingen na de migratie | ✅ | Migratie niet gedaan (schijf D:); rendering, wachtrij en meldingen werken (praktijktest, uploads 24-11) |

## Openstaande fouten
1. **Positieve kant van de poort nog niet bewezen:** een sterk moment haalde 6/6. De oorzaak ligt deels in het materiaal: de plons in het water stond niet in beeld.
2. **De Chromium-download voor Playwright hangt** (twee pogingen).
3. **Schijf D: is onbetrouwbaar:** NTFS-fouten en controllerfouten.
4. **Gemini-analyse van korte stukken mist soms de climax:** de val in de eerste korte knip.

## Kosten
- **Maandplafond:** € 100.
- **Een uur opname kost gemiddeld € 1,29:** analyse € 0,16, scripts € 0,95 en checks € 0,18.
- **Vandaag:** praktijktest ± € 0,40, herkeuring fase 1 ± € 0,76.
- **Stem:** Google 19% van het gratis deel; Chatterbox en Kokoro zijn lokaal en gratis.

## Wat jouw toestemming nodig heeft
1. **Schijf D::** eerst de foto's veiligstellen, dan chkdsk, of een andere schijf. Pas daarna omschakelen.
2. **Migratie 058** (Dreamnest 8 uur): via het klembord.
3. **Herkeuring fase 2:** de 224 live video's, ongeveer € 4,50.
4. **De 19 producties uit het herstelplan opnieuw maken:** kost geld.
5. **De AI-melding op de 5 live video's met de gekloonde stem:** jouw keuze, niet verplicht gesteld.

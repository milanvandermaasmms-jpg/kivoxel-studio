# Verslag vervolgopdracht (23-11-2026)

Per prioriteit: wat is gebouwd, welk bewijs er is, en wat nog openstaat. "Getest" betekent: een geautomatiseerde test of een meting op een echt bestand. Een knop die er staat, telt nergens als bewijs.

## 1. Ivar als studiomanager

- **Gebouwd:**
  - Incidentmonitor in de werker, die elke 2 minuten controleert:
    - vastgelopen stappen (geen heartbeat);
    - voortgang die stilstaat (het 93%-geval);
    - mislukte stappen;
    - schijfruimte, budget, de YouTube-koppeling en de uploadrij;
    - producties onder 8,0.
  - Herstel op niveau 1 doet de werker zelf: een wees-stap van een vorige sessie vrijgeven, of een tijdelijke fout één keer opnieuw proberen. Al het andere wacht op Milan.
  - Logboek met oorzaak, actie en controle. Het staat als Studio-gezondheid in de studio, bij Ivar (oranje stip en een eigen tabblad) en als Ivar-tool `get_studio_health`.
  - Ivar weet welke video in het keurscherm openstaat. "Vraag Ivar om advies" zet een vraag klaar in zijn invoerveld.
- **Bewijs:**
  - 7 tests: gezond, vastgelopen, 93%, alleen tijdelijke fouten automatisch, niveau 3, logboek open → opgelost, kwaliteit ≠ storing.
  - Vandaag in het echt gezien: de werker liep vast (13:27). De oorzaak (rekenwerk per beeldje) is gevonden en gerepareerd, en de werker antwoordt nu binnen 5 ms.
- **Nog niet getest:** de monitor op de echte werker. Dat kan pas na een herstart. Leren van goedkeuringen: audiokeuzes en viraloordelen worden bewaard, en afkeurredenen worden lessen (`lessons.ts`). YouTube-resultaten: de bestaande weekronde van Ivar.

## 2. Viralscore 8,0

- **Gebouwd:** acht onderdelen met de V6-gewichten. Per onderdeel een score, een bron (gemeten, inschatting of Milan) en bewijs.
  - Originaliteit is altijd jouw oordeel. Zonder dat oordeel staat er "oordeel nodig", nooit "publicatiegereed".
  - Blokkades: techniek, briefing niet gevolgd, stem niet gelijk met het beeld, muziek zonder licentie.
  - Onder 8,0 volgt één gerichte verbetering: een langere uitkomst (gratis) of een ander moment (± 2–4 cent). Daarna wordt de score vergeleken met de vorige, en de score wordt nooit opgehoogd.
  - De oudere check heet nu "Script- en stemcheck".
- **Bewijs:** 7 tests (hoog maar oordeel nodig, publicatiegereed met jouw oordeel, onder 8,0 met zwakste onderdelen, blokkade, niets verzonnen, muzieksfeer, jouw oordeel toepassen).
- **Nog niet getest:** de score van een echte nieuwe montage. Die verschijnt pas bij de eerstvolgende montage na de herstart.

## 3. Drie audio-opties

- **Gebouwd:**
  - A = de huidige versie (aanbevolen), B = energiek, C = naturel.
  - Zelf combineren: stem A/B/C of geen, muziek A/B/C of geen, effecten subtiel, gebalanceerd of dynamisch.
  - Een preview is dezelfde montage met andere audio, als apart bestand: geen nieuwe versie, geen statuswijziging, geen plek in de stemverdeling.
  - "Kies deze audio" maakt de echte versie en bewaart de keuze als voorkeur.
- **Bewijs:** 5 tests. In de browser: het keurscherm toont A (met de stem, muziek en effecten van deze versie), B en C met "Preview maken", en het blok "Zelf combineren".
- **Nog niet getest:** een echte preview laten maken. Dat kan pas na de herstart van de werker.

## 4. Muziekselectie

- **Gebouwd:** geschiktheid per track voor dit moment, met de V6-gewichten (passend 30, emotie 20, timing 15, spanning 15, balans 10, kanaal/licentie 10). Shorts kiezen alleen tracks met 8,0 of hoger; zonder vastgelegde licentie telt een track nooit. Het cijfer telt mee in de viralscore.
- **Bewijs:** 3 tests: spannende track bij bijna-dood hoog en bij een grap laag; drukke track onder de stem; licentie en testtrack.
- **Eerlijk:** dit is een inschatting over gemeten feiten. "Bewezen beter op YouTube" kan pas met eigen A/B-cijfers.

## 5. Inhoudelijke herbeoordeling

- **Gebouwd:** het register geeft per productie de stand van de controle: technisch gecontroleerd, inhoudelijk gecontroleerd (jouw oordeel), volledig goedgekeurd, herstel nodig of nog niet beoordeeld. Met een filter in de studio.
- **LUMI (Dreamnest):** een eigen maatstaf (levendigheid, rust, zachte overgangen, geluid en muziekloop, techniek; Lumi en sfeer = jouw oordeel), op echte bestanden gemeten:
  - 4 Shorts: 10,0 op het gemeten deel.
  - De video van 60 minuten (Kerst): 10,0. Eén korte sprong in beweging, geen gaten in de muziek, geen zwart beeld.
  - Eerst gaven in- en uitfaden vals alarm. Dat zat in de controle zelf en is gerepareerd, met een test.
- **Eerlijk:** de pc kan het verhaal en de originaliteit niet beoordelen. Inhoudelijk controleren gebeurt dus door jou, of met een AI-check die geld kost (± 1–3 cent per productie). Die heb ik niet gestart.

## 6. Gebruiksvriendelijkheid

- **Gebouwd:** de keurpagina volgens V6. Links de video, audio-opties, feedback en script; rechts het kwaliteitspaneel (viralscore, eindredacteur, briefing, dossier). Op de telefoon één kolom. Studio-gezondheid staat bovenaan "In productie".
- **Nog open:** de navigatie van de hele studio opnieuw indelen (fase 34.3).

## 7. Proefproductie en YouTube

- **YouTube KIVOXEL:** werkt. De werker is aangemeld bij UC6zZPLDaBan9Jr8WpEhbdwA met rechten voor uploaden en Analytics; vandaag 148 van 10.000 eenheden gebruikt. "Nog te verbinden" in Instellingen was een weergavefout (koppeling van vóór de koppeling per kanaal) en is gerepareerd. Er is niets geüpload.
- **Proefproductie:** nog niet gedaan. Een echte analyse kost ± 10–35 cent per uur opname, plus ± 2–4 cent per script. Wacht op jouw akkoord.

## 8. Budget

- **€ 5 per maand:** een afspraak uit de eerste projectdocumenten (CLAUDE.md, `docs/handleiding.md`, `docs/kivoxel-studio-app-plan.md`, `docs/overdracht-voor-claude.md`).
- **€ 100:** het maandplafond in de studio (`yt_settings.monthly_cap_cents`), akkoord op 20-11-2026. De database stopt elke betaalde stap boven dit plafond (`reserve_yt_cost`).
- **€ 23,30:** de optelsom van alle kostenregels (`yt_costs`) sinds 1 november (Amsterdamse tijd). Schattingen tellen mee tot de echte kosten zijn vastgelegd.
- Niets gewijzigd. Welk bedrag geldt, beslis jij.

## Gerepareerd onderweg

- **Werker liep vast:** de HUD-betrouwbaarheid werd per beeldje opnieuw berekend. Gerepareerd, en het register meet opnames niet meer opnieuw.
- **Correctielus:** het correctiekenmerk raakte kwijt tussen script en montage, waardoor een correctie opnieuw gecorrigeerd kon worden. Het kenmerk gaat nu mee.
- **Overschreven bestand:** ik had per ongeluk een bestaand bestand overschreven (`lib/youtube/viralData.ts`). Meteen uit Git teruggezet, en er is niets verloren.

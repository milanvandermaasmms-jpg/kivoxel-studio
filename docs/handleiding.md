# KIVOXEL Studio: zo werkt het

**Er gaat nooit iets online zonder jouw klik.** Nieuwe video's gaan standaard Privé naar YouTube.

## De balk bovenaan
**🚀 X klaar voor YouTube** staat altijd bovenaan. Klik erop en je ziet wat je kunt publiceren. Daarnaast staan de aantallen per status en de keuze van het kanaal (Kivoxel nu, Dreamnest NL later).

## De stappen (links, op de telefoon bovenaan)
1. **📤 Uploaden**: zet een opname in de Studio. Dat kan met de uploadknop, of door het bestand in de inbox-map op de pc te zetten. Open **Briefing voor de montage** om aan te geven wat er gebeurt, de belangrijkste gebeurtenis, tijdcodes, sfeer, output, stem en muziek. De studio zoekt die gebeurtenis in beeld en meldt het eerlijk als hij hem niet ziet. Bij een opname die er al staat: **Briefing bekijken of aanpassen**, dan **Opslaan en opnieuw plannen (gratis)** of **opnieuw analyseren** (met de kosten erbij). Wat de analyse met de briefing deed, staat bij de opname.
2. **⚙️ In productie**: bovenaan **Studio-gezondheid** (wat Ivar elke 2 minuten op de pc controleert en zelf herstelt), daarna wat de werker nu doet. De werker is het zwarte venster op de pc; laat dat open.
3. **👀 Review**: klik op **Start met keuren**. Je ziet één video tegelijk, met grote knoppen.
   - **Viralscore** (minimaal 8,0): per onderdeel een cijfer, waar het vandaan komt en het bewijs. Wat de pc niet kan meten (verhaal, originaliteit) beoordeel jij, of de **AI-inhoudscheck** (± 2 cent per Short, ± 5 per lange video): Gemini bekijkt de video en geeft per onderdeel een cijfer met tijdcodes. Zonder een van beide staat er nooit "publicatiegereed"; staat er een AI-oordeel in, dan zegt de score dat erbij. Jouw oordeel gaat altijd voor.
   - **Audio: drie opties**: A is deze versie, B energiek, C naturel. Of combineer zelf stem, muziek en effecten. **Kies deze audio** maakt de echte versie.
   - **Briefing**: per instructie ✓ / ✗ / ?, met **Laat vervallen**.
   - **Feedback op een tijdcode**, daarna **Afkeuren en opnieuw monteren** (gericht of volledig). **Vraag Ivar om advies** zet een vraag klaar bij Ivar.
   - De score is een inschatting, geen garantie op weergaven.
4. **🚀 Klaar voor YouTube**: per video een kaart. Klik **Naar YouTube sturen** en kies:
   - **Zichtbaarheid**: 🔒 Privé, 🔗 Niet vermeld of 🌍 Openbaar. Bij Openbaar vraagt de Studio het nog een keer.
   - **🗓️ Inplannen** (Nederlandse tijd): YouTube zet de video op dat moment zelf openbaar; de pc hoeft niet aan te staan.
   - **Tags**: klik ✕ om een tag weg te halen, of typ een tag en druk op Enter.
   - **Vraag AI-suggesties**: 10 tot 15 tags, 3 titels en een beschrijving om aan te klikken.

   Daarna druk je op de grote knop. Je ziet een voortgangsbalk en daarna de link naar YouTube.
5. **✅ Live**: wat op YouTube staat, de kalender en alle publicaties. Zichtbaarheid aanpassen kan hier ook.
6. **📈 Inzichten**:
   - **💡 Studio-tips**: voorstellen uit wat je vaak doet, bijvoorbeeld "Je zet Shorts altijd om 18:00 openbaar. Inplannen als standaard?" Kies Toepassen, Negeren of Nooit meer tonen.
   - **Wat werkt bij jouw kanaal**: de voorspelde score naast de echte views na 24 uur en 7 dagen.
   - **Wat nu goed loopt in je niche**: elke week de best presterende Minecraft-video's. De zoektermen kun je aanpassen.

7. **📚 Bibliotheek** (23-11-2026): het **contentregister** (elke video en Short beoordeeld, met de stand van de controle), de **muziekbibliotheek** (Uppbeat-tracks importeren, met licentie en vermelding) en de **stemverdeling** (1 op 3 Shorts, 1 op 5 lange video's).

**⚙ Instellingen**: kanalen, privé-woorden, de werker, stem en het maandplafond. Onder **Wat de Studio heeft geleerd** draai je toegepaste tips terug.

## Kosten
- AI-suggesties en het herschrijven van een script kosten een fractie van een cent.
- De luistercheck kost ongeveer 1 tot 2 cent per video.
- Alles valt binnen je plafond van € 100 per maand, dat je bij Instellingen ziet. Testvideo's zijn gratis.
- Referentievideo's ophalen kost alleen YouTube-quotum, geen geld.

## Gaat er iets mis?
- **Rode melding**: lees de tekst; meestal staat er een knop **Opnieuw proberen** bij.
- **"Werker niet bereikbaar"**: dubbelklik op `worker\start-werker.cmd` in de projectmap.
- **Een melding over een migratie**: die moet nog in Supabase worden uitgevoerd. Vraag het Claude.


## Ivar

Rechtsonder staat Ivar (of druk **Alt+I**). Vraag hem iets over het kanaal of de video die je open hebt: titels, een analyse, een editvoorstel, of "waar is mijn render mee bezig?". Ivar zet alleen concepten klaar en start alleen iets als je het echt vraagt; betaalde stappen krijgen eerst een kostenkaart. Publiceren blijft jouw klik. Meer: `docs/ivar.md`.

## SpawnNado (tweede gamekanaal)

- Kies bovenin **SpawnNado** (adres `/studio/spawnnado`). Alles werkt zoals bij KIVOXEL: uploaden, keuren, montage, naar YouTube.
- Bij **Uploaden** kies je de game: Fortnite, Roblox, GTA, Call of Duty of Minecraft. Weet je het niet, dan herkent de analyse hem. Titels, tags en beschrijving volgen die game.
- Geluid op SpawnNado: **Muziek, geen stem** (eigen muziek en het SpawnNado-deuntje, standaard) of **Alleen gamegeluid**. Geen stem, geen ondertiteling, geen vervaagde hoeken.
- Inbox-map: zet `spawnnado` in de bestandsnaam (bijv. `18-11 spawnnado fortnite.mp4`), anders gaat de opname naar KIVOXEL.

## Zonder tegoed doorwerken

- **Gemini-plafond op?** Dan gaat de Studio vanzelf gratis verder: momenten uit de gratis analyse, script uit de sjablonen, standaardtitels, -tags en -beschrijving, luistercheck alleen op regels. Uploaden, keuren en naar YouTube sturen kosten niets. De video's zijn dan wel iets minder slim.
- **Claude op?** De Studio en de werker draaien helemaal zonder Claude.
- **YouTube-koppeling verlopen?** Staat de app in Google Cloud op "Testing", dan vervalt elke koppeling na 7 dagen. Klik dan bij Instellingen → Kanalen op **Opnieuw koppelen** en kies het juiste kanaal (KIVOXEL, DreamNest of SpawnNado). Zet je de app in Google Cloud op "In production", dan hoeft dat niet meer.

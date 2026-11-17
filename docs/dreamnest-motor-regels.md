# Dreamnest-motor: vaste regels (besluit Milan, 17-11-2026)

**Kernregel:** liever weinig bewegingen die perfect zijn dan veel bewegingen die slecht zijn. Twijfel je over een beweging? Laat hem weg.

## Regels voor elk shot
1. **Eén beweging per shot**, nooit meer: bijvoorbeeld knipperen, oren laten zakken, veren opschudden, een lantaarn die gloeit of ademen.
2. **De camera staat stil:** geen zoom, geen pan, geen drift.
   - AI-clips drijven toch een beetje mee. Daarom zet `worker/dreamnest/lock_camera.py` de camera van elke lus vast.
3. **Maximaal 5 seconden per gemaakt shot.** Een langer shot maak je met een lus of slow motion, nooit met extra acties.
4. **Langzaam en rustig:** elke beweging versnelt en vertraagt zacht (ease-in-out), op babyslaap-tempo.
5. **Personages blijven op model:** dezelfde proporties, kleuren en gezichten als op de modelsheets in `content/dreamnest/characters/`.
6. **Maximaal 2 personages tegelijk in beweging.** Een derde personage ademt alleen.
7. **De achtergrond staat stil**, met hooguit zacht twinkelen of gloeien.
8. **Geen lopen en niet in beeld binnenkomen.** De AI vervormt lopende personages.

## Kwaliteitscheck per shot
Een shot komt alleen in de video als het geen van deze fouten heeft:
- vervorming
- flikkering
- morphing
- een personage dat van model verandert
- een harde knip of een AI-overgang naar een ander beeld
- een deur of een ander voorwerp dat ineens verschijnt

Haalt een shot de check niet, dan keur je het af en maak je het opnieuw. Of je maakt de beweging eenvoudiger. Is dat niet mogelijk, dan blijft het shot weg.

## Montage
- **Overvloeiers:** 1 seconde tussen de shots, nooit een harde knip. De lange slaapscènes vloeien in 4 seconden over.
- **Lengte:** die komt van lussen van goedgekeurde shots onder rustige muziek.
- **Trillen:** het filter tegen trillen middelt alleen waar niets beweegt, zodat bewegende personages scherp blijven (`ADAPTIVE_CALM` in `fase4.ts`).
- **Geen zwart:** het einde blijft op het slaapbeeld en wordt maar een beetje donkerder.
- **Na het inslapen** komen alleen nog liggende of slapende beelden, nooit meer zittende.
- **Teksten** in het Engels; kleuren zacht, warm en pastel.

## Waar het in de code staat
- **`MOTOR_RULES` en `MOTION_DNA`** in `lib/dreamnest/motion.ts`: elke nieuwe clip-prompt volgt deze regels.
- **`KERST_STORY_REJECTED`** in `worker/dreamnest/fase4.ts`: afgekeurde clips, met de reden erbij.

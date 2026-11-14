# Dreamnest fase 4: assemblage en render van 60 minuten (14-11-2026)

**Aflevering 1: "Lumi's Cozy Fireplace Night"**, 60:00, 1920×1080, 24 fps, 2,8 GB.
Op de pc: `C:\Users\famdj\FamilieMK-YouTube\dreamnest\fase4\60min\dreamnest-60min.mp4`
Preview (± 3 min): `...\60min\preview.mp4`. QC-rapport: `...\60min\qc.html` (per minuut).

## Opbouw
| Deel | Tijd | Beeld | Geluid |
|---|---|---|---|
| Welkom | 0:00-0:40 | Eigen langzame dolly-in op het buitenbeeld (≤ 2% per 10 s), 10 s overvloeier naar binnen | Twinkle op speeldoos |
| Verhaaltje | 0:30-6:00 | Per keyframe het rustige deel van de AI-clip (0,6×, heen en weer), daarna de lus van die scène; 3 s overvloeiers | Twinkle, Brahms en een eigen liedje |
| Inslapen | 6:00-12:00 | Lussen "samen onder de deken" en "iedereen slaapt", 5 s overvloeiers, dimmen begint | Eigen liedje dat langzaam uitdunt (60→54 BPM) |
| Slaaplus | 12:00-58:00 | Wisselt elke 4-8 min tussen 5 rustige lussen (nooit twee keer dezelfde achter elkaar), 0,8× vertraagd, steeds donkerder en warmer | Pads zonder beat, af en toe een speeldoosnoot, vuur, regen en bruine ruis; nieuwe akkoorden per 6 min |
| Uitloop | 58:00-60:00 | Dimt naar bijna zwart | Muziek fadet weg, zachte ruis blijft |

## Controle ✅ (automatisch)
- **Beeld:** 1920×1080, 24 fps, 60:00, tv-kleurbereik.
  - Grootste helderheidssprong tussen twee beelden: 1,8/255 (grens 25).
  - Geen harde knip: de kleinste beeldstap is 94,8% gelijk (grens 60%).
  - Rust per minuut: minimaal 98,8% in het verhaaltje en ≥ 99% daarna.
  - Helderheid 75 → 55 (minuut 30) → 25 (eind), zonder lichtsprongen.
- **Geluid:** verhaaltje -20 LUFS / -6,7 dBTP, inslapen -22 / -7,6, slaaplus -24 / -9,7. Geen stiltes en geen volumesprongen.

## Wat ik onderweg vond en oploste (uit je feedback op fase 2)
1. **Trillen:** de oorzaak was dat de tijdstempels na het samenvoegen niet doorliepen. In de eerste 70 s zaten 1318 beelden waar het er 1680 moesten zijn, dus de speler bleef hangen en sprong verder. De stukken worden nu als één doorlopende stroom samengevoegd en opnieuw genummerd (exact 24 per seconde). Daarnaast mengt een zacht tijdfilter de AI-schokjes weg.
2. **Overgangen:** ik gebruik alleen het rustige stuk van elke AI-clip, met eigen overvloeiers van 3-10 s en gelijke helderheid voor elke clip. De lichtsprong aan het begin kwam doordat het welkomstbeeld (een JPEG) in een ander kleurbereik stond. Alles staat nu op tv-bereik, en elk stuk wordt daar vóór het samenvoegen op gecontroleerd.
3. **Robuustheid:**
   - de beeldstap-meting werkt nu op beeldnummer;
   - renderstukken hebben een vingerafdruk, dus er wordt nooit een oud stuk hergebruikt;
   - de tijdlijn heeft een test die controleert dat elk deel langer is dan zijn overvloeiers.

## Hoe het draait
- `node worker/dreamnest/fase4.ts --minutes 60` (ook 90/120/180/600). Het eerste uur duurde 39 min op je pc, op lage prioriteit.
- KIVOXEL gaat voor: vóór elk stuk wacht het script als er een andere FFmpeg draait.
- Hervatbaar: wat al klaar is, wordt overgeslagen. Een kleine wijziging maakt alleen de geraakte stukken opnieuw (2-3 min).

## Kosten
Fase 4: € 0. Totaal Dreamnest: € 24,92 van € 35.

## Nog niet gedaan (volgt)
- 2.5D-parallax en procedurele lagen (vuurvliegjes, sneeuw) zijn nog niet ingebouwd. Het slaapdeel gebruikt nu de AI-lussen.
- Alles draait nog als script. Het omzetten naar de Studio (werker, widgets, kanaalwisselaar) is Fase 0.5. Daarna volgen verpakking en publiceren (Fase 5).

# Dreamnest fase 2: beweging (14-11-2026)

## Gebouwd
- **Videostekker** `worker/providers/video/omni.ts`: Gemini Omni 1.2 Flash, de opvolger van Veo 3.1 (dat Google op 22-10-2026 stopte). Werkt met begin- en eindbeeld, 3-10 s, 1080p. Stopt meteen bij een leeg Google-tegoed (402).
- **Clipplan** `content/dreamnest/shots/fase2-motion.json` + `lib/dreamnest/motion.ts`: 9 verhaalclips (keyframe → volgende keyframe) en 7 lussen (begin = eind).
- **Baby-veilige check** (gratis, FFmpeg), per clip:
  - geen flitsen (helderheidssprong > 25/255);
  - niets feller dan 200/255;
  - geen harde knip (twee beelden < 60% gelijk);
  - lussen zonder zichtbare naad.
- **Gratis naadreparatie**: het eind van een lus vloeit zacht over in het begin (eerst 1 s, dan 2 s), vóórdat er een betaalde herkansing komt.
- Clips zonder geluid (Dreamnest krijgt eigen muziek en sfeer in fase 3).
- Script: `node worker/dreamnest/fase2.ts [--only id] [--res 720p|1080p] [--dry]`.

## Resultaat
- Alle 16 clips in 1080p, 24 fps. 15 zijn veilig. "Pip komt binnen" heeft na 3,5 s een harde knip: Omni knipt als begin- en eindbeeld te veel verschillen. Oplossing: de eerste 3,5 s gebruiken en zelf zacht overvloeien naar de volgende scène.
- Testvideo (± 80 s): `C:\Users\famdj\FamilieMK-YouTube\dreamnest\fase2\preview-fase2.mp4`. Gemeten: laagste beeldstap 81% (geen knip), grootste helderheidssprong 2,4/255, helderheid hoogstens 98/255.

## Wat ik leerde (voor fase 4)
- Omni maakt een lus niet vanzelf naadloos (begin en eind lijken 80-87% op elkaar). De overvloeier lost dat gratis op.
- Verhaalclips tussen twee heel verschillende composities krijgen een overvloeier of knip midden in de clip. Beter: per keyframe "beweging op de plek" en de overgangen zelf maken bij de montage.
- Clips hebben verschillende interne tijdbases: bij de montage altijd eerst op 24 fps zetten.

## Kosten
- Totaal Dreamnest tot nu toe: **€ 24,92 van € 35** (fase 1 € 4,20, fase 2 € 20,72).
- Les: de eerste run betaalde voor elke lus een herkansing, vóórdat de gratis naadreparatie bestond (± € 6). Dat gebeurt nu niet meer.
- 14-11-2026: het Google AI Studio-tegoed was even op (402). Daardoor lag ook de KIVOXEL-analyse stil, tot Milan het aanvulde.

## Controle
- `tsc` ✅, tests ✅, KIVOXEL-rooktest ✅. Geen nieuw scherm in de app.

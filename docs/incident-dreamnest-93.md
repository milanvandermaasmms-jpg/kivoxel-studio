# Incident: Dreamnest 60 min "hangt op 93%" (onderzocht 15-11-2026 ±06:10)

Alleen gekeken, niets gestopt of verwijderd.

## Feiten (gemeten)
- Map: `C:\Users\famdj\FamilieMK-YouTube\dreamnest\fase4\60min-v3`.
- `dreamnest-60min.mp4`: 1807 MB, 3599,9 s (59:59), h264 1920×1080 24 fps + aac. Klaar om 14-11 20:18:52. **De aflevering zelf is af.**
- `qc.json` (20:24:54): audio in orde (-20 / -21,9 / -24 LUFS, true peak -6 tot -8,8 dB); beeld: 3 minuten "onrustig" (minuut 10, 25, 26). Dus: eerst die drie minuten bekijken.
- Daarna startte de preview (3 min): FFmpeg pid 20980 sinds 14-11 20:24:54, 4 invoeren van hetzelfde bestand (`-ss 0/345/1320/3570`) samengevoegd met het `concat`-filter (beeld + geluid). `preview.mp4` bleef op 12,8 MB (20:25:15) staan.
- Het proces gebruikt **0 s CPU** (272 s totaal in 12 uur, geen toename in 5 s). Het hangt; het rendert niet.
- Aanroeper: `worker\dreamnest\fase4.ts --minutes 60 --seed 11` (pid 27272, sinds 19:56). Werker pid 24524 (sinds 19:40). Schijf: 91 GB vrij.

## Oorzaak (categorie C: eindverwerking vastgelopen)
De preview gebruikt sinds commit d989f22 het concat-filter over 4 keer hetzelfde lange bestand. Zo'n filtergraaf kan vastlopen (FFmpeg wacht op een invoer die niet meer levert); de werker heeft geen bewaking op "geen voortgang", dus de stap blijft eeuwig "bezig" en de voortgang blijft op ±93% staan.
Waarschijnlijk, niet 100% bewezen: de exacte FFmpeg-interne oorzaak is niet gemeten (geen log; `-v error`).

## Herstel (vraagt Milans akkoord)
1. FFmpeg pid 20980 stoppen. De 60-minutenversie en `qc.json` blijven staan.
2. Preview opnieuw maken uit losse stukjes (elk stuk apart coderen, dan de concat-demuxer), zoals de aanpak van 18:45 (`preview-0..3.mp4`).
3. Bewaking: een FFmpeg-stap zonder groei van uitvoer of CPU gedurende 10 minuten wordt gestopt en als "vastgelopen" gemeld, met de reden in de studio.

## Niet gedaan
- Niets gestopt, niets herstart, geen bestanden aangeraakt.

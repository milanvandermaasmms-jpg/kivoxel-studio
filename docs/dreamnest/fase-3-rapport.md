# Dreamnest fase 3: muziek en sfeergeluid (14-11-2026)

## Gebouwd
- `docs/dreamnest/music-principles.md`: tempo, instrumenten, volume en bronnen, met bronvermelding. Geen medische claims.
- **Eigen muziekgenerator** (`lib/dreamnest/music.ts`):
  - publiek-domein-melodieën in een eigen arrangement: Twinkle, en het Wiegenlied van Brahms;
  - eigen nieuwe slaapliedjes die de Studio zelf componeert: pentatonisch, kleine stapjes, AABA, eindigt thuis. Per aflevering een ander liedje (seed). Dat is eigen werk, dus er is geen Content ID-risico, en het helpt tegen de "repetitive content"-regel.
- **Eigen synthesizer** (`worker/dreamnest/audio/synth.ts`): speeldoos, celesta, harp en pad, zonder samples of opnames van anderen. Elke noot begint zacht, en een test controleert dat er geen klikken in zitten.
- **Sfeergeluid Huiskamer**: rustig knisperend haardvuur, regen op het raam en bruine ruis. Volledig zelf gemaakt.
- **Mastering per deel** (FFmpeg): eigen galm, low-pass op 7 kHz en luidheid in twee stappen (zonder pompen), plus een zachte limiter.
- **Automatische geluidscheck** (`lib/dreamnest/audioqc.ts`): luidheid per deel, true peak, stiltes > 2 s en volumesprongen > 3 LU.

## Resultaat (testfragment, 6:26)
| Deel | Duur | Doel | Gemeten | Piek | QC |
|---|---|---|---|---|---|
| Welkom en verhaaltje | 2:50 | -20 LUFS | -20,0 | -7,1 dBTP | ✅ |
| Inslapen | 2:20 | -22 LUFS | -21,9 | -7,0 dBTP | ✅ |
| Slaaplus (begin) | 1:36 | -24 LUFS | -23,9 | -10,0 dBTP | ✅ |

- Bestanden op de pc: `C:\Users\famdj\FamilieMK-YouTube\dreamnest\fase3\` (`dreamnest-fase3-test.m4a`, losse delen als WAV, `qc.json` met de herkomst van elke melodie).
- Met spectrogram nagekeken: de melodie is goed zichtbaar. Het vuur knispert nu rustiger (2,5 per seconde), en de speeldoos in de slaaplus staat iets meer naar voren.
- Ik kan zelf niet luisteren. **Milans oor is de echte toets**: klank, balans tussen muziek en vuur/regen, en het tempo.

## Kosten
€ 0 in deze fase. Totaal Dreamnest: € 24,92 van € 35.

## Klaar voor fase 4
- Lengte en verloop per deel zijn instelbaar (seed, tempo, mate van uitdunnen, balans muziek/sfeer). In de Studio worden dat later de schuifjes.
- Voor 60+ min maakt de generator het slaapdeel in stukken met wisselende akkoorden en noten, met overvloeiers van 10 s ertussen.

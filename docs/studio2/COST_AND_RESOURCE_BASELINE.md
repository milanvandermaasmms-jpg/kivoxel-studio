# Kosten- en middelenbasis (15-11-2026)

## Geld (gemeten in de studio)
- Gemini (Flash-Lite): **€ 2,22 van € 5,00** gebruikt in november (stand 14-11 avond); waarvan Ivar € 0,05. Plafond via `reserve_yt_cost`; boven het plafond weigert de database.
- Google TTS: alleen het gratis deel (teller op de pc, grens 900.000 tekens/maand).
- YouTube API: alleen quota (geen geld); dagelijkse uploadlimiet bereikt op 2 dagen.
- Dreamnest: eigen budget (DREAMNEST_BUDGET_CENTS, afgesproken € 35) voor Google-generaties; de montage zelf is gratis (FFmpeg op de pc).
- Claude Code: abonnement (Pro + extra tegoed) is **geen** API-tegoed; de studio gebruikt geen Claude API.

## Pc
- Intel i5-12450H, 8 kernen/12 threads, 16 GB RAM, Intel UHD (Quick Sync voor h264 mogelijk, nog niet gebruikt), 91 GB vrij.
- Opslag: opnames 25,5 GB (13), renders 10,9 GB (285 bestanden, 92 mp4), Dreamnest 22,7 GB, proxies 0,2 GB.
- Tijden (gemeten): Dreamnest 60 min opnieuw samenvoegen uit bewaarde stukken ± 2 min; QC ± 6 min; preview (nieuw) 79 s.

## Wat dubbele kosten kan geven (gecontroleerd)
- Idempotent: stappen met `idempotency_key`; `reserve_yt_cost` één keer per stap; Ivar-antwoorden via dezelfde stap bij opnieuw.
- Niet idempotent: "opnieuw analyseren" (nieuwe sleutel per minuut, kost opnieuw), "opnieuw script" (nieuwe versie = nieuwe Gemini-call). Bewust, met Milans klik.

## Schatting herstel van de 49 video's (alleen Gemini, schatting)
- Nieuwe verteltekst per Short met beeldcontrole: ± 1-2 cent → 37 Shorts ≈ € 0,40-0,75.
- Per lange video/deel (tekst + controle per hoofdstuk): ± 3-6 cent → 12 ≈ € 0,35-0,75.
- Opnieuw analyseren op hogere resolutie (alleen waar nodig): ± 35 cent per uur opname (bestaande schatting).
- Montage en stem: gratis (pc + gratis TTS-deel), mits de TTS-teller niet over 900.000 tekens gaat.

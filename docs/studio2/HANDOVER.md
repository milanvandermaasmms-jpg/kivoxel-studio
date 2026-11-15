# Studio 2.0: overdracht (15-11-2026, ± 07:30 UTC)

Lees eerst: `REBUILD_PLAN.md`, `PRODUCTION_FAILURES.md`, `PILOT_KIVOXEL.md`, `REHABILITATION.md` in deze map.
Code: branch `feature/ivar` = `feature/dreamnest` (f71acc7), **niet gepusht** (main staat op 0e27f18). Werker draait uit worktree `dreamnest-b58e7c`.

## Gedaan en getest
- Dreamnest: preview hing 12 uur → preview uit losse stukken + FFmpeg-bewaking (10 min geen voortgang = stop met reden); studio toont de echte deelstap i.p.v. een blijvend percentage. Aflevering 60 min af; QC: minuut 10, 25, 26 "onrustig" (Milan bekijkt). Kopie: `dreamnest\backup\60min-v3-2026-11-14`.
- KIVOXEL-standaard (alleen bij het script, payload `grounded:false` zet uit):
  - beeldbewijs: frames uit de echte opname → Gemini noteert wat zichtbaar is (`lib/youtube/grounding.ts`);
  - editor vóór het script: vulling/menu's eruit, zoom op dreiging, punch-in (65%) op de 1-2 belangrijkste gebeurtenissen (`lib/youtube/editPolish.ts`);
  - script met harde regels (geen harten/donker/val zonder bewijs), controle die onjuiste zinnen herschrijft, stiltes aanvullen, zinnen 6-14 woorden;
  - keuring: `payload.assess=true` op een script-stap geeft `strength` zonder script te schrijven;
  - QC telt knippen/zooms uit het plan (`planChanges`); stem per montage via `payload.voice_name`.
- Shorts 15-45 s (TARGET A/B min 15 s; filler eruit bij Shorts met actie) — **werkt na de volgende werkerherstart**.
- Keuring van alle 49 niet-live: 9 B, 10 C (lang), 17 C? (matig), 13 D (`REHABILITATION.md`).
- B-batch (8 Shorts, script v2/v3 met bewijs + montage Charon): 4 klaar en volledig groen bij het schrijven, 4 liepen nog (job-ids: yt_jobs met idempotency `render:<script>:studio2-charon`).
- Milan verhoogde het maandplafond (15-11) zodat C en C? passen; advies was € 10.

## Nog te doen (volgorde)
1. Werker herstarten (pas als de B-montages klaar zijn) → B-Shorts opnieuw met de 15-45 s-regel (script + montage, ± € 0,40); oud en nieuw naast elkaar voor Milan.
2. C: 10 lange video's/delen opnieuw met bewijs (± € 1). Let op: frames-limiet 40 per video; voor delen van 7-10 min eventueel per hoofdstuk.
3. Herstelcentrum in de studio (fase 2-dashboard): tabel met categorie, redenen, oud/nieuw-preview, goedkeuren. Data: `yt_jobs.result` van de assess- en script-stappen.
4. Dreamnest-proef (mijlpaal 4): de 3 onrustige minuten gericht repareren; 3-min proef vóór lange renders.
5. Analytics: `avg_view_pct` is leeg bij alle video's — Analytics-koppeling nakijken.
6. Pas na Milans akkoord: pushen naar main (Vercel).

## Regels die gelden
Geen service-sleutel om na te kijken (gebruik de app-sessie), migraties via Milans klembord, werker alleen herstarten met akkoord en zonder lopende FFmpeg, niets publiceren.

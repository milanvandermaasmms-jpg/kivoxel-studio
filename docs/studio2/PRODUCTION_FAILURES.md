# Productiefouten (15-11-2026)

Soorten: **B** = bevestigde technische fout · **K** = waarschijnlijk kwaliteitsdefect · **H** = niet-geverifieerde hypothese · **O** = ontbrekende functie · **E** = beperking van een externe dienst.

| # | Fout | Soort | Bewijs | Status |
|---|---|---|---|---|
| 1 | Dreamnest-preview hing 12 uur (FFmpeg 0 CPU, concat-filter over 4× hetzelfde uur-bestand) | B | `docs/incident-dreamnest-93.md` | **Gerepareerd** (7a9d2a7): preview uit losse stukken, getest op de kopie (3:00, 79 s) |
| 2 | Geen bewaking op FFmpeg-stilstand in Dreamnest | O | idem | **Gerepareerd** (7a9d2a7): na 10 min zonder voortgang gestopt met reden |
| 3 | Werkerherstart onderbrak de Dreamnest-montage | B | stap 5 "Onderbroken: de werker is opnieuw gestart" | Hersteld door hervatting (stukken bleven bewaard); les: niet herstarten tijdens FFmpeg |
| 4 | Verteltekst klopt niet met het beeld (harten, donker, vallen) | B | 13 notities van Milan (VIDEO_INVENTORY) | Open: script ziet het beeld niet |
| 5 | Te weinig spraak: lange video's 14-44% (gem. 20%), stiltes tot 144 s | B | gemeten, VIDEO_INVENTORY | Open |
| 6 | Shorts: gem. 40% spraak, soms 11-24% | K | gemeten | Open (maar: de best bekeken Short had 10 woorden → niet blind opvullen) |
| 7 | Viral-score voorspelt niet (7-9 bij 6-30 weergaven) | K | live cijfers | Open: score is alleen een interne indicatie |
| 8 | Kijkpercentage/kijkduur leeg bij alle video's | E/H | `yt_video_snapshots.avg_view_pct` null | Uitzoeken: Analytics-scope of vertraging |
| 9 | Dubbele/rare titels (nr. 64/69 zelfde titel, Nederlandse titel op Engels kanaal) | K | VIDEO_INVENTORY | Open: titelcontrole |
| 10 | Dreamnest QC: minuut 10, 25, 26 "onrustig" | K | qc.json | Open: Milan bekijkt; daarna gerichte reparatie |
| 11 | Momentanalyse op lage resolutie (`MEDIA_RESOLUTION_LOW`) | H | `worker/gemini.ts` | Mogelijke oorzaak van gemiste/zwakke momenten |

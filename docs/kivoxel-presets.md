# KIVOXEL: smaak aanpassen zonder code

Alles wat "smaak" is staat in gewone bestanden. Pas ze aan in een teksteditor (Kladblok of VS Code), sla op en herstart de werker als hij niets aan het doen is. Bij het starten meldt de werker in het venster meteen of er een fout in staat (regels die beginnen met `Config:`).

| Bestand | Wat staat erin |
|---|---|
| `config/kivoxel/presets.json` | Audio-modi, lengte-buckets van Shorts, sync-regels van de stem, mix (−14 LUFS), retentie-features en presets |
| `config/kivoxel/hooks.json` | De hook-teksten bovenaan Shorts, per event-type (fail, bijna_dood, geluk, bouw, grap, jumpscare). **Alleen Engels.** |
| `config/kivoxel/script_templates.json` | Zinnen van de gratis script-engine (openers, anticipatie, open loops, bruggen, slotzinnen). **Alleen Engels, explosief.** |
| `config/kivoxel/voice_persona.json` | Hoe de verteller praat: stijlregels, verboden zinnen, reacties (slecht/goed) die rouleren, stem-stijlen per zin |
| `brand/thumbnail_header.json` | **Heilig.** De gele header van elke thumbnail: lettertype, kleur, rand, schaduw, plek en grootte |

> Alles wat in de video komt is **Engels, altijd**. Een test faalt als er een Nederlands woord in deze bestanden staat.

## Een hook toevoegen
Zet hem in `hooks.json` bij het juiste type. Regels (de tests en de werker controleren ze):
- 1 tot 4 woorden, alles in HOOFDLETTERS, Engels;
- eerlijk: de Short moet waarmaken wat er staat (de hook wordt gekozen op het echte event);
- per type minstens 10 hooks: dezelfde hook komt pas na 10 Shorts terug;
- emoji mogen (voor de titel); in het beeld laat de Studio ze weg, want het lettertype kan ze niet tekenen.

## Lengte van Shorts
De lengte volgt de inhoud: de kortste lengte waarin hook → spanning → payoff compleet is (`length_buckets` in `presets.json`: Loop 7-14 s, Kort 15-25 s, Midden 26-40 s, Verhaal 41-58 s; Verhaal alleen met echte opbouw). Twee Shorts na elkaar uit dezelfde opname krijgen nooit dezelfde bucket, en de exacte lengte is nooit een rond getal. Menu's, stilstand en zwart beeld in het stuk worden eruit geknipt; de payoff zelf blijft heel.

## Een preset maken
Voeg in `presets.json` onder `presets` een blok toe. Je noemt alleen wat anders moet dan `base`, bijvoorbeeld:

```json
"spannend": { "label": "Spannend", "features": { "interrupt_every_ms": [2000, 3000] } }
```

## De gele header
Elke thumbnail wordt na het maken gecontroleerd: op de plekken waar de letters horen te staan moet de kleur `color_hex` zijn. Wijkt hij af (andere kleur, andere plek, lettertype niet geïnstalleerd), dan wordt de thumbnail weggegooid en staat er een rode regel in de kwaliteitscontrole. Verander dit bestand dus alleen als je de huisstijl echt wilt veranderen.

## Muziek en geluidseffecten
Komt in stap 5: een map met rechtenvrije tracks plus labels (energie, sfeer, bpm). Hoe je tracks toevoegt staat dan hier.

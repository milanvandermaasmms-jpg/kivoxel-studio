# KIVOXEL: smaak aanpassen zonder code

Alles wat "smaak" is staat in gewone bestanden. Pas ze aan in een teksteditor (Kladblok of VS Code), sla op en herstart de werker als hij niets aan het doen is. Bij het starten meldt de werker in het venster meteen of er een fout in staat (regels die beginnen met `Config:`).

| Bestand | Wat staat erin |
|---|---|
| `config/kivoxel/presets.json` | Audio-modi, lengte-buckets van Shorts, sync-regels van de stem, mix (−14 LUFS), retentie-features en presets |
| `config/kivoxel/hooks.json` | De hook-teksten bovenaan Shorts, per event-type (fail, bijna_dood, geluk, bouw, grap, jumpscare), in `nl` en `en` |
| `config/kivoxel/voice_persona.json` | Hoe de verteller praat: stijlregels, verboden zinnen, uitdrukkingen die rouleren, stem-stijlen per zin |
| `brand/thumbnail_header.json` | **Heilig.** De gele header van elke thumbnail: lettertype, kleur, rand, schaduw, plek en grootte |

## Een hook toevoegen
Zet hem in `hooks.json` bij het juiste type en de juiste taal. Regels (de tests en de werker controleren ze):
- 1 tot 4 woorden, alles in HOOFDLETTERS;
- eerlijk: de Short moet waarmaken wat er staat;
- per type en taal minstens 3 hooks, geen dubbele.

## Een preset maken
Voeg in `presets.json` onder `presets` een blok toe. Je noemt alleen wat anders moet dan `base`, bijvoorbeeld:

```json
"spannend": { "label": "Spannend", "features": { "interrupt_every_ms": [2000, 3000] } }
```

## De gele header
Elke thumbnail wordt na het maken gecontroleerd: op de plekken waar de letters horen te staan moet de kleur `color_hex` zijn. Wijkt hij af (andere kleur, andere plek, lettertype niet geïnstalleerd), dan wordt de thumbnail weggegooid en staat er een rode regel in de kwaliteitscontrole. Verander dit bestand dus alleen als je de huisstijl echt wilt veranderen.

## Muziek en geluidseffecten
Komt in stap 5: een map met rechtenvrije tracks plus labels (energie, sfeer, bpm). Hoe je tracks toevoegt staat dan hier.

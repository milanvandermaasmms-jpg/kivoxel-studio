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

## Audio-modi
Per montage kies je in de review (of bij "Montage") het geluid; het script blijft hetzelfde:
- **Stem + muziek** (`vo_muziek`, standaard): verteller met EQ/compressie/lichte ruimte, muziek zacht en geduckt onder de stem, gamegeluid hoorbaar.
- **Muziek, geen stem** (`muziek_geen_vo`): het verhaal staat als grote tekst in beeld (vóór de actie), muziek duikt licht onder de game-pieken.
- **Alleen gamegeluid** (`alleen_game`): tekst in beeld + geluidseffecten.
Alles eindigt op −14 LUFS en een true peak van hooguit −1 dB (twee passes, het beeld wordt niet opnieuw gecodeerd). De standaard per kanaal staat in `presets.json` bij `channel_default.audio_mode`.

## Muziek toevoegen
Onderzoek en advies: `docs/kivoxel-muziek-onderzoek.md`. **Alleen rechtenvrije muziek, met bron en licentie.**
1. Zet het bestand (mp3, wav, ogg, m4a of flac) in `C:\Users\<jij>\FamilieMK-YouTube\kivoxel-media\music\`.
2. Voeg in `library.json` in die map een regel toe bij `tracks`, bijvoorbeeld:
   ```json
   { "file": "blocky-rush.mp3", "title": "Blocky Rush", "artist": "Naam", "source": "YouTube Audiobibliotheek", "license": "geen naamsvermelding vereist", "energy": 5, "moods": ["hype", "funny"], "bpm": 140, "beat_offset_ms": 0 }
   ```
   - `energy`: 1 (rustig) tot 5 (maximaal). `moods`: een of meer van hype, tense, happy, chill, funny, epic, dark.
   - `bpm`: tempo (staat vaak bij de track). `beat_offset_ms`: waar de eerste tel zit (meestal 0). Hiermee valt een maatslag precies op de payoff.
3. Klaar: de werker kiest zelf op sfeer en energie en rouleert (dezelfde track pas na 6 video's).
De drie `TEST …`-tracks in die map zijn door ons gemaakt om de mix te testen: de werker gebruikt ze **nooit** in een echte video. Zonder echte tracks wordt een montage in "Stem + muziek" gemaakt zonder muziek, met een oranje regel in de kwaliteitscontrole.

## Zonder AI-tegoed (gratis modus)
Alles werkt ook zonder Gemini en zonder Google-stem, automatisch:
- **Analyse:** zonder sleutel, zonder tegoed of als de dienst plat ligt, komen de momenten uit de gratis analyse (hartjes, doodscherm, klappen, harde geluiden). In het mini-rapport staat dan "gratis engine".
- **Script:** de sjabloon-engine (`script_templates.json`) met dezelfde anticipatieregel en sync-gate.
- **Stem:** Google zolang er een sleutel is en het gratis deel niet op is; anders de beste lokale stem op deze pc.
- **Altijd gratis kiezen:** zet in `presets.json` bij `channel_default` `"engine": "free"`.

### Lokale stemmen
| Stem | Waar | Kwaliteit |
|---|---|---|
| **Kokoro** (`am_puck`, `am_michael`, …) | npm-pakket `kokoro-js`, model in `FamilieMK-YouTube\kivoxel-tts\kokoro-cache` | meestal de natuurlijkste lokale stem |
| **Piper** (`en_US-ryan-high`) | `FamilieMK-YouTube\kivoxel-tts\piper\` | natuurlijk en snel |
| **Windows** (Zira) | ingebouwd | robotachtig, alleen als laatste vangnet |

Welke eerst komt, staat in `presets.json` bij `voice.local_order`; de Kokoro-stem bij `voice.kokoro_voice`. Luister eerst naar de vergelijking (`node scripts/kivoxel-voicecompare.ts <opname>` maakt `testrenders/stemmen/`) en zet je favoriet bovenaan.

## Geluidseffecten (SFX)
De standaard-SFX (whoosh, impact, record scratch, pop, riser) zijn door ons zelf gemaakt met `scripts/kivoxel-make-media.ts` en staan in de repo (`assets/kivoxel/sfx`). Whoosh komt op elke knip, impact op grote pieken, scratch bij een dood; varianten rouleren. Eigen SFX: zet ze in `FamilieMK-YouTube\kivoxel-media\sfx\` met een `library.json` (`{ "sfx": [{ "file": "boom.wav", "kind": "impact" }] }`; kind is whoosh, impact, scratch, pop of riser).

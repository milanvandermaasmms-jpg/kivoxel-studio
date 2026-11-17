# KIVOXEL: smaak aanpassen zonder code

Alles wat "smaak" is staat in gewone bestanden. Pas ze aan in een teksteditor (Kladblok of VS Code), sla op en herstart de werker als hij niets aan het doen is. Bij het starten meldt de werker in het venster meteen of er een fout in staat (regels die beginnen met `Config:`).

| Bestand | Wat staat erin |
|---|---|
| `config/kivoxel/presets.json` | Audio-modi, lengte-buckets van Shorts, sync-regels van de stem, mix (−14 LUFS), retentie-features en presets |
| `config/kivoxel/hooks.json` | De hook-teksten bovenaan Shorts, per event-type (fail, bijna_dood, geluk, bouw, grap, jumpscare). **Alleen Engels.** |
| `config/kivoxel/script_templates.json` | Zinnen van de gratis script-engine (openers, anticipatie, open loops, bruggen, slotzinnen). **Alleen Engels, explosief.** |
| `config/kivoxel/voice_persona.json` | Hoe de verteller praat: stijlregels, verboden zinnen, reacties (slecht/goed) die rouleren, stem-stijlen per zin |
| `lib/youtube/analysis.ts` | **Verdeling per upload** (besluit Milan, 17-11-2026): hoogstens 2 lange video's (`MAX_LONG_VIDEOS`) en Shorts zonder maximum: elk goed moment (actie, dood, fail, grappig, jumpscare, bijna dood) wordt een eigen Short, in wisselende lengtes uit de lengte-buckets |
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

## Audio-modi (de drie opties, Milan 16-11-2026)
Per montage kies je in de review het geluid ("Opnieuw monteren met dit geluid"); het script blijft hetzelfde:
1. **Stem + ondertiteling** (`vo_muziek`, standaard): de verteller (bij Shorts de stem van je zoon met Amerikaanse uitspraak), het gamegeluid en ondertitels die precies met de stem meelopen. Geen muziek.
2. **Muziek, geen stem** (`muziek_geen_vo`): muziek die meebeweegt met de inhoud (druk en snel bij actie, rustig bij zoeken en farmen, met zachte overgangen; een maatslag valt op de piek), het gamegeluid en alleen de gele tekst bovenin. Geen ondertiteling of verhaaltekst.
3. **Alleen gamegeluid** (`alleen_game`): alleen het echte gamegeluid. Geen stem, muziek, ondertitels, tekst of effecten (bij Shorts blijft de gele hook staan).

De gele tekst bovenin: bij Shorts de hele Short, bij lange video's de eerste minuut (daarna vervaagt hij).
Alles eindigt op −14 LUFS en een true peak van hooguit −1 dB. De standaard per kanaal staat in `presets.json` bij `channel_default.audio_mode`: sinds 16-11-2026 is dat **Muziek, geen stem** (besluit Milan).

## Muziek toevoegen
Onderzoek en advies: `docs/kivoxel-muziek-onderzoek.md`. **Alleen rechtenvrije muziek, met bron en licentie.**
1. Zet het bestand (mp3, wav, ogg, m4a of flac) in `C:\Users\<jij>\FamilieMK-YouTube\kivoxel-media\music\`.
2. Voeg in `library.json` in die map een regel toe bij `tracks`, bijvoorbeeld:
   ```json
   { "file": "blocky-rush.mp3", "title": "Blocky Rush", "artist": "Naam", "source": "YouTube Audiobibliotheek", "license": "geen naamsvermelding vereist", "energy": 5, "moods": ["hype", "funny"], "bpm": 140, "beat_offset_ms": 0 }
   ```
   - `energy`: 1 (rustig) tot 5 (maximaal). `moods`: een of meer van hype, tense, happy, chill, funny, epic, dark.
   - `bpm`: tempo (staat vaak bij de track). `beat_offset_ms`: waar de eerste tel zit (meestal 0). Hiermee valt een maatslag precies op de payoff.
3. Klaar. Per video kiest de werker één druk nummer (energie 4-5) voor de actie en één rustig nummer (energie 1-3) voor zoeken en farmen, en wisselt mee met de inhoud. Hij rouleert: hetzelfde nummer pas na 6 video's.

Nu in de bibliotheek (16-11-2026): 12 nummers van Pixabay Music (gratis, ook voor YouTube met inkomsten, geen naamsvermelding). Bron en licentie staan per nummer in `library.json`. Krijg je toch een auteursrechtclaim op YouTube, dan betwist je die met de Pixabay-licentie.
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

Welke eerst komt, staat in `presets.json` bij `voice.local_order`; de Kokoro-stem bij `voice.kokoro_voice`. **Gekozen door Milan (16-11-2026): Kokoro `am_puck`**, daarna Piper, Windows als laatste. Luister eerst naar de vergelijking (`node scripts/kivoxel-voicecompare.ts <opname>` maakt `testrenders/stemmen/`) en zet je favoriet bovenaan.

## Geluidseffecten (SFX)
De standaard-SFX (whoosh, impact, record scratch, pop, riser) zijn door ons zelf gemaakt met `scripts/kivoxel-make-media.ts` en staan in de repo (`assets/kivoxel/sfx`). Whoosh komt op elke knip, impact op grote pieken, scratch bij een dood; varianten rouleren. Eigen SFX: zet ze in `FamilieMK-YouTube\kivoxel-media\sfx\` met een `library.json` (`{ "sfx": [{ "file": "boom.wav", "kind": "impact" }] }`; kind is whoosh, impact, scratch, pop of riser).

## Stemkloon (de stem van je zoon)
- De verteller van Shorts is standaard een **stemkloon** (Chatterbox, gratis, MIT-licentie, alleen op deze pc). Hij spreekt Engels met de klank van de referentie-opname in `FamilieMK-YouTube\kivoxel-tts\voice-ref\kind.wav`. Die opname staat **nooit** in Git of in Supabase.
- Andere opname gebruiken: vervang `kind.wav` door 8-15 seconden heldere spraak, zonder muziek, en herstart de werker.
- In `presets.json` bij `voice.clone`: `use` (aan/uit), `shorts_only` (lange video's houden Google, want de kloon is traag zonder NVIDIA-kaart: ongeveer 35 s per zin) en `boost` (hoger = uitbundiger).
- Lukt de kloon niet, dan neemt Google het over, en daarna de lokale stem (Kokoro puck).
- **YouTube-regel:** een nagemaakte stem van een echt persoon moet je melden. Bij een video met de stemkloon blokkeert de Poortwachter het publiceren tot **AI-melding = Ja** staat.

## Reacties van de kinderen (Whisper)
De werker luistert met Whisper (lokaal, gratis) rond de sterkste momenten. Een korte, harde kreet wordt een moment in de Event Timeline, en daar praat de verteller niet overheen, zodat de echte reactie hoorbaar blijft. De woorden blijven op de pc (`FamilieMK-YouTube\speech`) en komen nooit in beeld. **Tip:** zet op de PS5 bij opnemen "microfoongeluid opnemen" aan; in de huidige opnames is alleen gamegeluid te horen.

## Freeze-frame en loop-einde
- Na de grootste fail in een Short staat het beeld 0,7 s stil met een korte tekst ("OOF!", "RIP!", …). Die teksten staan in `script_templates.json` bij `freeze_text`, rouleren en zijn alleen Engels.
- Het einde van elke Short vloeit in 0,4 s over in het eerste frame, zodat een herhaling naadloos doorloopt. Uitzetten kan met `features.loop_ending`.

## Leren van wat je goedkeurt
Scripts die je goedkeurt, zijn voorbeelden. Hun algemene zinnen (zonder mob, item, getal of naam van één video) komen in de pools van de gratis engine, met dubbel gewicht.

## Kwaliteitscontrole
Een montage met een rode check gaat niet meteen naar Te keuren: de werker maakt hem eerst automatisch nog één keer. Is hij dan nog rood, dan komt hij wel in de review, maar kun je pas goedkeuren als je aanvinkt dat je de rode checks hebt gezien.

## Alles opnieuw door de montage
Bij **Klaar voor YouTube** staat de knop **🔁 Opnieuw door de nieuwe montage**. Elke klaarstaande video van een gamekanaal krijgt dan een nieuw script met de nieuwe engine, en de werker monteert hem meteen. Daarna staat hij weer bij Te keuren. Dreamnest doet hier niet aan mee.

# KIVOXEL Studio: overdracht voor een nieuwe Claude-assistent

> Stand 16-11-2026, 22:00. Lees dit eerst helemaal; daarna `CLAUDE.md`, `AGENTS.md` en `docs/kivoxel-presets.md` in de repo.

## 1. Wat het is
- **KIVOXEL Studio**: Milans eigen productiestudio voor YouTube.
  - **KIVOXEL**: faceless Minecraft-kanaal, gameplay van zijn kinderen.
  - **Dreamnest**: slaapvideo's voor baby's ("Lumi"), 60 minuten of langer.
- **Werkverdeling:**
  - De Studio (website) regelt, keurt en publiceert.
  - De werker op Milans Windows-pc monteert alles lokaal met FFmpeg.
- **Over Milan:**
  - Geen programmeur. Uitleg in gewoon Nederlands, kort.
  - Code, bestanden en variabelen in het Engels.
  - Werkt op Windows.

## 2. Stack en waar alles staat
| Onderdeel | Waar |
|---|---|
| Repo | `github.com/milanvandermaasmms-jpg/kivoxel-studio`, branch `main` (alles staat daar) |
| Lokaal | `C:\Users\famdj\Documents\kivoxel-studio` |
| Website | Next.js 16 (App Router, wijkt af van oudere Next: lees `node_modules/next/dist/docs/`), React 19, TS, Tailwind 4, Vitest. Lokaal **poort 3200**, online op Vercel (auto-deploy bij push naar `main`) |
| Database | Supabase-project `odrzruieoqtcffyypsaj` (gratis plan, limiet overschreden; Milan neemt Pro). Migraties `supabase/migrations/001…057` |
| Werker | `worker/` (Node, draait TS direct), **poort 3210**, gestart met `worker\start-werker.cmd`. Er draait er altijd maar één |
| Data op de pc | `C:\Users\famdj\FamilieMK-YouTube\` (opnames, renders, muziek, stemmodellen, Dreamnest-bestanden). **Video's staan nooit in Supabase**, alleen metadata |
| Sleutels | Alleen in `.env.local` en `worker/.env.local`. Nooit in code, Git of chat |

## 3. Harde regels (van Milan; altijd volgen)
- **Eerst vragen** bij: een account of project aanmaken, alles wat geld kost, een migratie uitvoeren, pushen. Milan heeft vaak gezegd "push alles"; vraag bij twijfel.
- **Migraties** gaan via Milans klembord:
  - Zet de migratie klaar met `Set-Clipboard` en controleer de lengte.
  - Milan plakt hem in de SQL Editor en klikt op Run.
  - Chrome-vertaling voor supabase.com staat uit; anders werd `commit` "verbinden".
- **De service-sleutel** nooit gebruiken om iets in de database na te kijken.
- **Publiceren** is altijd Milans eigen klik; er gaat nooit iets automatisch online.
- **De werker** nooit herstarten of stoppen zonder te vragen, en nooit terwijl FFmpeg of een analyse loopt.
  - Milan heeft gezegd "herstarten wanneer het kan".
  - Methode: wacht tot er geen FFmpeg-proces van de werker draait en herstart dan. Een taak die halverwege was, pakt de werker daarna zelf opnieuw op.
- **Niet aanraken:** `regioacties-dashboard`, poort 3000 en poort 3100 (familie-dashboard).
- **Video-content is altijd Engels**, ook stem, hooks, tekst en thumbnails. Alleen de Studio zelf is Nederlands.
- **Toon:** explosief en hyper (gamer-hype), wel kindvriendelijk.
- **Kinderen:** gezicht, stem en gamertag mogen in beeld. Nooit hun echte naam, school of woonplaats.
- **Kosten:**
  - Gemini Flash-Lite: maximaal € 5 per maand.
  - Google TTS: alleen het gratis deel.
  - Geen Claude API en geen ElevenLabs zonder budget van Milan.
  - Dreamnest-AI-budget: € 31,25 van € 35 gebruikt.
- **Een fase is pas af na:** `npx tsc --noEmit`, `npm test`, `npm run build`, een controle in de browser en een proefvideo voor Milan.
- **Gebruiksbudget van Milan (Claude Pro):** werk zuinig, geen onnodige subagents of grote verkenningen.

## 4. Pipeline KIVOXEL (zo werkt de montage nu)
1. **Opname**
   - Komt binnen via Uploaden of de inbox (`C:\Users\famdj\KIVOXEL\inbox`).
   - Intake: analyse van momenten. Gemini, of gratis lokaal.
   - **Event Timeline:** hartjes-HUD, doodscherm, schade, geluidspieken, menu's, stilstand (`lib/kivoxel/events.ts`).
   - Reacties van de kinderen via lokale Whisper (de woorden blijven op de pc).
2. **Script** (`worker/queue.ts` → `script`)
   - Shorts krijgen een lengte-bucket (Loop/Kort/Midden/Verhaal) en een hook uit `config/kivoxel/hooks.json`.
   - **Anticipatie-regel:** de stem vertelt wat er gaat gebeuren, en elke zin hangt aan een moment uit de tijdlijn.
   - Gemini, of de gratis sjabloon-engine. De gratis engine leert van goedgekeurde scripts.
3. **Montage** (`render`)
   - FFmpeg, 60 fps.
   - Zoom- en shake-interrupts, freeze-frame bij een fail, loop-einde bij Shorts.
   - **Gele hook/header bovenin is heilig:** `brand/thumbnail_header.json`, met automatische kleurcontrole op thumbnails.
   - Luidheid −14 LUFS.
   - Mini-rapport met checks. Is er iets rood, dan volgt één automatische herkansing.
4. **Drie geluidsopties** (`config/kivoxel/presets.json` → `audio_modes`)

   | Sleutel | Naam | Inhoud |
   |---|---|---|
   | `muziek_geen_vo` | **standaard** | muziek die meebeweegt (druk bij actie, rustig bij zoeken/farmen, overvloeiers, maatslag op de piek), gamegeluid, **alleen de gele tekst bovenin**. Geen ondertiteling of verhaaltekst. Lange video: gele tekst vervaagt na 1 min |
   | `vo_muziek` | "Stem + ondertiteling" | stem, gamegeluid en ondertitels op de echte woordtijden (Whisper). Geen muziek |
   | `alleen_game` | "Alleen gamegeluid" | alleen gamegeluid; geen tekst of effecten (gele hook bij Shorts blijft) |

   Per video te wisselen in het keurscherm met "Opnieuw monteren met dit geluid". Het script blijft hetzelfde.
5. **Stem (bij `vo_muziek`)**
   - **Shorts:** de stem van Milans zoon. Google Chirp3 HD **Puck** spreekt de zin (Amerikaanse uitspraak), daarna zet Chatterbox lokaal de stemkleur om naar die van de zoon.
     - Referentie-opname: `FamilieMK-YouTube\kivoxel-tts\voice-ref\kind.wav`, nooit in Git.
     - Python-omgeving: `FamilieMK-YouTube\kivoxel-tts\chatterbox-venv`.
     - Zegt de kloon iets anders dan de tekst, dan wordt de zin opnieuw ingesproken.
   - **Lange video's:** Google Fenrir (de kloon is te traag: ongeveer 30 s per zin).
   - **Terugval:** Kokoro `am_puck`, Piper of Windows.
6. **Muziek**
   - 12 nummers van Pixabay (gratis, ook op YouTube met inkomsten, geen naamsvermelding).
   - Staan in `FamilieMK-YouTube\kivoxel-media\music\library.json`, met per nummer energie (1-5), sfeer en bpm.
7. **Keuren en publiceren**
   - **Keurscherm (Milans besluit):** geen Poortwachter, geen blokkades en geen rood/oranje lijsten. Goedkeuren kan zodra er een montage is.
   - **Database-Poortwachter:** verwijderd met migratie 057, door Milan uitgevoerd.
   - **AI-melding:** wordt automatisch aangezet bij een video met de gekloonde stem; YouTube eist dat.
   - **"🔁 Opnieuw door de nieuwe montage":** monteert klaarstaande en te keuren video's opnieuw. Ze komen daarna terug bij Te keuren.
   - **Live en ingepland:** 24 live en 5 "ingepland" staan al online. Die nooit aanraken (besluit Milan).

## 5. Dreamnest (kerst)
- **Seizoen:** `content/dreamnest/season.json` staat op `"kerst"`.
  - Kerstversie van Lumi's huiskamer: boom, sokken, lichtjes, sneeuw.
  - 9 AI-kerstbeelden en 5 bewegende kerstlussen.
  - Beelden in `FamilieMK-YouTube\dreamnest\keyframes\huiskamer-kerst`, lussen in `fase2\kerst`, gemaakt met `worker/dreamnest/kerst.ts`.
- **Montage:** `node worker/dreamnest/fase4.ts --minutes 60 [--preview-only] --kerst`. Uitvoer in `FamilieMK-YouTube\dreamnest\fase4\60min-kerst\`.
  - **Opbouw:** welkomstbeeld met vloeiende dolly en vallende sneeuw, verhaaldeel met alleen bewegende lussen, overgangen van 5-8 s, slaapdeel dat wisselt tussen lussen en stilstaande beelden met een levende laag.
  - **Stilstaande beelden** zoomen niet meer, want zoompan trilde.
- **Muziek:** alleen kerstliedjes uit het publieke domein: Stille Nacht, Jingle Bells (langzaam), Deck the Halls, We Wish You a Merry Christmas.
  - Instrumenten: celesta, felt-piano, harp, zachte kerstklokjes en haardvuur.
  - Geen speeldoos, geen regen.
  - Luidheid −20/−22/−24 LUFS.
- **KIVOXEL gaat voor:** Dreamnest wacht als de werker FFmpeg gebruikt.

## 6. Status op dit moment (16-11, 22:00)
- **Werker:** draait de nieuwste code (herstart om 20:36). Hij maakt een rij video's opnieuw, standaard met muziek.
- **Dreamnest Kerst-proef:** wordt gemaakt, met bewegende lussen. Het patroon dat de lussen niet vond, is opgelost.
  - Daarna: proef bekijken en naar Milan sturen.
  - Na zijn akkoord: de volledige 60 minuten renderen en via de Studio publiceren.
- **Supabase:** gebruikslimiet overschreden, Milan neemt Pro. Het project werkt nog. Tot dan zuinig zijn met open Studio-tabbladen.
- **Bekende valkuil:** bij het wegschrijven van code via shell-heredocs vallen backslashes weg (regex `\d`, `\.`, ASS-tags `\an8`). Gebruik voor zulke regels de Edit-tool.

## 7. Handige commando's
```bash
npx tsc --noEmit && npm test && npm run build                                  # controle
node scripts/kivoxel-testfull.ts shorts <opname> --max=2 --mode=muziek_geen_vo   # proef-Shorts (ook --kloon, long <opname> <van> <tot>)
node scripts/kivoxel-clonecompare.ts vc-google-puck                              # stemvergelijking
node worker/dreamnest/fase4.ts --minutes 60 --preview-only --kerst               # Dreamnest-proef
```
Werker-status: `http://127.0.0.1:3210/health`. Documentatie voor Milan: `docs/handleiding.md`, `docs/kivoxel-presets.md`.

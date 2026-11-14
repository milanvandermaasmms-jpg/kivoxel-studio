@AGENTS.md

# KIVOXEL Studio

Productiestudio voor het faceless Minecraft-kanaal Kivoxel (@Kivoxel, UC6zZPLDaBan9Jr8WpEhbdwA). Afgesplitst uit het familie-dashboard (`familie-m-en-k`), fase 1 van `docs/kivoxel-studio-app-plan.md`. Opdracht: `docs/masterprompt-kivoxel-superprompt.md`. Migratieplan: `docs/kivoxel-migratieplan.md`. Inrichten: `docs/inrichten.md`.
Hoe de Studio werkt voor Milan: `docs/handleiding.md` (1 pagina).

## Werkwijze
- Milan is geen programmeur: leg keuzes kort uit in gewoon Nederlands. Hij werkt op Windows.
- App-teksten en uitleg in het Nederlands; code, bestanden en variabelen in het Engels.
- Een fase is pas af na `npx tsc --noEmit`, `npm test`, `npm run build`, een controle in de browser en een testvideo voor Milan.

## Stack
Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Vitest, Supabase (eigen project, los van het familieproject), Vercel. Lokaal draait de app op **poort 3200**. De werker (`worker/`, Node) draait op Milans pc op poort 3210; er draait er altijd maar één.

## Harde regels
- **Stop en vraag Milan eerst** bij: een account of project aanmaken, alles wat geld kan kosten, migraties uitvoeren, pushen.
- Migraties gaan via Milans klembord (`Set-Clipboard`, lengte controleren); hij plakt ze in de SQL Editor en klikt Run.
- Geen sleutels of wachtwoorden in code, Git of de chat: alleen in `.env.local` / `worker/.env.local`. De service-sleutel niet gebruiken om iets na te kijken.
- Er wordt niets automatisch gepubliceerd: publiceren is altijd Milans klik.
- Maes (kind) nooit met gezicht, stem, naam of gamertag.
- Kosten: Gemini Flash-Lite binnen € 5 per maand; Google TTS alleen in het gratis deel. Geen Claude API en geen ElevenLabs zonder budget van Milan.
- Video's staan op de pc, niet in Supabase. Supabase bewaart alleen metadata, status, scripts en paden.
- De werker nooit herstarten of stoppen zonder te vragen, en niet terwijl FFmpeg of een analyse loopt.
- `regioacties-dashboard`, poort 3000 en poort 3100 (familie-dashboard) niet aanraken.

## Database
- `001_studio.sql`: één studio, leden met rol `eigenaar` of `beheerder`. `is_studio_admin(studio_id)` is de RLS-helper.
- `007`-`043`: de YouTube-tabellen (`yt_*`), gekopieerd uit het familieproject met `studio_id` in plaats van `household_id`.
- `044_review_tile.sql`: alleen het aantal video's in review voor de tegel in het familie-dashboard, met een token.
- `048_suggest_step.sql`: stap `suggest` in `yt_jobs` voor AI-suggesties (tags, titels, beschrijving); het antwoord staat in `yt_jobs.result`.
- `049_studio_learning.sql`: `studio_events` (wat Milan doet, alleen eigen gebeurtenissen toevoegen, na 180 dagen opgeruimd) en `studio_preferences` (voorkeuren per kanaal uit de Studio-tips, en wat hij met elke tip deed).
- `050_viral_check.sql`: stappen `viral` en `reference`, tabellen `yt_viral_checks` (scorekaart per montage, alleen de werker schrijft) en `yt_reference_videos` (wekelijkse referentievideo's per kanaal via de YouTube Data API).
- `054_ivar.sql`: Ivar — Studio Assistant (zie `docs/ivar.md`): stap `assistant` in `yt_jobs`, `ivar_conversations`/`ivar_messages` (alleen via `ivar_send`), `ivar_memory`, `ivar_ideas`, `ivar_revisions` (toepassen/terugdraaien via RPC), `ivar_actions` (logboek).
- Privacycontrole: `supabase/tests/rls-check.mjs` (draait in `npm test`, nooit tegen Supabase).

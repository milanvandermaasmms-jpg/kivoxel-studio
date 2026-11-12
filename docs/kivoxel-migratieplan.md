# KIVOXEL Studio afsplitsen: migratieplan (fase 1)

Opdracht: `docs/masterprompt-kivoxel-superprompt.md` §1, plan: `docs/kivoxel-studio-app-plan.md` fase 1. Milan zei "Go fase 1" op 13-11-2026.

Regel: **eerst kopiëren, dan testen, pas daarna opruimen.** Opruimen in het familie-dashboard gebeurt alleen na Milans akkoord.

## 1. Waar komt het te staan

| Onderdeel | Familie-dashboard (nu) | KIVOXEL Studio (nieuw) |
|---|---|---|
| Code | repo `familie-m-en-k` | repo `kivoxel-studio`, lokaal in `Documents\kivoxel-studio` |
| Database | Supabase-project Familie M&K | nieuw Supabase-project "kivoxel-studio" (Milans iCloud-account) |
| Online | familie-m-en-k.vercel.app | nieuw Vercel-project `kivoxel-studio` |
| Werker | `worker/` in het familieproject, poort 3210 | `worker/` in `kivoxel-studio`, zelfde poort 3210 (er draait er altijd maar één) |
| Lokaal | poort 3100 | poort **3200** |

## 2. Tabellen en data

**Verhuizen (16 migraties):** 007, 009 en 030 t/m 043, met alle `yt_*`-tabellen:
`yt_recordings`, `yt_videos`, `yt_jobs`, `yt_costs`, `yt_settings`, `yt_moments`, `yt_video_moments`, `yt_scripts`, `yt_renders`, `yt_channels`, `yt_job_events`, `yt_publications`, `yt_video_snapshots` en de bijbehorende functies (`claim_yt_job`, `retry_yt_job`, `reserve_yt_cost`, `request_yt_upload`, enz.).

**Losmaken van `households`:** in het nieuwe project bestaat geen gezin. Daarom:
- nieuwe migratie `001_studio.sql`: tabellen `studios` (één studio) en `studio_members` (wie erin mag; rol `eigenaar` of `beheerder`), met RLS;
- in de gekopieerde migraties wordt `household_id` overal `studio_id`, en `is_household_admin(...)` wordt `is_studio_admin(...)`. De regels zelf (wie mag wat) blijven precies gelijk;
- `create_studio()` werkt maar één keer: de eerste die inlogt en de studio aanmaakt is eigenaar. Daarna kan niemand zichzelf toevoegen. Nieuwe aanmeldingen zet Milan in Supabase uit;
- een kleine functie `kivoxel_review_count(token)` geeft alleen het **aantal** video's "klaar voor review" terug, voor de tegel in het familie-dashboard. Zonder het juiste token: niets.

**Data:** het nieuwe project begint leeg. De video's zelf staan op de pc, niet in Supabase, dus er gaat niets verloren. Opnames registreert de studio opnieuw vanaf de pc (vingerafdruk, dus nooit dubbel). Het kanaal Kivoxel koppel je in de nieuwe studio opnieuw aan YouTube (de tokens staan versleuteld op de pc). Oude scripts, renders en cijfers blijven in het familieproject staan tot het opruimen; overzetten kan later met een export, als Milan dat wil.

## 3. Code

**Verhuist (kopie):**
- `app/youtube` → wordt de startpagina `/` van de nieuwe app;
- `app/kivoxel` (openbare homepage en privacyverklaring voor Google OAuth);
- `components/youtube`, `lib/youtube`, `worker/`, met alle tests;
- hulponderdelen die de studio gebruikt: `lib/supabase.ts`, `lib/refreshingFetch.ts`, `lib/publicPages.ts`, `components/settings/Section.tsx`, `components/shell/StatusBadge.tsx`, `components/ui/Dialog.tsx`, `app/globals.css`, het thema;
- `supabase/tests`: alleen het YouTube-deel van de privacycontrole, omgezet naar de studio.

**Nieuw in de studio:** eigen inlogscherm en `lib/studio.tsx` (vervangt `lib/household.tsx`).

**Nieuw in het familie-dashboard:** tegel "KIVOXEL: X klaar voor review" met een link naar de nieuwe app (`/api/kivoxel-review` haalt het aantal op; alleen voor beheerders).

## 4. Opruimen (pas na akkoord van Milan, en pas als de nieuwe app aantoonbaar werkt)

1. In het familie-dashboard weghalen: `app/youtube`, `app/kivoxel`, `components/youtube`, `lib/youtube`, `worker/`, de YouTube-delen van `lib/nav.ts`, `lib/dashboard/widgets.ts`, `lib/publicPages.ts` en `supabase/tests/rls-check.mjs`.
2. In Google Cloud de OAuth-adressen (privacyverklaring, terugstuuradres) omzetten naar het nieuwe Vercel-adres.
3. Een opruimmigratie voor het familieproject die de `yt_*`-tabellen en -functies verwijdert. Eerst een export als back-up. Dit is onomkeerbaar, dus alleen na een expliciet "ja" van Milan.

## 5. Volgorde

1. Dit plan.
2. Milan maakt de GitHub-repo, het Supabase-project en het Vercel-project (stap voor stap begeleid).
3. Nieuwe app lokaal opzetten en testen (`tsc`, `npm test`, `build`).
4. Migraties per stuk via Milans klembord in het nieuwe project.
5. Werker in `kivoxel-studio` laten draaien met de sleutels van het nieuwe project (Milan zet ze zelf in `worker/.env.local`). De oude werker stopt pas als Milan dat zegt en er niets loopt.
6. Testclip door de nieuwe pijplijn.
7. Tegel in het familie-dashboard.
8. Testvideo aan Milan laten zien; daarna pas opruimen (met akkoord).

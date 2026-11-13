# Dreamnest fase 0: audit en vangnet (13-11-2026)

Branch `feature/dreamnest` (vanaf `main` b75aaee). Er is nog **niets** aan KIVOXEL veranderd: alleen dit rapport en een nieuwe rooktest.

## 1. Wat er nu staat

| Onderdeel | Waar | Wat het betekent voor Dreamnest |
|---|---|---|
| Kanalen | `yt_channels` (+ `045`: `slug`, `mode`, `safety_profile`, `providers`, `made_for_kids`, `synthetic_media`) | Dreamnest NL bestaat al als gepland kanaal (`generate`, `infant_sleep`). Hergebruiken, geen nieuwe kanalentabel. |
| Wachtrij | `yt_jobs` + `claim_yt_job(worker, steps[])` in `007`; `worker/queue.ts` | Elke "rij" vraagt alleen zijn eigen stappen op. Twee rijen nu: hoofdrij (intake, analyse, script, render, upload, publish) en snelle rij (suggest, viral, reference). Volgorde = oudste eerst, géén voorrang. Toegestane stappen staan vast in een `check` op de tabel. |
| Status per video | `lib/youtube/flow.ts` (`placeOf`) | Werkt op `yt_videos` + scripts + publicaties + jobs. Een Dreamnest-aflevering past hier pas in als ze ook een `yt_videos`-rij krijgt (zie §3). |
| Montage | `worker/ffmpeg.ts`, stap `render` | Gemaakt voor korte montages uit gameplay. Niet geschikt voor 60 min uit clips/loops; Dreamnest krijgt een eigen renderer. |
| Publiceren | `yt_publications` (`037`-`040`), `worker/youtubeUpload.ts` | Bruikbaar zoals het is: privé/ingepland, Made for Kids, AI-label, hervatbare upload. Alleen een afspeellijst ontbreekt. |
| Poortwachter, kosten | `046`, `yt_costs` + `reserve_yt_cost` | Kosten per stap bestaan al; een plafond per video nog niet. |
| Stijl | `channels/dreamnest-nl/style.md` | Bevat oudere afspraken die botsen met deze opdracht (zie §5). |

Werker: één Node-proces (versie 63.2) op poort 3210; FFmpeg draait als apart proces.

## 2. Check van de architectuur uit de opdracht (§2)

**Advies: wél een aparte Dreamnest-stroom, maar zónder de bestaande code te verhuizen.**

De opdracht noemt `pipelines/kivoxel/`, `pipelines/dreamnest/` en `core/`. Alle KIVOXEL-code nu verplaatsen (±12.000 regels in `lib/youtube/` en `worker/`) raakt elke import en is precies het risico dat we niet willen. Daarom:

- `lib/youtube/` en `worker/` blijven waar ze zijn en gelden als **KIVOXEL + gedeelde kern** (kanalen, publiceren, kosten, inloggen).
- Nieuw en volledig los: `lib/dreamnest/` (logica, getest), `worker/dreamnest/` (eigen rij en renderer), `components/dreamnest/`, `content/dreamnest/`, `docs/dreamnest/`, later `worker/providers/{image,video,music}/`.
- Gedeelde stukken worden pas losgetrokken als Dreamnest ze echt nodig heeft, één tegelijk, met melding vooraf.

## 3. Voorstel per harde eis

| Eis | Voorstel | Risico KIVOXEL |
|---|---|---|
| Feature flag | `FEATURE_DREAMNEST=true` in `.env.local` (app) en `worker/.env.local`. Uit = geen Dreamnest-menu, geen Dreamnest-rij in de werker. Eén nieuwe regel in de navigatie en één in `worker/index.ts`. | Zeer klein |
| Eigen wachtrij | **Eigen tabel `dn_render_jobs` met eigen claim-functie**, niet `yt_jobs`. Dan hoeft de check op `yt_jobs` niet te veranderen en ziet KIVOXEL Dreamnest-werk nooit. | Geen |
| Niet blokkeren, KIVOXEL voorrang | Derde rij in hetzelfde werkerproces (houdt de regel "er draait er maar één"). Die rij pakt alleen werk als de KIVOXEL-hoofdrij leeg is, rendert in stukken van ± 2 min (hervatbaar) en zet FFmpeg op lage prioriteit. Een KIVOXEL-montage wacht dus hooguit één stukje. | Klein: CPU wordt gedeeld. Alternatief: tweede werkerproces, maar dat breekt de huisregel. |
| Status | Aflevering krijgt een `yt_videos`-rij (kanaal Dreamnest) zodra er een eindversie is, zodat Te keuren / Klaar voor YouTube / Live gewoon werken. Daarvóór leeft ze in `dn_episodes`. | Klein: `flow.ts` niet aanpassen tenzij nodig, en dan melden. |
| Publiceren | Bestaande `yt_publications` + upload. Nieuw: afspeellijst (additief veld). | Klein, apart te melden |
| Migraties | Alleen nieuwe `dn_*`-tabellen met RLS via `is_studio_admin`; nummering vanaf `052`. | Geen |
| Rooktest | `worker/kivoxel-smoke.test.ts` (deze fase, draait in `npm test`). | n.v.t. |

Dreamnest-werkerskelet en flag bouw ik pas na je GO, omdat het de eerste aanraking van `worker/index.ts` is.

## 4. KIVOXEL-rooktest (nieuw)

`worker/kivoxel-smoke.test.ts`, zonder Supabase, YouTube of FFmpeg:
1. **Rijen**: de hoofdrij vraagt precies `intake, analyse, script, render, upload, publish`, de snelle rij `suggest, viral, reference`; nooit een `dn_`-stap.
2. **Upload**: een testopname gaat door de intake en zet de analyse klaar.
3. **Bewerking en preview**: een video gaat van productie (montage) naar Te keuren naar Klaar voor YouTube.
4. **Publiceren (proef)**: een testvideo gaat privé omhoog; inplannen of openbaar maken wordt geweigerd.

Uitkomst van de basismeting staat in §7.

## 5. Botsingen met eerdere afspraken (jouw besluit nodig)

1. **Beeld.** `docs/studio-multikanaal-plan.md` en de stijlgids zeggen: "audio eerst, beeld minimaal, na ± 5 min donker scherm" en render uit tot je een dienst en budget kiest. Deze opdracht wil 60 min levende wereld. Vervangt deze opdracht die afspraak? (Een donker-scherm-variant kan als extra export blijven.)
2. **Naam.** Afspraak: altijd "Lumi van Dreamnest", nooit "Lumi" los (er bestaat al een groot kanaal met die naam). De afspeellijst "Lumi's Lullabies" botst daarmee. Voorstel: "Dreamnest Lullabies met Lumi" of jouw keus.
3. **Taal.** Het kanaal in de database heet "Dreamnest NL" (Nederlands). Deze opdracht: Engels, Nederlands als optie. Wordt het één Engels kanaal, of blijft NL de eerste?
4. **Kosten.** 60 min levende beelden kan niet binnen het huidige plafond (Gemini ≤ € 5/maand, verder gratis). Fase 1 begint met onderzoek en een kostenschatting per video; daarna kies jij dienst en budget.
5. **Je pc.** Lokaal renderen (en misschien lokale beeldmodellen) hangt af van je videokaart. Welke heb je (bijv. NVIDIA RTX 3060)? Dan kan ik goedkope lokale opties meenemen.

## 6. Wat Fase 0 nog doet na je GO
- `FEATURE_DREAMNEST` in app en werker (uit = exact zoals nu).
- Skelet `worker/dreamnest/` (rij met voorrangsregel, stappen die nog niets doen) + tests.
- Migratie `052_dreamnest_core.sql` (`dn_episodes`, `dn_render_jobs` met claim-functie), via je klembord.
- Rooktest + `tsc` + `build` opnieuw; werker pas herstarten na jouw akkoord.

## 7. Basismeting (main + rooktest)
13-11-2026 op `feature/dreamnest`: `npx tsc --noEmit` ✅ · `npm test` ✅ 51 bestanden, 352 tests (incl. 4 rooktests) · `npm run build` ✅. Geen browsercontrole nodig: er is niets aan de app veranderd. Kosten tot nu toe: € 0.

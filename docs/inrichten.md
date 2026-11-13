# KIVOXEL Studio inrichten (fase 1): stappen voor Milan

Ongeveer 30 minuten. Jij maakt de accounts en projecten aan; Claude maakt niets aan en ziet geen sleutels.
Sleutels plak je alleen in `.env.local`-bestanden of in Vercel, nooit in de chat.

## Stap 1: GitHub-repository (2 minuten)

1. Ga naar https://github.com/new (ingelogd als `milanvandermaasmms-jpg`).
2. Repository name: `kivoxel-studio`. Kies **Private**.
3. Vink **niets** aan (geen README, geen .gitignore, geen licentie): de code staat al klaar op je pc.
4. Klik **Create repository**. Zeg tegen Claude: "repo staat". Claude vraagt dan of hij mag pushen.

## Stap 2: Supabase-project (5 minuten)

1. Ga naar https://supabase.com/dashboard en log in met je **iCloud-account** (hetzelfde als het familieproject).
2. **New project**. Naam: `kivoxel-studio`. Regio: dezelfde als het familieproject (West-Europa). Plan: **Free**.
3. Database-wachtwoord: laat Supabase er een maken en bewaar het in je wachtwoordmanager. Claude heeft het niet nodig.
4. Wacht tot het project klaar is (1-2 minuten).
5. **Authentication → Sign In / Providers**: zet **Allow new users to sign up** **uit**. Zo kan niemand anders een account maken.
6. **Authentication → Users → Add user → Create new user**: je eigen e-mailadres en een nieuw wachtwoord, vink **Auto Confirm User** aan.
7. **Authentication → URL Configuration**: Site URL `http://localhost:3200` (na stap 5 verander je dit in het Vercel-adres).

## Stap 3: De database inrichten (10 minuten, met Claude)

Claude zet de migraties één voor één op je klembord, in deze volgorde:
`001_studio`, `007`, `009`, `030` t/m `043`, `044_review_tile` (18 stuks).
Per stuk: in Supabase **SQL Editor → New query**, plakken (Ctrl+V), **Run**. Je moet "Success. No rows returned" zien. Zeg "klaar" en je krijgt de volgende.

## Stap 4: De sleutels op je pc (5 minuten)

Supabase → **Project Settings → API Keys**. Daar staan:
- **Project URL** (begint met `https://` en eindigt op `.supabase.co`),
- **publishable key** (begint met `sb_publishable_`): mag in de app,
- **secret key** (begint met `sb_secret_`): **alleen** voor de werker.

a. De app: maak `C:\Users\famdj\Documents\kivoxel-studio\.env.local` (Kladblok, "Alle bestanden") met:
```
NEXT_PUBLIC_SUPABASE_URL=<Project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

b. De werker: Claude kopieert je bestaande `worker\.env.local` (Gemini, stem, YouTube, tokensleutel) naar de nieuwe map, zonder hem te openen. Daarna verander jij in `C:\Users\famdj\Documents\kivoxel-studio\worker\.env.local` alleen:
```
SUPABASE_URL=<Project URL van KIVOXEL Studio>
SUPABASE_SERVICE_ROLE_KEY=<secret key van KIVOXEL Studio>
WORKER_ALLOWED_ORIGINS=http://localhost:3200,https://kivoxel-studio.vercel.app
```

c. Het token voor de tegel in het familie-dashboard: Claude maakt een willekeurig token en schrijft het rechtstreeks in beide `.env.local`-bestanden (familie-dashboard en studio), zonder het in de chat te zetten. Op je klembord komt alleen de vingerafdruk (SHA-256) om in de SQL Editor te plakken. Die is niet geheim.

## Stap 5: Vercel (5 minuten, na de push uit stap 1)

1. https://vercel.com/new → **Import** `kivoxel-studio` uit GitHub.
2. Framework: Next.js (vanzelf). **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key
   (de secret key **niet**: die hoort alleen bij de werker op je pc)
3. **Deploy**. Het adres wordt waarschijnlijk `https://kivoxel-studio.vercel.app`. Is het anders? Zeg het tegen Claude.
4. Terug in Supabase → **Authentication → URL Configuration**: Site URL = het Vercel-adres; bij Redirect URLs ook `http://localhost:3200`.
5. In het Vercel-project van het **familie-dashboard** → Settings → Environment Variables: voeg `KIVOXEL_SUPABASE_URL`, `KIVOXEL_SUPABASE_PUBLISHABLE_KEY` en `KIVOXEL_TILE_TOKEN` toe (het token kopieer je uit `familie-m-en-k\.env.local`).

## Stap 6: Werker overzetten (alleen als er niets loopt)

1. Kijk in de oude studio of er geen analyse of montage bezig is.
2. Stop de oude werker (Ctrl+C in zijn venster). Claude doet dit nooit zelf.
3. Start de nieuwe: dubbelklik `C:\Users\famdj\Documents\kivoxel-studio\worker\start-werker.cmd`. Hij meldt "Werker 59.0" en "Wachtrij: Supabase".
4. De opnames staan nog in dezelfde map (`FamilieMK-YouTube`). In **Gameplaybibliotheek** staat bij elke opname die de nieuwe database nog niet kent een knop **Aanmelden**: één klik en hij staat erin (zonder dubbelen).
5. Koppel het kanaal Kivoxel in de nieuwe studio opnieuw aan YouTube (Instellingen → kanaal).

Terug naar de oude werker kan altijd: nieuwe stoppen, oude starten.

## Stap 7: Testen

1. Open http://localhost:3200 (Claude start de app), log in, maak de studio aan ("Studio aanmaken").
2. Upload een korte testclip en laat hem door intake, analyse, script en montage lopen.
3. Bekijk de testvideo. Pas daarna praten we over opruimen in het familie-dashboard en over fase 2.

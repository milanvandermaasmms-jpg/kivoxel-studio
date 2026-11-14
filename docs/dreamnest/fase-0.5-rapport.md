# Dreamnest fase 0.5: Dreamnest in de Studio (14-11-2026)

Alles staat achter `FEATURE_DREAMNEST`. Zonder die vlag is de Studio precies zoals vroeger; dat heb ik in de browser gecontroleerd.

## Wat er is
- **Eén adres per kanaal:** `/studio/kivoxel` en `/studio/dreamnest`.
  - Het oude adres `/` stuurt door, en het tabblad blijft behouden (`/#ingepland` → `/studio/kivoxel#ingepland`).
  - `/dreamnest` stuurt ook door.
- **Kanaalwisselaar bovenaan:** KIVOXEL | Dreamnest NL | + Kanaal.
  - De kanalen komen uit de database.
  - Onder Instellingen > Kanalen staat nu "+ Kanaal toevoegen". Zo'n kanaal start als gepland, zonder YouTube.
- **Eigen thema:** Dreamnest is nachtblauw en lavendel met goud, KIVOXEL blijft turquoise. Het zijn dezelfde onderdelen.
- **Dreamnest-bord:**
  - links de afleveringen met "+ Nieuwe aflevering" (titel en lengte 60/90/120/180/600 min);
  - rechts de 5 stappen: Concept → Keyframes → Animatie → Muziek → Montage en controle.
  - Per stap:
    - **Goedkeuren en starten.** Betaalde stappen tonen het maximum op de knop: Keyframes max € 2,50, Animatie max € 25. Wat al gemaakt is, komt gratis uit de opslag.
    - **Opnieuw.**
    - **Aanpassen:** een andere variant (muziek, montage) of één clip opnieuw (animatie).
    - **Annuleren**, zolang de stap nog in de wachtrij staat.
  - Wat een stap maakte, zie je in de Studio: keyframes, clips, de muziek, de preview van 3 min en het QC-resultaat.
  - Wat een betaalde stap echt kostte, wordt bij de aflevering opgeteld.
- **Werker:** de stappen draaien de geteste scripts van fase 1-4 in de eigen Dreamnest-wachtrij, op lage prioriteit. KIVOXEL gaat voor. De werker toont de beelden alleen aan de Studio en alleen uit de Dreamnest-map.
- **YouTube per kanaal:**
  - Elk kanaal heeft een eigen koppeling en een eigen tokenbestand. KIVOXEL houdt `youtube-tokens.enc`, dus je hoeft niet opnieuw te koppelen.
  - Vóór elke upload controleert de werker of de koppeling op de pc bij het YouTube-kanaal van die video hoort. Zo niet, dan wordt er niets geüpload.
  - Bovenaan Dreamnest staat "Uploaden naar: [beeld] kanaal".

## Gewijzigde gedeelde code (vooraf gemeld, terugwaarts verenigbaar)
- `app/page.tsx` → `components/studio/StudioApp.tsx` (verplaatst). `/` toont zonder vlag hetzelfde.
- `StudioTopBar` (wisselaar), `ChannelCard` (+ Kanaal, alleen met vlag), `YouTubeConnection` (status per kanaal, kanaalnaam in de tekst).
- Werker:
  - `server.ts`: adres `/dreamnest/...`, en status per kanaal;
  - `youtubeLink.ts`: koppeling per kanaal, alleen met vlag;
  - `queue.ts`: kanaalcontrole vóór upload, alleen met vlag;
  - `index.ts`.
- `next.config.ts`: doorsturen van `/`, alleen met vlag.

## Controle
- tsc ✅, 438 tests ✅, build ✅, KIVOXEL-rooktest ✅. Nieuw in de rooktest: een upload gaat nooit naar het verkeerde kanaal.
- Browser:
  - met vlag: wisselaar, Dreamnest-bord, thema en doorsturen met tabblad werken;
  - zonder vlag: de oude Studio, en `/studio/dreamnest` geeft 404.
- De stap Muziek is echt gedraaid via de nieuwe werkercode (54 s, gratis).

## Kosten
Fase 0.5: € 0. Totaal Dreamnest: € 24,92 van € 35.

## Om het te gebruiken
1. Zet `FEATURE_DREAMNEST=true` in `.env.local` (Studio) en in `worker\.env.local` (werker).
2. De werker moet de code van deze branch draaien. Dat vraagt één herstart; die doe ik alleen als jij akkoord geeft.

## Nog open
- De stappen maken nu aflevering 1 (de huiskamer-set). Een nieuwe aflevering met een eigen verhaal en eigen set volgt in Fase 6 (autopilot en series).
- 2.5D-parallax en procedurele lagen; verpakking en publiceren (Fase 5).

# Studio-audit (15-11-2026, op basis van eigen inspectie)

## Architectuur (bevestigd)
- **Studio-app**: Next.js 16 op Vercel (`kivoxel-studio.vercel.app`) en lokaal op poort 3200. Alleen orkestratie en weergave; geen lange taken in de browser of op Vercel.
- **Database**: Supabase (eigen project), RLS met `is_studio_admin`. Migraties 001-055.
- **Werker** (`worker/`, Node, op Milans pc, poort 3210): één proces met banen:
  - hoofdbaan: `intake`, `analyse`, `script`, `render`, `upload`, `publish` (FFmpeg, Gemini, Google TTS);
  - snelle baan: `suggest`, `viral`, `reference`;
  - Ivar-baan: `assistant`, `insight`;
  - Dreamnest-baan: eigen tabel `dn_render_jobs`, stappen roepen scripts `worker/dreamnest/fase1..5.ts` aan als apart proces.
- **Wachtrij**: `yt_jobs` met `claim_yt_job` (skip locked), idempotentiesleutels, `cancel_requested`, heartbeat, live fase/voortgang (033). Mislukte stap → `afterFinalFailure`; vastgelopen (2 uur geen heartbeat) → `failStuck`.
- **AI**: Gemini Flash-Lite (`gemini-3.5-flash-lite`) voor momenten (video-analyse via verkleinde proxy), scripts, titels, viral-luisterbeurt, Ivar. Kosten via `reserve_yt_cost` binnen maandplafond (€ 5).
- **Stem**: Google TTS Chirp3-HD (Charon, nu Fenrir), alleen gratis deel (900.000 tekens/maand).
- **Montage**: FFmpeg 9.0.2 op de pc; plan in `yt_scripts.edit_plan` (segmenten), ondertitels ASS/SRT uit de scriptregels, QC (`lib/youtube/qc.ts`), thumbnails.
- **YouTube**: OAuth op de pc (tokens versleuteld), upload privé, publiceren = Milans klik; statistieken (Data API + Analytics), referentievideo's per kanaal (wekelijks).
- **Pc**: Intel i5-12450H (8 kernen/12 threads), 16 GB RAM, Intel UHD (geen losse GPU; Quick Sync mogelijk, nog niet gebruikt), 91 GB vrij.

## Hoe een KIVOXEL-video nu ontstaat (bevestigd in code)
1. Opname → intake (probe, vingerafdruk).
2. `analyse`: gratis signalen (stilte, zwart, luid) + Gemini kijkt naar een verkleinde proxy (lage resolutie, `MEDIA_RESOLUTION_LOW`) en noemt **momenten** (soort, begin/eind, reden, score, context/afloop, privacyvlaggen).
3. `planVideos`: Shorts uit de sterkste momenten; lange video uit 7 momenten of in delen (≥ 15 min).
4. `script`: Gemini schrijft verteltekst **op basis van de momentbeschrijvingen** (tekst), niet op basis van het beeld zelf. → hier ontstaan verzonnen details (harten, donker, vallen).
5. `render`: FFmpeg knipt volgens het plan, TTS per regel, ondertitels, QC.
6. Viral-check: regels + Gemini luistert naar de voice-over (niet naar het beeld).

## Grootste oorzaken van de kwaliteitsklachten (zie PRODUCTION_FAILURES.md)
- Het script ziet het beeld niet: feiten komen uit korte momentbeschrijvingen van een lage-resolutie analyse.
- Scriptlengte wordt begrensd en er is geen controle op spreektijd: lange video's 14-29% spraak.
- Viral-score en QC controleren techniek en tekst, niet of de tekst klopt met het beeld.
- Geen bewaking op FFmpeg-stilstand in Dreamnest (12 uur hang).

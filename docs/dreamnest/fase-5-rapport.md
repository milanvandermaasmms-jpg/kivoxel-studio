# Dreamnest fase 5: verpakking en publiceren (14-11-2026)

## Wat er is
- **Stap 6 "Verpakking"** in het Dreamnest-bord (script `worker/dreamnest/fase5.ts`):
  - **Titel, beschrijving en tags in het Engels.** De beschrijving is eerlijk over de muziek (publiek domein en eigen liedjes) en over AI-beeld.
  - **Hoofdstukken** komen automatisch uit de tijdlijn. Voor aflevering 1 zijn dat er 20, van 0:00 Welcome tot 58:00 Gentle fade into quiet.
  - **3 thumbnails:**
    - een AI-achtergrond zonder tekst, in de stijl van je gekozen thumbnail (Lumi groot links);
    - de titel zetten we er zelf op als eigen laag: strak, foutloos en goud op een nachtwolk;
    - 3 varianten: open haard, sneeuwraam en sterrenhemel.
  - **3 Shorts** van 25-30 s (1080×1920): rustige stukjes uit de verhaallussen, zonder knip erin, met een zachte vage achtergrond, tekst boven en onder, en zachte fades.
- **Publiceren** in de Studio: een kaart voor de lange video en één per Short.
  - Groot bovenaan: **"Uploaden naar: [avatar] DreamNest | Baby Sleep Music & Lullabies"**, met het kanaal-ID en het quotum van vandaag.
  - Per kaart: thumbnail kiezen, titel, beschrijving en tags bewerken, en inplannen (standaard morgen 19:00, Shorts een dag later).
  - **Made for Kids en het AI-label** staan vast aan. De database weigert ze uit te zetten.
  - Vóór de upload vraagt de werker **bij YouTube zelf** op welk kanaal de koppeling schrijft. Klopt dat niet, dan gaat er niets uit.
  - De lange video gaat **nooit zonder QC ✅**.
  - Er wordt nooit twee keer geüpload. Een onderbroken upload gaat verder waar hij stopte.
  - Daarna zet de werker de thumbnail en voegt hij de video toe aan de afspeellijst "DreamNest | Magical Sleep Worlds". Die maakt hij aan als hij nog niet bestaat.
- **Migratie 053:** de tabel `dn_publications` en de stap `dn_publish`. Hij is toevoegend en gecontroleerd met 13 nieuwe privacycontroles.

## Gedeelde code (vooraf gemeld)
- `youtubeUpload.ts`: nieuwe functie `addToPlaylist`. Bestaande functies zijn ongewijzigd.
- `youtube.ts`: de quotumteller kent de afspeellijst-acties.
- `youtubeLink.ts`: `youtubeFor(kanaal)` geeft de koppeling van dat kanaal.

## Controle
- tsc ✅, 458 tests ✅, build ✅, KIVOXEL-rooktest ✅.
- Verpakking van aflevering 1 echt gemaakt:
  - de 3 thumbnails heb ik bekeken;
  - Shorts: 1080×1920, 30 s, -21 LUFS.

## Kosten
- Fase 5: € 0,33 (3 thumbnail-achtergronden).
- Totaal Dreamnest: € 25,25 van € 35.

## Om te testen
1. Voer migratie 053 uit (SQL Editor).
2. Herstart de werker vanuit de Dreamnest-map. Ik mag dat niet zelf.
3. Maak in de Studio een aflevering aan en doorloop de 6 stappen.
   - Alles van aflevering 1 komt uit de opslag, dus het kost niets extra.
   - Bij Montage worden alleen ontbrekende stukken opnieuw gemaakt.
4. Vul bij Publiceren de lange video in en klik op "Uploaden en inplannen". Hij komt dan privé en ingepland op het DreamNest-kanaal.

## Nog open
- Eindschermen en kaarten kunnen bij Made for Kids niet (regel van YouTube).
- Fase 6: autopilot en series ("Verras me", serie-modus, asset-bibliotheek).

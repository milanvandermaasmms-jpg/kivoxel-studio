# Dreamnest fase 1: onderzoek naar diensten (13-11-2026)

Uitgangspunt: geen losse videokaart op de pc ([besluiten.md](besluiten.md)), dus alle beeld- en videogeneratie gaat via online diensten met een API. Prijzen zijn **indicatief** in USD (≈ euro). Ze komen vooral uit vergelijkingsblogs van september tot november 2026, en die spreken elkaar soms tegen. Vóór de eerste betaalde aanroep controleer ik ze nog een keer op de officiële prijspagina.

## 1. Beeld met vaste personages (keyframes, Lumi-bible)

| Dienst | Kwaliteit / stijl | Consistentie (referentiebeelden) | API | Prijs per beeld | Licentie / YouTube-risico |
|---|---|---|---|---|---|
| **Gemini 3.1 Flash Image** ("Nano Banana 2") | Goed, warme 3D-look haalbaar | Meerdere referenties per verzoek | Ja, **zelfde Google-account en sleutel als nu** | ± $0,067 (1K), Flash-Lite-variant ± $0,034 | Uitvoer met SynthID-watermerk; laag risico |
| Gemini 3 Pro Image | Hoogste kwaliteit bij Google | Tot 14 referenties | Ja | Duurder (± $0,13-0,24) | Idem |
| FLUX.2 pro / Kontext (Black Forest Labs, via fal/Replicate) | Zeer goed | Tot 8 referenties; Kontext is gebouwd voor consistentie | Ja, nieuw account | $0,014-0,03 | Commercieel toegestaan bij betaalde API |
| Seedream 5 (ByteDance) | Goed, scoorde hoog in een consistentietest | Referentiebeelden | Ja, via doorverkopers | ± $0,055 | Via derde partij |
| OpenAI GPT Image | Goed | Volgens eigen documentatie zwak bij steeds hetzelfde personage | Ja, met organisatieverificatie | $0,006-0,21 | Laag |

**Advies:** Gemini 3.1 Flash Image. Je hebt al een Google-account en sleutel, er is geen nieuw account nodig, de kwaliteit is goed genoeg voor een zachte 3D-stijl, en dezelfde Gemini kan als "keurmeester" de consistentie scoren. FLUX.2 Kontext is het reserveplan als Lumi niet stabiel genoeg blijft.

## 2. Beeld naar video (verhaalclips en naadloze loops)

Belangrijk voor loops: als je **hetzelfde beeld als begin- én eindframe** geeft, krijg je een clip die naadloos herhaalt.

| Dienst | Begin + eindframe | Clipduur | Prijs per seconde | Opmerking |
|---|---|---|---|---|
| **Veo 3.1 Lite** (Google) | Ja, exact | ≤ 8 s | $0,05 (720p), $0,08 (1080p); mislukte clips worden niet berekend | Zelfde account als Gemini |
| Veo 3.1 Fast | Ja | ≤ 8 s | $0,10-0,12 | Betere kwaliteit |
| Hailuo 3 (MiniMax) | Begin-/sleutelframes | ± 6-10 s | ± $0,05-0,10 | Goedkoop, via Runway of doorverkoper |
| Seedance 1.5 Pro / 2.0 | Ja | 5-10 s | $0,01-0,07 (480p), tot $0,37 (1080p) | Prijzen lopen sterk uiteen per bron |
| Kling 4 | Ja | 5-10 s | ± $0,08-0,13 (720p) | Sterk in beweging |
| Runway Gen-4.5 | Ja | 5-10 s | $0,12 | Goed gedocumenteerde API |
| Luma Ray 3.2 | Ja | 5-10 s | ± $0,06 | |

**Advies:** Veo 3.1 Lite in 1080p, via hetzelfde Google-account: precieze begin- en eindframes (nodig voor de loops), lage prijs, en geen nieuw account. Hailuo of Seedance blijft reserve voor goedkopere loops.

## 3. Muziek (detail volgt in fase 3)

| Bron | Licentie | Content ID-risico | Kosten |
|---|---|---|---|
| **Eigen generator** (slaapliedjes uit het publiek domein, opnieuw gearrangeerd; MIDI → zachte instrumenten) | Van ons | Geen | € 0 |
| Lyria (Google) via de API | Volgens Google commercieel bruikbaar, met SynthID | Laag, voorwaarden nog vast te leggen | ± $0,04-0,08 per clip/nummer |
| Mubert / Soundraw / Sonilo | Commerciële licentie (volgens eigen blogs) | Wisselt per dienst | Abonnement |
| Suno | Betaald plan nodig | **Hoger**: sommige plannen sturen uitvoer naar Content ID | Abonnement |

Let op: een commerciële licentie is iets anders dan veilig zijn voor Content ID. Per nummer leggen we de bron, de voorwaarden en het risico vast.

## 4. Diepte-maps, opschalen, tussenbeelden

- **Diepte-maps** (voor 2.5D-parallax): Depth Anything V2 draait ook op de processor (traag maar gratis, en we hebben er maar enkele per set nodig). Online is het ± $0,05 per beeld of minder.
- **Opschalen naar 4K / tussenbeelden:** Topaz via fal kost ± $0,60 per 10 s naar 1080p en ± $1,30 per 10 s naar 4K; tussenbeelden zitten daar als optie in. **Niet nodig voor 1080p**, want Veo levert dat zelf. 4K blijft een optie.

## 5. Kosten per video van 60 minuten

Aannames voor de eerste aflevering: ± 80 beelden (bible, keyframes, varianten, herkansingen), ± 450 s AI-video (12 verhaalclips en ± 10 loops, met herkansingen voor naden). De rest van het uur bestaat uit herhalende loops, procedurele lagen en montage op de pc (gratis). Vanaf aflevering 2 hergebruiken we personages, sets en loops: ongeveer de helft goedkoper.

| Variant | Beeld | Video | Muziek | **Eerste aflevering** | Volgende |
|---|---|---|---|---|---|
| Goedkoop | Gemini Flash-Lite Image ± $3 | Hailuo/Seedance 768p ± $15-20 | Eigen generator $0 | **± $20-25** | ± $10 |
| **Gebalanceerd (advies)** | Gemini 3.1 Flash Image ± $6 | Veo 3.1 Lite 1080p ± $36 | Eigen + Lyria ± $2 | **± $45** | ± $20-25 |
| Premium | Gemini 3 Pro Image ± $15 | Kling 4 / Runway ± $75 + 4K-opschaling ± $40 | Lyria ± $3 | **± $130** | ± $60 |

**Fase 1 zelf kost alleen beelden:** Lumi-bible, 2 vriendjes, de Huiskamer en 10 keyframes zijn ± 60-100 beelden, dus **± $4-7**. Video komt pas in fase 2.

Belangrijk: het huidige plafond van € 5 per maand geldt voor de KIVOXEL-analyse. Dreamnest krijgt een **eigen budget per aflevering** (migratie 052), zodat het nooit van het KIVOXEL-budget af gaat. Elke aanroep wordt gelogd en gecachet.

## 6. YouTube-risico's

- **"Generic or repetitive content"** (verduidelijkt in juli 2026): kanalen met massaal gemaakte, bijna gelijke video's kunnen hun inkomsten verliezen. Daarom krijgt elke aflevering een eigen verhaal, set, seizoen en muziek, plus de "Verras me"-variatie en een menselijke keuring. Geen sjabloon-kopieën.
- **Made for Kids:** geen gepersonaliseerde advertenties en geen reacties. Dat is een vast gegeven voor dit publiek.
- **AI-label** (synthetic media) staat altijd aan; het kanaalprofiel heeft dit al.

## 7. Jouw keuze

1. Beeld: **Gemini 3.1 Flash Image** (advies) of FLUX.2?
2. Video (pas nodig in fase 2): **Veo 3.1 Lite** (advies), goedkoper Hailuo/Seedance, of premium Kling/Runway?
3. Budget voor fase 1: advies **€ 10 plafond** (verwacht ± € 5).
4. Het canonieke ontwerp van Lumi: je voorkeur is de thumbnail-versie. Waar staat dat beeld op je pc?

## Bronnen
- [Recraft: Best AI Image Generation API 2026](https://www.recraft.ai/blog/best-ai-image-generation-api)
- [Atlas Cloud: cheapest image API with consistent results](https://www.atlascloud.ai/blog/guides/cheapest-image-api-realistic-faces-consistent-results)
- [Tech Insider: consistent AI character test 2026](https://tech-insider.org/consistent-ai-character-generator-test-2026/)
- [Runway API pricing (officieel)](https://docs.dev.runwayml.com/guides/pricing/)
- [OpenRouter: image-to-video models compared](https://openrouter.ai/blog/insights/image-to-video-models-compared/)
- [Teamday: AI video models ranked by price per second](https://www.teamday.ai/blog/best-ai-video-models-2026)
- [Morphed: AI video cost per second](https://morphed.app/blog/ai-video-generation-cost)
- [BenchLM: Veo 3.1 API pricing](https://benchlm.ai/media-pricing/veo)
- [Puter: Gemini API pricing Oct 2026](https://developer.puter.com/tutorials/gemini-api-pricing/)
- [LiteLLM: Vertex AI model pricing](https://models.litellm.ai/providers/vertex_ai)
- [Sonilo: AI soundtrack APIs for monetized channels](https://sonilo.com/blog/comparisons/ai-soundtrack-apis-ads-client-monetized-video)
- [Rao Music: monetizing AI music on YouTube](https://www.raomusic.com/blog/can-you-monetize-ai-music-on-youtube)
- [fal.ai: video upscalers](https://fal.ai/learn/tools/video-to-video-upscalers)
- [fal.ai: Depth Anything v2](https://fal.ai/models/fal-ai/image-preprocessors/depth-anything/v2/llms.txt)
- [Tubefilter: YouTube inauthentic content update (juli 2026)](https://www.tubefilter.com/2026/07/13/youtube-inauthentic-content-monetization-policy-update/)
- [TechCrunch: YouTube clarifies AI slop policies](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/)

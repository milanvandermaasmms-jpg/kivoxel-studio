# Dreamnest fase 1: beeld (13-11-2026)

## Gebouwd
- **Character bible** in `content/dreamnest/`:
  - `characters/lumi.json`: thumbnail-Lumi met slaapmuts en Twinkle, palet in hex, verhoudingen, 6 uitdrukkingen, wat ze nooit doet, en een vaste prompt-DNA.
  - `characters/pip.json` en `characters/mo.json`.
  - `sets/huiskamer.json`: lagen, licht, bewegingen en geluiden.
- **Referenties** (jouw keuze): Lumi rondom v2 + gezichtjes v1 + de thumbnail; Pip v1; Mo v1; Huiskamer v1.
- **Beeldstekker** `worker/providers/image/gemini.ts` (Gemini 3.1 Flash Image) met keurmeester (Gemini 3.1 Flash-Lite): scoort 0-100, onder 80 maximaal 3 pogingen, daarna beslis jij.
- **Kostenteller, cache en plafond** (`worker/dreamnest/ledger.ts`): elke aanroep wordt gelogd in `<data>/dreamnest/costs.json`. Hetzelfde verzoek wordt nooit twee keer betaald, en een stap boven het plafond wordt vooraf geweigerd.
- **Script** `node worker/dreamnest/fase1.ts a|b [--dry]` met een overzichtspagina.

## Resultaat
- Stap A: 10 ontwerpen. Stap B: 10 keyframes × 2 varianten, allemaal door de consistentiecheck (score 85-100).
- Overzicht op de pc: `C:\Users\famdj\FamilieMK-YouTube\dreamnest\fase1\stage-b\index.html`
- Bekende zwakte: de keurmeester meldt soms ten onrechte "muts ontbreekt". De scores zijn wel bruikbaar; ik keek zelf mee.

## Voorstel per keyframe (jouw keuze telt)
| Keyframe | Advies | Waarom |
|---|---|---|
| b01 welkom buiten | v2 | Rustiger, Lumi duidelijk in het raam |
| b02 schommelstoel | v1 | Knuffelt Twinkle, haard in beeld |
| b03 Pip komt binnen | v1 | Bij v2 ligt Twinkle op de grond (mag niet) |
| b04 thee | v1 | Beide aan tafel, stoom zichtbaar |
| b05 Mo bij het vuur | v2 | Dichterbij, warmer |
| b06 raam met Momo | v1 | Weerspiegeling van het vuur, zoals gevraagd |
| b07 gaap | v2 | Bij v1 hangen de oren opzij |
| b08 samen onder de deken | v2 | Alle drie goed zichtbaar |
| b09 Lumi valt in slaap | v2 | Donkerder en warmer |
| b10 basis slaaplus | v2 | Iedereen slaapt, weinig contrast |

## Controle
- `tsc` ✅, `npm test` ✅, `build` ✅. KIVOXEL-rooktest ✅. Geen nieuw scherm in de app, dus geen browsercontrole nodig.
- **Kosten tot nu toe: € 4,20 van € 10** (stap A € 1,46, stap B € 2,74).

## Open voor fase 2 (beweging)
- Veo staat nog niet in de modellenlijst van je Gemini-sleutel. Mogelijk is Veo een aparte instelling of betaallaag in Google AI Studio. Dat zoek ik uit vóór fase 2 en daarbij vraag ik eerst je akkoord.
- Budget voor fase 2 (clips en loops): verwacht ± € 25-40.

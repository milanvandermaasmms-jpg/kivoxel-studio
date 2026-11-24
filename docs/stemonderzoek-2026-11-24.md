# Stemonderzoek (24-11-2026)

Vraag uit de superprompt: is er een betere stemaanbieder dan wat de studio nu gebruikt, en wat kost die?

## Wat de studio nu gebruikt

| Volgorde | Stem | Waar | Kosten |
|---|---|---|---|
| 1 | Chatterbox (stemkloon) | lokaal op de pc | gratis |
| 2 | Google Chirp 3 HD | cloud | gratis tot 1 miljoen tekens per maand |
| 3 | Piper, Kokoro of Windows-stem | lokaal | gratis |

Gebruik deze maand (november): **189.399 tekens** Google, dat is 19% van het gratis deel.

## Wat er te koop of gratis te krijgen is

| Aanbieder | Kwaliteit (Engels, verteller) | Prijs | Past bij de studio? |
|---|---|---|---|
| Chatterbox (Resemble AI, MIT) | bij de top van de open modellen; luisteraars verkozen hem in een test van de maker boven ElevenLabs | gratis, lokaal | **al in gebruik** |
| Kokoro-82M (Apache 2.0) | heldere, rustige verteller; draait zelfs zonder videokaart | gratis, lokaal | **al ingebouwd** als terugval |
| Google Chirp 3 HD | natuurlijk, snel | 1 mln tekens/maand gratis, daarna ongeveer $30 per miljoen | **al in gebruik**, ruim binnen het gratis deel |
| ElevenLabs Creator | zeer goed, veel stemmen | ongeveer $22 per maand voor ongeveer 100.000-121.000 tekens | niet nodig; kost geld en vraagt budget van Milan |
| XTTS v2 (Coqui) | goede klonen | gratis, maar licentie **niet commercieel** | **niet gebruiken** (YouTube met inkomsten) |

## Conclusie

- Er is nu **geen reden om te betalen** voor een andere stem. De drie stemmen die de studio heeft, horen bij de beste gratis opties van dit moment.
- Wat de stem het meest verbetert, is **wat er gezegd wordt**, niet de aanbieder. Daarom is op 24-11-2026 de controle per zin gebouwd: 7 punten per zin, en de 55 sjablonen met geschreeuw in hoofdletters zijn rustiger gemaakt.
- De werker stopt met Google bij 900.000 tekens per maand (marge onder het gratis deel, `worker/tts.ts`) en valt dan terug op de lokale stem. Zo betaal je nooit ongemerkt.

## Bronnen

- [Kokoro vs XTTS vs Chatterbox (localaimaster)](https://localaimaster.com/blog/kokoro-vs-xtts-vs-chatterbox)
- [Best open source TTS 2026 (findskill)](https://findskill.ai/blog/best-open-source-tts-2026/)
- [Google Text-to-Speech pricing](https://cloud.google.com/text-to-speech/pricing)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs pricing 2026 (eesel)](https://eesel.ai/blog/elevenlabs-pricing)

De prijzen komen deels van blogs; controleer ze op de officiële pagina voordat je iets koopt.

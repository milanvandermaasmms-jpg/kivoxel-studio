# Eisen voor de lange versie (fase 4), uit Milans feedback op de testvideo van fase 2 (14-11-2026)

Milan: "het beeld trilt aan het einde en sommige overgangen vloeien nog niet lekker."

## 1. Trillen
- **Oorzaak (gemeten):** de AI-clips hebben kleine schokjes in vuur, vacht en licht. In de slaaplus zitten ze tussen seconde 2 en 4 (beeldstap tot 95% gelijk, normaal 99,9%). Doordat de lus steeds herhaalt, zie je ze ritmisch terug. Het ligt niet aan de camera: stabiliseren hielp niet.
- **Oplossing:**
  - een zacht tijdfilter op alle clips (`tmix=frames=3:weights=1 2 1`). Gemeten: de 10% grootste schokjes gaan van 97,9% naar 99,5% gelijk;
  - lussen niet steeds dezelfde 7 s achter elkaar herhalen. Afwisselen tussen lussen en varianten, en elke 4-8 min een zachte variant (megaprompt §4);
  - in het lange slaapdeel de lus iets vertragen (0,8×, met zachte beeldmenging), zodat alles rustiger beweegt.
- **QC-regel erbij:** "rust": na het filter moet de 10% grootste beeldstappen ≥ 99% gelijk zijn. Daaronder volgt ❌ met de tijd erbij.

## 2. Overgangen
- **Oorzaak:** verhaalclips tussen twee verschillende beelden krijgen van Omni halverwege een eigen overvloeier of knip. Daarnaast zijn mijn overgangen van 1 s te kort voor het tempo van een slaapliedje.
- **Oplossing:**
  - van elke AI-clip alleen het rustige stuk "op de plek" gebruiken, vóór Omni zelf gaat wisselen. De Studio vindt dat punt automatisch: waar het beeld minder dan 85% op het eerste beeld gaat lijken;
  - de overgangen zelf maken: **3 s zachte overvloeier**, in het lange deel 4-5 s;
  - helderheid en kleur van beide kanten van een overgang vooraf gelijktrekken, zodat er geen "plop" in licht komt;
  - alle clips eerst naar dezelfde tijdbasis (24 fps).
- **QC-regel erbij:** geen helderheidssprong over een overgang groter dan 3/255 per seconde.

## 3. Controle
Na de lange render meet de QC per minuut: rust, flitsen, knippen, helderheid en naden. Milan krijgt een lijst met tijdstempels, zodat hij precies kan nakijken waar iets niet goed is.

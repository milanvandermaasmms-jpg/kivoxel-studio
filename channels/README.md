# Kanaalprofielen

Elk kanaal is een rij in `yt_channels` (naam, taal, werkwijze, veiligheidsprofiel, verboden woorden, AI-label,
publicatietijden) plus een map `channels/<slug>/` met de stijlgids en later de prompts en personages.
Een nieuw kanaal = in de studio een profiel invullen en deze map kopiëren vanuit `_sjabloon/`. Geen code.

| Map | Kanaal | Werkwijze | Veiligheidsprofiel |
|---|---|---|---|
| `kivoxel/` | KIVOXEL | upload (gameplay van de pc) | kids_gaming |
| `dreamnest-nl/` | Dreamnest NL (Lumi van Dreamnest) | genereren | infant_sleep |

Diensten (`providers`) wijzigt alleen de server: standaard Gemini en de Google-stem, geen betaalde muziek of video
zonder akkoord en budget van Milan.

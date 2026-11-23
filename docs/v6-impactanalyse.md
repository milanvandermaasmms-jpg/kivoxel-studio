# Impactanalyse superprompt V6 (23-11-2026)

V6 vraagt: Ivar als studiomanager (fase 28–29, 35), een viralscore van minimaal 8,0 (fase 30), drie beluisterbare audio-opties bij elke keuring (fase 31–32), een nieuwe keurpagina (fase 33) en een strakkere studio (fase 34). Hieronder per onderdeel wat er al werkt, wat ontbreekt en wat eerlijk haalbaar is. Niets is hier verzonnen; "bestaat" betekent: in de code én eerder in gebruik gezien.

## 1. Ivar (fase 28, 29, 35)

**Bestaat al**
- Knop op elke studiopagina (`Iv`, Alt+I), gesprek met scope kanaal → project → onderdeel (`docs/ivar.md`).
- Tools met rechten en logboek (`ivar_actions`): lezen (kwaliteitsrapport, analytics, taken), concepten (titels, scriptversie, geheugen), taken (analyse met kostenkaart, montage, viral check, annuleren, opnieuw). Er is geen tool die publiceert of verwijdert. Dat sluit al aan op de niveaus 1–3.
- Wekelijkse inzichten per kanaal (trends, lessen, tips met bewijs) en een geheugen (`ivar_memory`).
- Zelfherstel zonder Ivar, in de werker: vastgelopen montages komen elke 5 minuten terug (`reviveMontages`), en de uploadwachtrij wordt elke 2 minuten leeggemaakt.

**Ontbreekt**
- **Incidentmonitor:** detecteren (stilstaande voortgang, oude heartbeat, mislukte stap), oorzaak vastleggen, een veilige herstelactie (niveau 1), controleren dat het weer loopt, en een korte melding bij Ivar en in de studio. Nu herstelt de werker stil, zonder melding.
- **Context:** Ivar weet nu het kanaal en project, maar niet welke video op dit moment in het keurscherm openstaat.
- **Leergeheugen per kanaal:** afkeurredenen worden al lessen voor het script (`lessons.ts`), maar audiokeuzes en goedkeuringen worden nog niet bewaard. De weg Meten → Voorstel → Goedkeuren is er voor tips, niet voor productieregels.

## 2. Viralscore 8,0 (fase 30)

**Bestaat al:** viral check per montage (`yt_viral_checks`: stem, script, gameplay/montage), eindredacteur (blinde metingen plus intentie), producer-poort (GROEN LICHT / PROEFOPNAME / AFGEKEURD), contentregister (vijf gemeten scores).

**Eerlijk:** van de 8 onderdelen in de matrix kan de pc er 4 meten: hook en eerste seconden (beweging, gameplay-aandeel, hoogtepunt vóór 8 s), montage en pacing (dode stukken, stiltes), einde/payoff (uitkomst in beeld) en audio (vervorming, balans, stem gelijk met beeld). Fragmentselectie, verhaal en spanning, originaliteit en muziekgeschiktheid zijn een oordeel. Dat oordeel kan alleen van Gemini komen (geschat 1–3 cent per keuring) of van jou. Het contentregister liet vandaag zien dat de metingen "geen content" níét zien.

**Voorstel:** één score van 0–10 per onderdeel, met per onderdeel de bron erbij ("gemeten", "AI-oordeel" of "jouw oordeel"). Een harde blokkade bij technische fouten, briefing niet gevolgd of beeld dat niet bij het script past. Onder 8,0 komt er "niet publicatiegereed" met de zwakste onderdelen. Daarna één gerichte verbeterpoging, met een limiet en een kostenplafond. De score wordt nooit opgehoogd. Jouw goedkeurknop blijft werken (besluit 16-11); de studio markeert alleen.

## 3. Drie audio-opties (fase 31–32)

**Bestaat al:** drie audio-modi (stem + muziek, muziek zonder stem, alleen gamegeluid), muziek die meewisselt met actie en rust (`planMusicParts`), SFX op hoogtepunten, de stemverdeling 1 op 3 en 1 op 5, de Uppbeat-import met licentie en vermelding, en de muziekkeuze uit de briefing.

**Ontbreekt:** drie echte previews (A Aanbevolen, B Energiek, C Naturel) van dezelfde video, aparte keuzes voor stem, muziek en effecten (3×3×3), een nieuwe preview van een eigen combinatie, en het bewaren van de keuze als voorkeur per kanaal en game.

**Kosten en tijd:** alles draait op de pc (gratis). Een Short zonder gekloonde stem kost ± 1–3 minuten per preview, met de gekloonde stem (Chatterbox, CPU) ± 5–15 minuten. Drie previews per Short is dus ± 3× de montagetijd. Slim: alleen de audio opnieuw mixen boven hetzelfde beeld, zonder het beeld opnieuw te renderen. Bij lange video's een fragment van 60 s.

**Muziekscore (fase 32.2):** de bibliotheek kent sfeer en energie per track. Een score "past bij dit moment" kan uit sfeer tegenover het event, energie tegenover de actie, en botsingen met de stem. Dat is een inschatting en staat zo gelabeld. "Bewezen viraal" kan pas met eigen A/B-cijfers.

## 4. Keurpagina en studio (fase 33–34)

**Bestaat al:** keurscherm met speler, eindredacteur, briefingcontrole, producer, stemverdeling, feedback op tijdcode, Goedkeuren / Afkeuren / Afkeuren en opnieuw monteren, en een vergelijking met de vorige versie.

**Ontbreekt:** de indeling uit fase 33 (speler links, kwaliteitspaneel rechts, audiopreviews en keuzes eronder), een vaste plek voor de viralscore met de reden van een blokkade, een Health Monitor, en het opruimen van dubbele panelen in de navigatie.

## Voorgestelde volgorde

1. **Viralscore 8,0 (gemeten deel), Health Monitor en incidentmelding:** gratis, en de basis voor de rest.
2. **Drie audio-opties met previews** (audio-remix boven hetzelfde beeld) en aparte keuzes voor stem, muziek en effecten. Je keuze wordt bewaard.
3. **Nieuwe keurpagina** volgens fase 33. Ivar weet dan welke video openstaat.
4. **AI-oordeel** voor fragmentselectie, verhaal en originaliteit: pas na jouw akkoord over de kosten (1–3 cent per keuring).
5. **Leergeheugen per kanaal:** goedkeuringen, audiokeuzes en YouTube-resultaten, via de verbetercyclus met jouw akkoord.

Per stap: tests, build, browsercontrole, een echte productie als test en een kort verslag.

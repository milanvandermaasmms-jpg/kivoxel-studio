# Ivar — Studio Assistant

Ivar is de AI-assistent van de studio. Rechtsonder op elke studiopagina staat zijn knop (`Iv`, of **Alt+I**).
Je kunt met hem sparren over video's, hem opdrachten geven, de voortgang volgen en het resultaat meteen gebruiken.

## Hoe het werkt (kort)

- **Eén wachtrij.** Een antwoord van Ivar is een gewone stap `assistant` in `yt_jobs`. De werker op de pc pakt die op in
  een eigen baan, naast de montage: een antwoord wacht nooit achter een render. Werkt de werker niet, dan blijft het bericht
  staan en antwoordt Ivar zodra de werker weer draait (ook vanaf je telefoon).
- **Model:** Gemini Flash-Lite met dezelfde sleutel als de analyse (`GEMINI_API_KEY` in `worker/.env.local`).
  Elk antwoord reserveert eerst ± 1 cent via `reserve_yt_cost` (het maandplafond in Instellingen). Staat betaalde
  verwerking uit of is het plafond bereikt, dan zegt Ivar dat eerlijk en verzint hij niets.
- **Stoppen** (vierkantje) stopt alleen het antwoord, nooit een render of analyse. **Opnieuw** zet dezelfde stap terug:
  geen tweede kostenreservering.
- **Scope** staat bovenin: *kanaal → project → onderdeel*. Klik erop om te wisselen. Een gesprek houdt zijn eigen scope;
  kijk je ergens anders, dan stelt Ivar een nieuw gesprek voor in plaats van stilletjes te wisselen.
- **Minimaliseren** (streepje of Esc) sluit alleen het paneel. Taken lopen door; de knop laat rustig zien of er iets
  bezig is (paars), klaar is (groen) of aandacht nodig heeft (oranje).

## Tools en rechten

Alle tools draaien op de werker (server-side). Elke tool: controleert dat de afzender beheerder van de studio is, filtert
alles op de studio en het kanaal van het gesprek, valideert de invoer, geeft een gestructureerd resultaat met een
begrijpelijke fout, en schrijft één regel in `ivar_actions` (logboek). Geen SQL, geen shell, geen netwerkverzoeken.

| Tool | Soort | Wat |
| --- | --- | --- |
| `list_channels`, `list_projects`, `get_project` | lezen | kanalen, opnames/video's/afleveringen, alles over één project |
| `get_channel_guidelines` | lezen | doelgroep, taal, verboden woorden, stem, geheugen |
| `get_transcript` | lezen | voice-overtekst met tijdcodes (geen transcriptie van de gameplay zelf) |
| `get_quality_report` | lezen | meetwaarden van de montage, viral-check met bron, montageplan |
| `get_analytics` | lezen | echte YouTube-cijfers, met waarschuwing bij te weinig data |
| `list_tasks` | lezen | lopende en recente stappen (KIVOXEL en Dreamnest) |
| `save_idea` | concept | videoconcept opslaan (kaart met "Maak project") |
| `propose_titles` | concept | 3 titels met toelichting; pas na jouw klik toegepast |
| `update_metadata_draft` | concept | titel/beschrijving/tags als concept, altijd terug te draaien |
| `save_voiceover_text`, `propose_edit` | concept | nieuwe **scriptversie** (vorige versie en opname blijven) |
| `show_analysis` | concept | analysekaart met bron, hele video of deel, audio ja/nee, onzekerheden |
| `save_memory` | concept | alleen bij "onthoud/voortaan"; anders een vraag aan jou |
| `start_analysis` | taak | betaald: eerst een kostenkaart, jij klikt |
| `start_render` | taak | gratis montage, nooit dubbel |
| `start_quality_check` | taak | viral-check; met kostenkaart als er een betaald luisterdeel bij zit |
| `shorts_from_recording` | taak | toont de geplande Shorts; analyseert eerst (met kostenkaart) als nodig |
| `cancel_task`, `retry_task` | taak | annuleren; opnieuw = dezelfde stap (geen dubbele kosten, geen upload) |
| `prepare_publish` | lezen | controleert kanaal, bestand, zichtbaarheid en tijdstip; **publiceren blijft jouw klik** |

**Taken** (alles wat iets start of annuleert) draaien alleen bij een concrete opdracht ("start de montage"). Bij sparren
of een vraag ("waarom voelt dit statisch?") start Ivar niets. Er is geen tool die publiceert, verwijdert of bronmateriaal
overschrijft.

Conceptwijzigingen gaan via `ivar_revisions`: de knoppen *Als concept toepassen* en *Terugdraaien* roepen
`ivar_apply_revision` / `ivar_revert_revision` aan. Die weigeren als het concept intussen door iemand anders is
gewijzigd, of als de video al op YouTube staat.

## Zelfstandig leren en trends (migratie 055)

- Ivar draait in de werker op de pc, los van Claude: zolang de werker aan staat, beantwoordt hij berichten (ook vanaf je telefoon) en doet hij zijn weekronde.
- **Elke week per actief kanaal** zet de werker zelf een stap `insight` klaar (alleen met betaalde verwerking aan, ± 2 cent per kanaal). Ivar bekijkt:
  - **trends**: de best scorende recente YouTube-video's in de niche (wekelijkse referentievideo's via de YouTube Data API; Dreamnest gebruikt nu eigen slaapzoektermen);
  - **onze cijfers**: beste en zwakste eigen video's per dag online;
  - **jouw keuzes**: toegepaste en teruggedraaide titels, gemaakte en laten vallen ideeën, afkeur-notities.
- Hij schrijft hooguit 6 inzichten (trend, geleerd, tip), elk met bewijs en zekerheid, zonder beloftes. Te weinig data: gratis overgeslagen.
- In Ivar onder het lampje: **Onthouden** maakt van een les een vaste voorkeur; **Maak er een idee van** laat Ivar een concept uitwerken; **Niet nuttig** wijst af (ook dat leert hij: hij herhaalt het niet). Een groen bolletje op de knop = nieuwe inzichten, geen pop-up.
- In gesprekken gebruikt Ivar de inzichten van de laatste weken als advies (en zegt dat erbij).
- Extra tools: `get_studio_overview` ("wat moet ik vandaag doen?"), `get_costs`, `get_schedule`, `list_ideas`, `get_insights`, `refresh_insights` (kostenkaart), `regenerate_script` (kostenkaart), `approve_script` (alleen op verzoek).

## Database (migratie 054)

- `ivar_conversations`, `ivar_messages`: gesprekken per studio, kanaal en project. Berichten alleen via `ivar_send`
  (bericht + stap + antwoordplek in één keer; dezelfde `client_key` = hetzelfde bericht).
- `ivar_memory`: voorkeuren per studio/kanaal/project; zichtbaar, bewerkbaar en wisbaar onder *Geheugen*.
- `ivar_ideas`, `ivar_revisions`, `ivar_actions`: ideeën, conceptwijzigingen met terugdraaien, logboek.
- `yt_jobs.step` krijgt `assistant`. Alles alleen voor beheerders (RLS). Controles: `supabase/tests/rls-check.mjs`.

## Code

- `lib/ivar/`: types, schema's, intentie (sparren of opdracht), prompt, taken, edits, suggesties (puur, getest).
- `worker/ivar/`: `model.ts` (Gemini met functieaanroepen), `tools.ts` (de tools), `lane.ts` (de baan).
- `components/ivar/`: `Ivar.tsx` (knop, paneel, gesprekken, geheugen, scope), `IvarCards.tsx` (resultaatkaarten).
- Pagina's geven hun context door met `usePublishPageContext` (`StudioApp`, `DreamnestStudio`).

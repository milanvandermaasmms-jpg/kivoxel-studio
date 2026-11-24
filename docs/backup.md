# Back-up van de database

## Wat er gebeurt

- **Wanneer:** één keer per week. De werker kijkt elke 6 uur of het weer tijd is, en 5 minuten na het starten.
- **Wat:** alle tabellen van de studio. Per tabel komt er één bestand `<tabel>.json.gz`, plus een `manifest.json` met het aantal rijen en eventuele fouten.
- **Waar:** `FamilieMK-YouTube/backups/<datum>/` op de pc. Een andere map kan met `KIVOXEL_BACKUP_DIR` in `worker/.env.local`. Niet op schijf D:: die viel op 24-11 bij het kopiëren drie keer weg, en Windows vraagt om een volledige reparatie.
- **Bewaren:** de laatste 8 weken. Oudere back-ups wist de werker zelf.
- **Sleutels:** geen nieuwe. De werker gebruikt zijn eigen sleutel, die alleen in `worker/.env.local` staat en nooit in Git. In de back-upbestanden staan geen sleutels.
- **Wat er niet in zit:** de opbouw van de database (tabellen, regels, functies). Die staat al in `supabase/migrations` in Git. Video's staan op de pc en zitten dus ook niet in de back-up.

## Terugzetten (alleen met Milan)

1. Maak een nieuw Supabase-project, of gebruik het bestaande als dat leeg is.
2. Voer de migraties `001` tot en met de laatste uit, in volgorde, via de SQL Editor.
3. Zet de rijen terug, tabel voor tabel, in de volgorde van `BACKUP_TABLES` in `worker/backup.ts`. Ouders gaan vóór kinderen. Dat doet Claude Code met een eenmalig script, nadat Milan dat goedkeurt.
4. Controleer het aantal rijen tegen `manifest.json`.

Terugzetten overschrijft gegevens. Doe het daarom nooit zonder Milans akkoord.

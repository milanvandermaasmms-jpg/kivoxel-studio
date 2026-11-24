-- KIVOXEL Studio: Dreamnest-afleveringen van 8 uur (480 minuten), een hele nacht (superprompt: LUMI 8 uur).
-- Alleen de toegestane lengtes van dn_episodes veranderen: 480 komt erbij. Niets wordt gewist of omgezet;
-- bestaande afleveringen houden hun lengte. Terugzetten: dezelfde check zonder 480 (als er geen 8-uursaflevering is).

begin;

alter table public.dn_episodes drop constraint if exists dn_episodes_duration_min_check;
alter table public.dn_episodes add constraint dn_episodes_duration_min_check check (duration_min in (60, 90, 120, 180, 480, 600));

commit;

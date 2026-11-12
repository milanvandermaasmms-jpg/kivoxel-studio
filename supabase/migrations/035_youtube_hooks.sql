-- Familie M&K: YouTube Studio, hookvarianten (Kivoxel Studio 2.2, fase C2). Nummer 035: YouTube-lijn.
--
-- * yt_scripts.hooks: de hookvarianten van de AI (type, eerste zin, tekst bovenin, cold open); hoogstens 3.
-- * yt_scripts.loop_line: de slotzin die aansluit op het begin, zodat kijkers opnieuw kijken.
-- * yt_scripts.chosen_hook: welke variant Milan kiest (0, 1 of 2). Beheerders mogen alleen deze keuze (en de status)
--   wijzigen; de tekst van de AI blijft zoals hij is.
-- * Alleen kolommen erbij; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   alter table public.yt_scripts drop column chosen_hook, drop column loop_line, drop column hooks;

begin;

alter table public.yt_scripts
  add column hooks jsonb not null default '[]'::jsonb check (jsonb_typeof(hooks) = 'array' and jsonb_array_length(hooks) <= 3),
  add column loop_line text check (length(loop_line) <= 200),
  add column chosen_hook smallint check (chosen_hook between 0 and 2);
alter table public.yt_scripts add constraint yt_scripts_chosen_hook_exists check (chosen_hook is null or chosen_hook < jsonb_array_length(hooks));

grant update (chosen_hook) on public.yt_scripts to authenticated;

commit;

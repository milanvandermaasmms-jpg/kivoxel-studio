-- KIVOXEL Studio: zelflerende Studio (superprompt opschonen, fase 2).
--
-- * studio_events: wat Milan in de Studio doet (welke AI-suggestie hij overneemt of weghaalt, welke tags hij zelf
--   toevoegt, welke privacykeuze hij maakt, welk scherm hij opent en hoe lang). Alleen eigen gebeurtenissen
--   toevoegen; nooit wijzigen. Na 180 dagen ruimt prune_studio_events ze op.
--   Er staan geen video's, scripts of persoonsgegevens in: alleen de actie, het scherm en kleine metadata.
-- * studio_preferences: voorkeuren per kanaal die uit de Studio-tips komen (standaardtags, standaard inplantijd,
--   verborgen onderdelen) en wat Milan met elke tip deed (toegepast, genegeerd, nooit meer tonen).
--   channel_id leeg = voor alle kanalen.
-- * De werker leest studio_events (met de service-sleutel) om AI-suggesties te laten leren van wat Milan eerder
--   overnam of weghaalde.
-- * Terugdraaien: drop table public.studio_preferences; drop table public.studio_events; drop function public.prune_studio_events(integer);

begin;

create table public.studio_events (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel_id uuid references public.yt_channels (id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  screen text not null default '' check (length(screen) <= 40),
  at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 2000)
);
create index studio_events_studio_idx on public.studio_events (studio_id, at desc);
create index studio_events_action_idx on public.studio_events (studio_id, action, at desc);
alter table public.studio_events enable row level security;

create policy "Beheerders zien gebeurtenissen" on public.studio_events for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders leggen eigen gebeurtenissen vast" on public.studio_events for insert to authenticated
  with check (public.is_studio_admin(studio_id) and user_id = auth.uid() and at > now() - interval '5 minutes' and at < now() + interval '5 minutes');
revoke all on public.studio_events from anon, authenticated;
grant select on public.studio_events to authenticated;
grant insert (studio_id, channel_id, action, screen, metadata) on public.studio_events to authenticated;
grant select, insert, delete on public.studio_events to service_role;

create table public.studio_preferences (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid references public.yt_channels (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_:.-]{1,80}$'),
  value jsonb not null check (length(value::text) <= 4000),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- One value per key per channel; the "all channels" row (channel_id null) is unique too.
create unique index studio_preferences_key_idx on public.studio_preferences (studio_id, coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
alter table public.studio_preferences enable row level security;
create trigger studio_preferences_updated_at before update on public.studio_preferences for each row execute function public.set_updated_at();

create policy "Beheerders zien voorkeuren" on public.studio_preferences for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders zetten voorkeuren" on public.studio_preferences for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen voorkeuren" on public.studio_preferences for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders wissen voorkeuren" on public.studio_preferences for delete to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.studio_preferences from anon, authenticated;
grant select, delete on public.studio_preferences to authenticated;
grant insert (studio_id, channel_id, key, value) on public.studio_preferences to authenticated;
grant update (value) on public.studio_preferences to authenticated;
grant select on public.studio_preferences to service_role;

-- Old events are not needed to learn: the worker calls this now and then.
create function public.prune_studio_events(p_days integer default 180) returns integer
language sql security definer set search_path = ''
as $$
  with gone as (delete from public.studio_events where at < now() - make_interval(days => greatest(p_days, 30)) returning 1)
  select count(*)::int from gone;
$$;
revoke execute on function public.prune_studio_events(integer) from public, anon, authenticated;
grant execute on function public.prune_studio_events(integer) to service_role;

commit;

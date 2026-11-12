-- KIVOXEL Studio: de studio, wie erin mag, en Row Level Security (RLS).
--
-- Vervangt in dit eigen Supabase-project de gezinstabellen van Familie M&K. De YouTube-migraties
-- (007, 009, 030-043) zijn daaruit gekopieerd met studio_id in plaats van household_id; de regels zijn gelijk gebleven.
--
-- Uitgangspunten:
-- * Alles zit achter inloggen; de rol "anon" krijgt nergens toegang toe (behalve het aantal voor de tegel, zie 044).
-- * Er is precies één studio. De eerste die create_studio aanroept wordt eigenaar; daarna kan dat niemand meer.
-- * Niemand kan zichzelf toevoegen. Een extra beheerder voegt de eigenaar toe in de SQL Editor.
-- * Security-definer-functies zetten search_path leeg en noemen elk schema voluit.

begin;

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Precies één studio in dit project.
create unique index studios_single_idx on public.studios ((true));

create table public.studio_members (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  role text not null default 'beheerder' check (role in ('eigenaar', 'beheerder')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
create index studio_members_studio_idx on public.studio_members (studio_id);
-- Precies één eigenaar.
create unique index studio_members_one_owner_idx on public.studio_members (studio_id) where role = 'eigenaar';

-- ---------- Helpers voor RLS ----------

create function public.is_studio_member(p_studio uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.studio_members m
    where m.studio_id = p_studio and m.user_id = (select auth.uid())
  );
$$;

-- Eigenaar en beheerders mogen alles in de studio. Dezelfde naam-vorm als vroeger (is_household_admin),
-- zodat de gekopieerde YouTube-regels ongewijzigd gelden.
create function public.is_studio_admin(p_studio uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.studio_members m
    where m.studio_id = p_studio and m.user_id = (select auth.uid()) and m.role in ('eigenaar', 'beheerder')
  );
$$;

create function public.is_studio_owner(p_studio uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.studio_members m
    where m.studio_id = p_studio and m.user_id = (select auth.uid()) and m.role = 'eigenaar'
  );
$$;

create function public.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger studios_updated_at before update on public.studios
  for each row execute function public.set_updated_at();
create trigger studio_members_updated_at before update on public.studio_members
  for each row execute function public.set_updated_at();

-- ---------- De studio aanmaken (één keer) ----------

create function public.create_studio(p_name text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd';
  end if;
  if exists (select 1 from public.studios) then
    raise exception 'Er bestaat al een studio';
  end if;
  insert into public.studios (name, created_by) values (trim(p_name), v_uid) returning id into v_id;
  insert into public.studio_members (studio_id, user_id, display_name, role) values (v_id, v_uid, trim(p_display_name), 'eigenaar');
  return v_id;
end;
$$;

-- ---------- RLS ----------

alter table public.studios enable row level security;
alter table public.studio_members enable row level security;

create policy "Leden zien hun studio" on public.studios for select to authenticated using (public.is_studio_member(id));
create policy "Eigenaar wijzigt de naam" on public.studios for update to authenticated
  using (public.is_studio_owner(id)) with check (public.is_studio_owner(id));

create policy "Leden zien de leden" on public.studio_members for select to authenticated using (public.is_studio_member(studio_id));
create policy "Leden wijzigen hun eigen naam" on public.studio_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.studios, public.studio_members from anon, authenticated;
grant select on public.studios, public.studio_members to authenticated;
grant update (name) on public.studios to authenticated;
grant update (display_name) on public.studio_members to authenticated;
grant select, insert, update, delete on public.studios, public.studio_members to service_role;

revoke execute on function public.is_studio_member(uuid) from public, anon;
revoke execute on function public.is_studio_admin(uuid) from public, anon;
revoke execute on function public.is_studio_owner(uuid) from public, anon;
grant execute on function public.is_studio_owner(uuid) to authenticated;
grant execute on function public.is_studio_member(uuid) to authenticated;
grant execute on function public.is_studio_admin(uuid) to authenticated;
revoke execute on function public.create_studio(text, text) from public, anon;
grant execute on function public.create_studio(text, text) to authenticated;

commit;

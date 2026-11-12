-- Familie M&K: YouTube Studio, publicaties (Kivoxel Studio 2.2, fase D2). Nummer 037: YouTube-lijn.
--
-- * yt_publications: per goedgekeurde video één publicatie, met de metadata voor YouTube (titel, beschrijving, tags,
--   categorie, taal), de keuzes voor doelgroep en AI-melding (altijd expliciet door Milan, nooit een standaard),
--   de zichtbaarheid en het moment van inplannen, welke montage geüpload wordt, en later de stand van de upload.
-- * De limieten van YouTube (documentatie van 12-11-2026): titel hoogstens 100 tekens, beschrijving hoogstens
--   5000 bytes, geen < of >, tags samen hoogstens 500 tekens. Inplannen kan alleen privé.
-- * Beheerders bewaren een concept, alleen zolang er nog niets naar YouTube is gegaan (status concept of mislukt).
--   De stand van de upload (status, YouTube-video-ID, fout) schrijft alleen de werker (service-rol, fase D3).
--   Kinderen en andere leden zien niets.
-- * Kanaal en testvlag komen vanzelf van de video; een publicatie wisselt nooit van video of kanaal.
-- * Alleen een nieuwe tabel; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   drop table public.yt_publications; drop function public.yt_publication_defaults();

begin;

create table public.yt_publications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  video_id uuid not null,
  render_id uuid,
  title text not null default '' check (length(title) <= 100 and title !~ '[<>]'),
  description text not null default '' check (octet_length(description) <= 5000 and description !~ '[<>]'),
  tags text[] not null default '{}' check (cardinality(tags) <= 100 and length(array_to_string(tags, ',')) <= 500 and array_to_string(tags, ',') !~ '[<>]'),
  category_id text not null default '20' check (category_id ~ '^[0-9]{1,3}$'),
  language text not null default 'en' check (language in ('en', 'nl')),
  made_for_kids boolean,
  contains_synthetic_media boolean,
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  publish_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'queued', 'uploading', 'processing', 'uploaded', 'scheduled', 'published', 'failed')),
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  error text check (length(error) <= 500),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id),
  unique (video_id),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade,
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id),
  -- De trigger hieronder controleert dat de montage bij dezelfde video (en dus hetzelfde gezin) hoort.
  foreign key (render_id) references public.yt_renders (id) on delete set null,
  -- Inplannen kan alleen privé (YouTube zet hem zelf openbaar).
  constraint yt_publications_schedule_private check (publish_at is null or visibility = 'private')
);
create unique index yt_publications_youtube_idx on public.yt_publications (youtube_video_id) where youtube_video_id is not null;
create index yt_publications_studio_idx on public.yt_publications (studio_id, updated_at desc);
create trigger yt_publications_updated_at before update on public.yt_publications for each row execute function public.set_updated_at();

-- Kanaal en testvlag van de video; alleen voor een goedgekeurde video; de montage moet bij dezelfde video horen.
create function public.yt_publication_defaults() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v public.yt_videos%rowtype;
begin
  if tg_op = 'UPDATE' and (new.video_id is distinct from old.video_id or new.channel_id is distinct from old.channel_id or new.studio_id is distinct from old.studio_id) then
    raise exception 'Een publicatie wisselt niet van video of kanaal';
  end if;
  select * into v from public.yt_videos where id = new.video_id and studio_id = new.studio_id;
  if not found then
    raise exception 'Onbekende video';
  end if;
  if tg_op = 'INSERT' then
    if v.status not in ('approved', 'scheduled', 'published') then
      raise exception 'Keur de video eerst goed in de controle';
    end if;
    new.channel_id := v.channel_id;
    new.is_test := v.is_test;
  end if;
  if new.render_id is not null and not exists (select 1 from public.yt_renders r where r.id = new.render_id and r.video_id = new.video_id) then
    raise exception 'Deze montage hoort niet bij deze video';
  end if;
  return new;
end;
$$;
revoke execute on function public.yt_publication_defaults() from public, anon, authenticated;
create trigger yt_publications_defaults before insert or update on public.yt_publications for each row execute function public.yt_publication_defaults();

alter table public.yt_publications enable row level security;
create policy "Beheerders zien publicaties" on public.yt_publications for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders maken een concept" on public.yt_publications for insert to authenticated
  with check (public.is_studio_admin(studio_id) and status = 'draft' and youtube_video_id is null and error is null);
-- Alleen zolang er nog niets naar YouTube is gegaan.
create policy "Beheerders wijzigen een concept" on public.yt_publications for update to authenticated
  using (public.is_studio_admin(studio_id) and status in ('draft', 'failed'))
  with check (public.is_studio_admin(studio_id) and status in ('draft', 'failed'));
create policy "Beheerders verwijderen een concept" on public.yt_publications for delete to authenticated
  using (public.is_studio_admin(studio_id) and status = 'draft');

revoke all on public.yt_publications from anon, authenticated;
grant select, delete on public.yt_publications to authenticated;
grant insert (studio_id, video_id, render_id, title, description, tags, category_id, language, made_for_kids, contains_synthetic_media, visibility, publish_at) on public.yt_publications to authenticated;
-- Niet: status, youtube_video_id, error, channel_id, is_test (alleen de werker of de trigger).
grant update (render_id, title, description, tags, category_id, language, made_for_kids, contains_synthetic_media, visibility, publish_at) on public.yt_publications to authenticated;
grant select, insert, update, delete on public.yt_publications to service_role;

commit;

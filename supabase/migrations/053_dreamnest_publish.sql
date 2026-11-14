-- Dreamnest fase 5: publiceren naar het Dreamnest-YouTube-kanaal, altijd met Milans klik.
--
-- * dn_publications: één rij per video die naar YouTube kan (de lange aflevering en elke Short). Het dashboard vult
--   titel, beschrijving, tags, thumbnail en tijdstip in en zet hem klaar (status 'queued'). Uploaden, het YouTube-ID en
--   de eindstatus schrijft alleen de werker.
-- * Made for Kids en het AI-label staan vast aan: de tabel weigert iets anders.
-- * dn_render_jobs krijgt de stap 'dn_publish' (alleen de toegestane stappen-lijst wordt groter).
-- * Terugdraaien: drop table public.dn_publications; en de stappen-lijst terug zonder 'dn_publish'.

begin;

alter table public.dn_render_jobs drop constraint if exists dn_render_jobs_step_check;
alter table public.dn_render_jobs add constraint dn_render_jobs_step_check check (step in ('dn_concept', 'dn_storyboard', 'dn_keyframes', 'dn_animate', 'dn_music', 'dn_timeline', 'dn_preview', 'dn_render', 'dn_qc', 'dn_package', 'dn_publish', 'dn_ping'));

create table public.dn_publications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  episode_id uuid not null,
  channel_id uuid not null,
  kind text not null check (kind in ('long', 'short')),
  short_id text not null default '' check (short_id ~ '^[a-z0-9-]{0,80}$'),
  file text not null check (file ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.mp4$' and file !~ '\.\.'),
  thumbnail text check (thumbnail is null or (thumbnail ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.(jpg|png)$' and thumbnail !~ '\.\.')),
  title text not null check (length(title) between 1 and 100 and title !~ '[<>]'),
  description text not null default '' check (length(description) <= 5000 and description !~ '[<>]'),
  tags text[] not null default '{}' check (length(array_to_string(tags, ',')) <= 500),
  publish_at timestamptz,
  made_for_kids boolean not null default true check (made_for_kids),
  contains_synthetic_media boolean not null default true check (contains_synthetic_media),
  status text not null default 'draft' check (status in ('draft', 'queued', 'uploading', 'uploaded', 'scheduled', 'failed')),
  youtube_video_id text check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  youtube_channel_id text,
  progress numeric(5, 2) check (progress between 0 and 100),
  error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, kind, short_id),
  foreign key (studio_id, episode_id) references public.dn_episodes (studio_id, id) on delete cascade,
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade
);
create index dn_publications_episode_idx on public.dn_publications (episode_id);
create trigger dn_publications_updated_at before update on public.dn_publications for each row execute function public.set_updated_at();

alter table public.dn_publications enable row level security;
create policy "Beheerders zien Dreamnest-publicaties" on public.dn_publications for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders maken Dreamnest-publicaties" on public.dn_publications for insert to authenticated
  with check (public.is_studio_admin(studio_id) and status in ('draft', 'queued') and youtube_video_id is null and progress is null);
-- Wijzigen kan alleen zolang er nog niets bij YouTube staat; klaarzetten mag, 'geüpload' zetten niet.
create policy "Beheerders wijzigen Dreamnest-publicaties" on public.dn_publications for update to authenticated
  using (public.is_studio_admin(studio_id) and youtube_video_id is null and status in ('draft', 'queued', 'failed'))
  with check (public.is_studio_admin(studio_id) and youtube_video_id is null and status in ('draft', 'queued'));

revoke all on public.dn_publications from anon, authenticated;
grant select on public.dn_publications to authenticated;
grant insert (studio_id, episode_id, channel_id, kind, short_id, file, thumbnail, title, description, tags, publish_at, status) on public.dn_publications to authenticated;
grant update (thumbnail, title, description, tags, publish_at, status) on public.dn_publications to authenticated;
grant select, insert, update, delete on public.dn_publications to service_role;

commit;

-- KIVOXEL Studio: Viral-check (superprompt opschonen, fase 3).
--
-- * yt_jobs.step krijgt 'viral' (een video toetsen vóór publicatie) en 'reference' (wekelijks de best presterende
--   recente video's in de niche ophalen via de YouTube Data API; kost alleen quotum, geen geld).
-- * yt_reference_videos: kenmerken van referentievideo's per kanaal en zoekterm (titel, lengte, tags, duur,
--   uploadtijd, views t.o.v. abonnees, eerste zin van de beschrijving als hook). Alleen de werker schrijft.
-- * yt_viral_checks: de scorekaart per montage (stem, voice-over/script, gameplay/montage), met verbeterpunten en
--   tijdstempels. Een voorspelling, geen garantie. Alleen de werker schrijft; Milan leest.
-- * Kosten van de luistercheck lopen via reserve_yt_cost (binnen het maandplafond); testvideo's zijn gratis.
-- * Terugdraaien: drop table public.yt_viral_checks; drop table public.yt_reference_videos; en de stap-check terug.

begin;

alter table public.yt_jobs drop constraint yt_jobs_step_check;
alter table public.yt_jobs add constraint yt_jobs_step_check
  check (step in ('intake', 'analyse', 'script', 'voiceover', 'render', 'upload', 'publish', 'suggest', 'viral', 'reference'));

create table public.yt_reference_videos (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid references public.yt_channels (id) on delete cascade,
  query text not null check (length(query) between 1 and 100),
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  title text not null default '' check (length(title) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 60),
  duration_s integer check (duration_s >= 0),
  is_short boolean not null default false,
  published_at timestamptz,
  views bigint not null default 0 check (views >= 0),
  subscribers bigint check (subscribers >= 0),
  -- Views per subscriber: a small channel with many views did something right.
  ratio numeric,
  hook text check (length(hook) <= 300),
  fetched_at timestamptz not null default now(),
  unique (studio_id, query, youtube_video_id)
);
create index yt_reference_videos_channel_idx on public.yt_reference_videos (studio_id, channel_id, fetched_at desc);
alter table public.yt_reference_videos enable row level security;
create policy "Beheerders zien referentievideo's" on public.yt_reference_videos for select to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.yt_reference_videos from anon, authenticated;
grant select on public.yt_reference_videos to authenticated;
grant select, insert, update, delete on public.yt_reference_videos to service_role;

create table public.yt_viral_checks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  video_id uuid not null,
  render_id uuid,
  script_id uuid,
  overall numeric(3, 1) not null check (overall between 1 and 10),
  result jsonb not null check (jsonb_typeof(result) = 'object' and length(result::text) <= 20000),
  source text not null check (source in ('ai', 'rules', 'test')),
  model text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade
);
create index yt_viral_checks_video_idx on public.yt_viral_checks (video_id, created_at desc);
alter table public.yt_viral_checks enable row level security;
create policy "Beheerders zien viral-checks" on public.yt_viral_checks for select to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.yt_viral_checks from anon, authenticated;
grant select on public.yt_viral_checks to authenticated;
grant select, insert, delete on public.yt_viral_checks to service_role;

commit;

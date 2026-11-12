-- Familie M&K: YouTube Studio, statistieken (Kivoxel Studio 2.2, fase E). Nummer 041: YouTube-lijn.
--
-- * Momentopnames (2.2, hoofdstuk 7): elke synchronisatie is een nieuwe rij, zodat groei ("na 24 uur", "na 7 dagen")
--   te vergelijken is zonder alles opnieuw op te halen.
--   - yt_channel_snapshots: abonnees en totale views (Data API, bijna actueel), plus views, engaged views, kijktijd en
--     nieuwe abonnees over 7 en 28 dagen (Analytics, met vertraging; analytics_until zegt t/m welke dag).
--   - yt_video_snapshots: per video de tellers (Data API) en de statistieken (Analytics), met de kijkcurve.
-- * Alleen de werker (service-rol) schrijft; beheerders lezen. Kinderen en andere leden zien niets.
-- * Er staan geen tokens en geen persoonsgegevens van kijkers in: YouTube levert alleen totalen.
-- * Alleen nieuwe tabellen; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   drop table public.yt_video_snapshots; drop table public.yt_channel_snapshots;

begin;

create table public.yt_channel_snapshots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  taken_at timestamptz not null default now(),
  subscribers integer check (subscribers >= 0),
  views_total bigint not null check (views_total >= 0),
  videos_total integer not null check (videos_total >= 0),
  views_7d bigint check (views_7d >= 0),
  views_28d bigint check (views_28d >= 0),
  engaged_views_28d bigint check (engaged_views_28d >= 0),
  watch_minutes_28d numeric(14, 1) check (watch_minutes_28d >= 0),
  subscribers_gained_28d integer,
  daily jsonb check (daily is null or jsonb_typeof(daily) = 'array'),
  analytics_until date,
  analytics_error text check (length(analytics_error) <= 300),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade
);
create index yt_channel_snapshots_idx on public.yt_channel_snapshots (studio_id, channel_id, taken_at desc);

create table public.yt_video_snapshots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  -- Ook video's die met de hand op YouTube zijn gezet; video_id koppelt aan onze eigen video als die er is.
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  video_id uuid,
  taken_at timestamptz not null default now(),
  title text check (length(title) <= 200),
  published_at timestamptz,
  duration_s integer check (duration_s >= 0),
  views bigint not null check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  a_views bigint check (a_views >= 0),
  engaged_views bigint check (engaged_views >= 0),
  watch_minutes numeric(14, 1) check (watch_minutes >= 0),
  avg_view_duration_s numeric(10, 1) check (avg_view_duration_s >= 0),
  avg_view_pct numeric(6, 1) check (avg_view_pct >= 0),
  subscribers_gained integer,
  retention jsonb check (retention is null or (jsonb_typeof(retention) = 'array' and jsonb_array_length(retention) <= 200)),
  analytics_until date,
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade,
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete set null (video_id)
);
create index yt_video_snapshots_idx on public.yt_video_snapshots (studio_id, youtube_video_id, taken_at desc);

alter table public.yt_channel_snapshots enable row level security;
alter table public.yt_video_snapshots enable row level security;
create policy "Beheerders zien kanaalcijfers" on public.yt_channel_snapshots for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders zien videocijfers" on public.yt_video_snapshots for select to authenticated using (public.is_studio_admin(studio_id));

revoke all on public.yt_channel_snapshots, public.yt_video_snapshots from anon, authenticated;
grant select on public.yt_channel_snapshots, public.yt_video_snapshots to authenticated;
grant select, insert, update, delete on public.yt_channel_snapshots, public.yt_video_snapshots to service_role;

commit;

-- Familie M&K: YouTube Studio, voice-over en montage (pakket 53). Nummer 030: de YouTube-lijn gebruikt 030 en hoger
-- (zie docs/taakverdeling.md).
--
-- * yt_settings krijgt de stem: taal, stemnaam, tempo en hoe hard het gamegeluid onder de verteller klinkt.
--   Stemdienst: Google Cloud TTS (Chirp 3 HD), alleen binnen het gratis deel (akkoord Milan 11-11-2026).
-- * yt_renders: de gemonteerde previews. Het videobestand blijft op de pc van Milan; hier staan alleen de gegevens.
--   Alleen de werker (service-rol) maakt renders aan; beheerders zien en verwijderen ze.

begin;

alter table public.yt_settings
  add column voice_language text not null default 'en-US' check (voice_language in ('en-US', 'en-GB', 'nl-NL')),
  add column voice_name text not null default 'en-US-Chirp3-HD-Charon' check (voice_name ~ '^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]{1,60}$'),
  add column speaking_rate numeric(3, 2) not null default 1.10 check (speaking_rate between 0.75 and 1.50),
  add column game_volume numeric(3, 2) not null default 0.25 check (game_volume between 0 and 1);

create table public.yt_renders (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  video_id uuid not null,
  script_id uuid not null,
  job_id uuid,
  -- Alleen de bestandsnaam in de map renders op de pc, nooit een volledig pad.
  file_name text not null check (file_name ~ '^[A-Za-z0-9_-]{1,120}\.mp4$'),
  duration_ms integer not null check (duration_ms > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  -- null: gemonteerd zonder stem (stemdienst nog niet verbonden of testdata).
  voice_name text,
  tts_characters integer not null default 0 check (tts_characters >= 0),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  unique (job_id),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade,
  foreign key (studio_id, job_id) references public.yt_jobs (studio_id, id) on delete set null (job_id)
);
alter table public.yt_renders add constraint yt_renders_script_fk foreign key (script_id) references public.yt_scripts (id) on delete cascade;
create index yt_renders_video_idx on public.yt_renders (video_id, created_at desc);

alter table public.yt_renders enable row level security;
create policy "Beheerders zien renders" on public.yt_renders for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen renders" on public.yt_renders for delete to authenticated using (public.is_studio_admin(studio_id));

revoke all on public.yt_renders from anon;
grant select, delete on public.yt_renders to authenticated;
grant select, insert, update, delete on public.yt_renders to service_role;

commit;

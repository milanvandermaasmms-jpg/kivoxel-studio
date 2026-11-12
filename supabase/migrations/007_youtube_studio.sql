-- Familie M&K: YouTube Studio (pakket 51). Opnames, video's, verwerkingsstappen (de wachtrij) en kosten.
--
-- * Alleen beheerders zien en wijzigen deze tabellen. Er is bewust geen recht per module: een gezinslid of
--   kindprofiel kan YouTube Studio nooit openen, ook niet als een beheerder rechten uitdeelt.
-- * Ruwe opnames blijven op de pc van Milan. Hier staan alleen gegevens over het bestand (naam, grootte,
--   vingerafdruk, lengte, beeldformaat), nooit het bestand zelf.
-- * De werker op de pc gebruikt de service-rol: die gaat buiten RLS om en pakt opdrachten op met claim_yt_job.
--   Die sleutel staat alleen in worker/.env.local op de pc, nooit in de app of in Git.
-- * Dezelfde opname kan maar één keer per huishouden bestaan (vingerafdruk), een stap met dezelfde sleutel maar
--   één keer in de wachtrij, en een kostenpost per stap maar één keer: zo telt niets dubbel.

begin;

-- ---------- Opnames ----------

create table public.yt_recordings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  label text not null check (length(label) between 1 and 200),
  original_name text not null check (length(original_name) between 1 and 300),
  size_bytes bigint not null check (size_bytes > 0),
  -- Snelle vingerafdruk uit de browser (SHA-256 over grootte plus begin, midden en eind): herkent een dubbele upload vóór het uploaden.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  -- Volledige SHA-256 van het hele bestand, berekend door de werker na ontvangst.
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'received', 'ready', 'failed')),
  is_test boolean not null default false,
  duration_ms integer check (duration_ms >= 0),
  width integer check (width > 0),
  height integer check (height > 0),
  fps numeric(6, 3) check (fps > 0),
  video_codec text,
  audio_codec text,
  error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, fingerprint),
  unique (studio_id, id)
);
create index yt_recordings_studio_idx on public.yt_recordings (studio_id, created_at desc);

-- ---------- Video's (formats uit docs/youtube-onderzoek.md hoofdstuk 5) ----------

create table public.yt_videos (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  recording_id uuid,
  -- A = Bijna-dood-moment (Short), B = Zeldzame vondst (Short), C = Survival-verhaal (lang).
  format text not null check (format in ('A', 'B', 'C')),
  -- Shorts verticaal, lange video's horizontaal; volgt uit het format.
  kind text not null generated always as (case when format = 'C' then 'long' else 'short' end) stored,
  title text check (length(title) <= 100),
  language text not null default 'en' check (language in ('en', 'nl')),
  status text not null default 'idea' check (status in ('idea', 'scripted', 'rendering', 'review', 'approved', 'scheduled', 'published', 'failed')),
  -- YouTube (hoofdstuk 6): altijd zelf een privacystand meesturen, standaard privé.
  privacy_status text not null default 'private' check (privacy_status in ('private', 'unlisted', 'public')),
  made_for_kids boolean,
  contains_synthetic_media boolean not null default false,
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  scheduled_at timestamptz,
  published_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id),
  foreign key (studio_id, recording_id) references public.yt_recordings (studio_id, id) on delete set null (recording_id)
);
create unique index yt_videos_youtube_id_idx on public.yt_videos (youtube_video_id) where youtube_video_id is not null;
create index yt_videos_studio_idx on public.yt_videos (studio_id, created_at desc);

-- ---------- Verwerkingsstappen: de wachtrij voor de werker ----------

create table public.yt_jobs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  recording_id uuid,
  video_id uuid,
  step text not null check (step in ('intake', 'analyse', 'script', 'voiceover', 'render', 'upload', 'publish')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Voorkomt dat dezelfde stap twee keer in de wachtrij komt, ook bij dubbelklikken of een herstart.
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_by text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, idempotency_key),
  unique (studio_id, id),
  foreign key (studio_id, recording_id) references public.yt_recordings (studio_id, id) on delete cascade,
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade
);
create index yt_jobs_queue_idx on public.yt_jobs (created_at) where status = 'queued';
create index yt_jobs_studio_idx on public.yt_jobs (studio_id, created_at desc);

-- ---------- Kosten (hele centen) ----------

create table public.yt_costs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  video_id uuid,
  job_id uuid,
  category text not null check (category in ('storage', 'processing', 'analysis', 'voiceover', 'rendering', 'other')),
  service text not null check (length(service) between 1 and 100),
  description text check (length(description) <= 500),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR' check (currency in ('EUR', 'USD')),
  is_estimate boolean not null default true,
  incurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete set null (video_id),
  foreign key (studio_id, job_id) references public.yt_jobs (studio_id, id) on delete set null (job_id)
);
-- Een stap telt financieel één keer.
create unique index yt_costs_job_once_idx on public.yt_costs (job_id, category) where job_id is not null;
create index yt_costs_studio_idx on public.yt_costs (studio_id, incurred_on desc);

create trigger yt_recordings_updated_at before update on public.yt_recordings for each row execute function public.set_updated_at();
create trigger yt_videos_updated_at before update on public.yt_videos for each row execute function public.set_updated_at();
create trigger yt_jobs_updated_at before update on public.yt_jobs for each row execute function public.set_updated_at();

-- ---------- De werker pakt de oudste wachtende opdracht ----------

-- Eén opdracht tegelijk, nooit door twee werkers (skip locked). Een opdracht die langer dan p_stale_minutes
-- vastzit (pc uitgezet tijdens verwerken) komt weer vrij, tot max_attempts is bereikt.
create function public.claim_yt_job(p_worker text, p_steps text[] default null, p_stale_minutes integer default 30)
returns setof public.yt_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.yt_jobs j
  set status = 'failed', error = coalesce(j.error, 'Vastgelopen: te vaak geprobeerd'), finished_at = now(), locked_by = null, locked_at = null
  where j.status = 'running' and j.locked_at < now() - make_interval(mins => p_stale_minutes) and j.attempts >= j.max_attempts;

  return query
  update public.yt_jobs j
  set status = 'running', attempts = j.attempts + 1, locked_by = p_worker, locked_at = now(), started_at = now(), error = null
  where j.id = (
    select c.id from public.yt_jobs c
    where (c.status = 'queued' or (c.status = 'running' and c.locked_at < now() - make_interval(mins => p_stale_minutes)))
      and c.attempts < c.max_attempts
      and (p_steps is null or c.step = any (p_steps))
    order by c.created_at
    limit 1
    for update skip locked
  )
  returning j.*;
end;
$$;

-- Een mislukte of geannuleerde stap opnieuw in de wachtrij, met een schone teller. Alleen voor beheerders.
create function public.retry_yt_job(p_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.yt_jobs j
  set status = 'queued', attempts = 0, error = null, locked_by = null, locked_at = null, started_at = null, finished_at = null
  where j.id = p_job and j.status in ('failed', 'cancelled') and public.is_studio_admin(j.studio_id);
  if not found then
    raise exception 'Deze stap kan niet opnieuw worden gestart';
  end if;
end;
$$;

-- ---------- RLS: alleen beheerders ----------

alter table public.yt_recordings enable row level security;
alter table public.yt_videos enable row level security;
alter table public.yt_jobs enable row level security;
alter table public.yt_costs enable row level security;

create policy "Beheerders zien opnames" on public.yt_recordings for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders voegen opnames toe" on public.yt_recordings for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen opnames" on public.yt_recordings for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen opnames" on public.yt_recordings for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien video's" on public.yt_videos for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders voegen video's toe" on public.yt_videos for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen video's" on public.yt_videos for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen video's" on public.yt_videos for delete to authenticated using (public.is_studio_admin(studio_id));

-- Het dashboard zet opdrachten klaar en annuleert wachtende. Opnieuw proberen gaat via retry_yt_job.
-- Starten en afronden doet alleen de werker.
create policy "Beheerders zien de wachtrij" on public.yt_jobs for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders zetten opdrachten klaar" on public.yt_jobs for insert to authenticated
  with check (public.is_studio_admin(studio_id) and status = 'queued' and attempts = 0 and locked_by is null and result is null);
create policy "Beheerders annuleren wachtende opdrachten" on public.yt_jobs for update to authenticated
  using (public.is_studio_admin(studio_id) and status = 'queued')
  with check (public.is_studio_admin(studio_id) and status = 'cancelled' and locked_by is null);

create policy "Beheerders zien kosten" on public.yt_costs for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders voegen kosten toe" on public.yt_costs for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen kosten" on public.yt_costs for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen kosten" on public.yt_costs for delete to authenticated using (public.is_studio_admin(studio_id));

revoke all on public.yt_recordings, public.yt_videos, public.yt_jobs, public.yt_costs from anon;
grant select, insert, update, delete on public.yt_recordings, public.yt_videos, public.yt_costs to authenticated;
grant select, insert, update on public.yt_jobs to authenticated;

revoke execute on function public.claim_yt_job(text, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_yt_job(text, text[], integer) to service_role;
revoke execute on function public.retry_yt_job(uuid) from public, anon;
grant execute on function public.retry_yt_job(uuid) to authenticated;

commit;

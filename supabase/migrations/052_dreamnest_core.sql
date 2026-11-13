-- Dreamnest fase 0: eigen afleveringen en een eigen wachtrij, volledig los van KIVOXEL.
--
-- * Alleen nieuwe tabellen en een nieuwe functie: niets aan yt_* verandert. KIVOXEL ziet dit werk nooit.
-- * dn_episodes: één aflevering (60-600 min) van een kanaal met werkwijze 'generate'. Groot materiaal staat op de pc;
--   hier alleen keuzes, status, kosten en paden.
-- * dn_render_jobs: de Dreamnest-wachtrij. Het dashboard zet stappen klaar en annuleert wachtende; starten en
--   afronden doet alleen de werker (claim_dn_job, service-rol). Een render gaat in stukken (chunk_index/chunk_total),
--   zodat hij hervat kan worden en KIVOXEL nooit lang hoeft te wachten.
-- * Budgetplafond per aflevering (budget_cents); spent_cents schrijft alleen de werker.
-- * Terugdraaien: drop function public.claim_dn_job(text, text[], integer); drop table public.dn_render_jobs;
--   drop table public.dn_episodes;

begin;

create table public.dn_episodes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  title text not null default '' check (length(title) <= 200),
  status text not null default 'concept' check (status in ('concept', 'storyboard', 'keyframes', 'animation', 'music', 'timeline', 'preview', 'rendering', 'qc', 'packaging', 'ready', 'archived')),
  duration_min integer not null default 60 check (duration_min in (60, 90, 120, 180, 600)),
  concept jsonb not null default '{}'::jsonb check (jsonb_typeof(concept) = 'object' and length(concept::text) <= 20000),
  budget_cents integer not null default 0 check (budget_cents between 0 and 100000),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  -- Zodra er een eindversie is, krijgt de aflevering een gewone video-rij (Te keuren / Klaar voor YouTube / Live).
  video_id uuid,
  is_test boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade,
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete set null (video_id)
);
create index dn_episodes_studio_idx on public.dn_episodes (studio_id, created_at desc);
create trigger dn_episodes_updated_at before update on public.dn_episodes for each row execute function public.set_updated_at();

create table public.dn_render_jobs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  episode_id uuid not null,
  step text not null check (step in ('dn_concept', 'dn_storyboard', 'dn_keyframes', 'dn_animate', 'dn_music', 'dn_timeline', 'dn_preview', 'dn_render', 'dn_qc', 'dn_package', 'dn_ping')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 20000),
  result jsonb,
  error text,
  chunk_index integer check (chunk_index >= 0),
  chunk_total integer check (chunk_total >= 1),
  progress numeric(5, 2) check (progress between 0 and 100),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, idempotency_key),
  foreign key (studio_id, episode_id) references public.dn_episodes (studio_id, id) on delete cascade
);
create index dn_render_jobs_queue_idx on public.dn_render_jobs (created_at) where status = 'queued';
create index dn_render_jobs_episode_idx on public.dn_render_jobs (episode_id, created_at desc);
create trigger dn_render_jobs_updated_at before update on public.dn_render_jobs for each row execute function public.set_updated_at();

alter table public.dn_episodes enable row level security;
alter table public.dn_render_jobs enable row level security;

create policy "Beheerders zien afleveringen" on public.dn_episodes for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders maken afleveringen" on public.dn_episodes for insert to authenticated
  with check (public.is_studio_admin(studio_id) and spent_cents = 0);
create policy "Beheerders wijzigen afleveringen" on public.dn_episodes for update to authenticated
  using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));

create policy "Beheerders zien de Dreamnest-wachtrij" on public.dn_render_jobs for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders zetten Dreamnest-stappen klaar" on public.dn_render_jobs for insert to authenticated
  with check (public.is_studio_admin(studio_id) and status = 'queued' and attempts = 0 and locked_by is null and result is null);
create policy "Beheerders annuleren wachtende Dreamnest-stappen" on public.dn_render_jobs for update to authenticated
  using (public.is_studio_admin(studio_id) and status = 'queued')
  with check (public.is_studio_admin(studio_id) and status = 'cancelled' and locked_by is null);

revoke all on public.dn_episodes, public.dn_render_jobs from anon, authenticated;
grant select, insert on public.dn_episodes to authenticated;
-- Niet: spent_cents, video_id (alleen de werker).
grant update (title, status, duration_min, concept, budget_cents) on public.dn_episodes to authenticated;
grant select, insert on public.dn_render_jobs to authenticated;
grant update (status) on public.dn_render_jobs to authenticated;
grant select, insert, update, delete on public.dn_episodes, public.dn_render_jobs to service_role;

-- De werker pakt de oudste wachtende Dreamnest-stap; zelfde regels als claim_yt_job.
create function public.claim_dn_job(p_worker text, p_steps text[] default null, p_stale_minutes integer default 30)
returns setof public.dn_render_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.dn_render_jobs j
  set status = 'failed', error = coalesce(j.error, 'Vastgelopen: te vaak geprobeerd'), finished_at = now(), locked_by = null, locked_at = null
  where j.status = 'running' and j.locked_at < now() - make_interval(mins => p_stale_minutes) and j.attempts >= j.max_attempts;

  return query
  update public.dn_render_jobs j
  set status = 'running', attempts = j.attempts + 1, locked_by = p_worker, locked_at = now(), started_at = now(), heartbeat_at = now(), error = null
  where j.id = (
    select c.id from public.dn_render_jobs c
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
revoke execute on function public.claim_dn_job(text, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_dn_job(text, text[], integer) to service_role;

commit;

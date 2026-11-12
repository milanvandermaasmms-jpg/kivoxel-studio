-- Familie M&K: YouTube Studio, Live Production Center (Kivoxel Studio 2.0, fase B1). Nummer 033: YouTube-lijn.
--
-- * yt_jobs krijgt echte voortgang uit de werker: voortgang (0-1, alleen als die te meten is), fase, meetwaarden
--   (frames, snelheid, verwerkte en totale tijd, resterende tijd uit de gemeten snelheid) en een hartslag.
--   Geen verzonnen percentages: zonder meting blijft progress leeg.
-- * yt_job_events: logboek en mijlpalen per stap, persistent. Alleen de werker schrijft.
-- * Annuleren: een wachtende stap wordt meteen geannuleerd; bij een lopende stap zet het dashboard
--   cancel_requested en stopt de werker het werk (FFmpeg) echt.
-- * Realtime: yt_jobs en yt_job_events gaan in de realtime-publicatie; RLS bepaalt wie wat ziet.

begin;

alter table public.yt_jobs
  add column progress numeric(5, 4) check (progress between 0 and 1),
  add column phase text check (length(phase) <= 80),
  add column metrics jsonb check (metrics is null or jsonb_typeof(metrics) = 'object'),
  add column heartbeat_at timestamptz,
  add column cancel_requested boolean not null default false;

create table public.yt_job_events (
  id bigint generated always as identity primary key,
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  at timestamptz not null default now(),
  kind text not null default 'log' check (kind in ('log', 'milestone', 'note', 'error')),
  message text not null check (length(message) between 1 and 500),
  foreign key (studio_id, job_id) references public.yt_jobs (studio_id, id) on delete cascade
);
create index yt_job_events_job_idx on public.yt_job_events (job_id, at);

alter table public.yt_job_events enable row level security;
create policy "Beheerders zien het logboek" on public.yt_job_events for select to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.yt_job_events from anon, authenticated;
grant select on public.yt_job_events to authenticated;
grant select, insert, delete on public.yt_job_events to service_role;

-- Annuleren vanuit het dashboard: wachtend = meteen geannuleerd, lopend = verzoek aan de werker.
create function public.cancel_yt_job(p_job uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v public.yt_jobs;
begin
  select * into v from public.yt_jobs where id = p_job for update;
  if v.id is null or not public.is_studio_admin(v.studio_id) then
    raise exception 'Stap niet gevonden';
  end if;
  if v.status = 'queued' then
    update public.yt_jobs set status = 'cancelled', finished_at = now() where id = p_job;
    return 'cancelled';
  elsif v.status = 'running' then
    update public.yt_jobs set cancel_requested = true where id = p_job;
    return 'requested';
  end if;
  return v.status;
end;
$$;
revoke execute on function public.cancel_yt_job(uuid) from public, anon;
grant execute on function public.cancel_yt_job(uuid) to authenticated;

-- Opnieuw proberen wist ook de oude voortgang en een eerder annuleerverzoek.
create or replace function public.reset_yt_job_progress() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'queued' and old.status <> 'queued' then
    new.progress := null;
    new.phase := null;
    new.metrics := null;
    new.heartbeat_at := null;
    new.cancel_requested := false;
  end if;
  return new;
end;
$$;
create trigger yt_jobs_reset_progress before update of status on public.yt_jobs for each row execute function public.reset_yt_job_progress();

alter publication supabase_realtime add table public.yt_jobs, public.yt_job_events;

commit;

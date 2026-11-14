-- KIVOXEL Studio: Ivar leert en adviseert (inzichten).
--
-- * Eén keer per week per actief kanaal zet de werker zelf een stap 'insight' in de gewone wachtrij (yt_jobs). Ivar
--   bekijkt dan de referentievideo's in de niche (trends), de eigen cijfers en wat Milan met Ivars voorstellen deed
--   (toegepast, teruggedraaid, laten vallen), en schrijft hooguit een handvol inzichten met bewijs.
-- * Een inzicht is een advies, geen instructie: het wordt pas een blijvende voorkeur als Milan op "Onthouden" klikt
--   (dan komt het in ivar_memory). Alles is zichtbaar, af te wijzen en te verwijderen. Kanalen blijven gescheiden.
-- * Kosten: ± 1-2 cent per kanaal per week via reserve_yt_cost (maandplafond).
--
-- Terugdraaien:
--   drop table public.ivar_insights;
--   (en de stap 'insight' uit yt_jobs_step_check halen)

begin;

alter table public.yt_jobs drop constraint yt_jobs_step_check;
alter table public.yt_jobs add constraint yt_jobs_step_check
  check (step in ('intake', 'analyse', 'script', 'voiceover', 'render', 'upload', 'publish', 'suggest', 'viral', 'reference', 'assistant', 'insight'));

create table public.ivar_insights (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  -- trend = wat nu werkt in de niche; learning = wat Ivar leerde van Milans keuzes en de cijfers; tip = concreet advies.
  kind text not null check (kind in ('trend', 'learning', 'tip')),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(body) between 1 and 1500),
  -- Wat Milan ermee kan: een idee, een voorkeur om te onthouden, of een volgende stap.
  suggestion text check (length(suggestion) <= 500),
  -- De data waarop het steunt (cijfers, voorbeelden); nooit verzonnen.
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and length(evidence::text) <= 8000),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  status text not null default 'new' check (status in ('new', 'seen', 'accepted', 'dismissed')),
  -- ISO-week, bijv. 2026-W46: per week en kanaal geen dubbele inzichten.
  week text not null check (week ~ '^[0-9]{4}-W[0-9]{2}$'),
  job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, channel_id, week, kind, title),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade
);
create index ivar_insights_idx on public.ivar_insights (studio_id, channel_id, created_at desc);
create trigger ivar_insights_updated_at before update on public.ivar_insights for each row execute function public.set_updated_at();

alter table public.ivar_insights enable row level security;
create policy "Beheerders zien inzichten" on public.ivar_insights for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders beoordelen inzichten" on public.ivar_insights for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen inzichten" on public.ivar_insights for delete to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.ivar_insights from anon, authenticated;
grant select, delete on public.ivar_insights to authenticated;
grant update (status) on public.ivar_insights to authenticated;
grant select, insert, update, delete on public.ivar_insights to service_role;

commit;

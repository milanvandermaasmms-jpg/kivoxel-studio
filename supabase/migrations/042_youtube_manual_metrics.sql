-- Familie M&K: YouTube Studio, handmatige cijfers (Kivoxel Studio 2.2, hoofdstuk 24.7, fase E2). Nummer 042.
--
-- * Wat YouTube niet via de API levert, vult Milan zelf in vanuit YouTube Studio. Eerst: bij Shorts het percentage
--   "Viewed" (tegenover "Swiped away"). Het scherm markeert deze waarde altijd als handmatig.
-- * Eén waarde per video en soort cijfer; een nieuwe invoer vervangt de oude (met tijdstip en wie).
-- * Alleen beheerders lezen en schrijven; kinderen en andere leden zien niets.
-- * Alleen een nieuwe tabel. Terugdraaien: drop table public.yt_manual_metrics;

begin;

create table public.yt_manual_metrics (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  metric text not null check (metric in ('viewed_pct')),
  value numeric(5, 1) not null check (value between 0 and 100),
  measured_on date not null default current_date,
  entered_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (studio_id, youtube_video_id, metric)
);
create trigger yt_manual_metrics_updated_at before update on public.yt_manual_metrics for each row execute function public.set_updated_at();

alter table public.yt_manual_metrics enable row level security;
create policy "Beheerders zien handmatige cijfers" on public.yt_manual_metrics for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders vullen cijfers in" on public.yt_manual_metrics for insert to authenticated with check (public.is_studio_admin(studio_id) and entered_by = auth.uid());
create policy "Beheerders passen cijfers aan" on public.yt_manual_metrics for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id) and entered_by = auth.uid());
create policy "Beheerders wissen cijfers" on public.yt_manual_metrics for delete to authenticated using (public.is_studio_admin(studio_id));

revoke all on public.yt_manual_metrics from anon, authenticated;
grant select, delete on public.yt_manual_metrics to authenticated;
grant insert (studio_id, youtube_video_id, metric, value, measured_on, entered_by) on public.yt_manual_metrics to authenticated;
grant update (value, measured_on, entered_by) on public.yt_manual_metrics to authenticated;
grant select, insert, update, delete on public.yt_manual_metrics to service_role;

commit;

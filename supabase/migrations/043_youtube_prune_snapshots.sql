-- Familie M&K: YouTube Studio, momentopnames opruimen (Kivoxel Studio 2.2, fase G). Nummer 043: YouTube-lijn.
--
-- * De werker maakt elk uur een momentopname (migratie 041). Zonder opruimen groeit dat met ongeveer 24 rijen per
--   video per dag. Deze functie bewaart:
--   - alles van de laatste 8 dagen (groei per uur, "views laatste 24 uur");
--   - daarna per video en per kanaal de eerste meting van elke dag (Nederlandse tijd), voor groeicurves;
--   - per video de eerste meting na 24 uur, 72 uur en 7 dagen (het prestatierapport).
-- * Alleen de werker (service-rol) mag hem aanroepen; hij geeft terug hoeveel rijen er weg zijn.
-- * Alleen een nieuwe functie. Terugdraaien: drop function public.yt_prune_snapshots();

begin;

create function public.yt_prune_snapshots() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cut timestamptz := now() - interval '8 days';
  v_videos integer;
  v_channels integer;
begin
  with keep as (
    -- first snapshot per video per Amsterdam day
    select distinct on (studio_id, youtube_video_id, (taken_at at time zone 'Europe/Amsterdam')::date) id
    from public.yt_video_snapshots
    order by studio_id, youtube_video_id, (taken_at at time zone 'Europe/Amsterdam')::date, taken_at
  ), milestones as (
    select distinct on (s.studio_id, s.youtube_video_id, m.hours) s.id
    from public.yt_video_snapshots s
    cross join (values (24), (72), (168)) as m (hours)
    where s.published_at is not null and s.taken_at >= s.published_at + make_interval(hours => m.hours)
    order by s.studio_id, s.youtube_video_id, m.hours, s.taken_at
  )
  delete from public.yt_video_snapshots v
  where v.taken_at < v_cut and v.id not in (select id from keep) and v.id not in (select id from milestones);
  get diagnostics v_videos = row_count;

  with keep as (
    select distinct on (studio_id, channel_id, (taken_at at time zone 'Europe/Amsterdam')::date) id
    from public.yt_channel_snapshots
    order by studio_id, channel_id, (taken_at at time zone 'Europe/Amsterdam')::date, taken_at
  )
  delete from public.yt_channel_snapshots c
  where c.taken_at < v_cut and c.id not in (select id from keep);
  get diagnostics v_channels = row_count;

  return v_videos + v_channels;
end;
$$;
revoke execute on function public.yt_prune_snapshots() from public, anon, authenticated;
grant execute on function public.yt_prune_snapshots() to service_role;

commit;

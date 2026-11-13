-- KIVOXEL Studio: één video = één status = één plek (opschonen 13-11-2026).
--
-- * yt_videos.status krijgt 'archived': een video die nergens meer heen gaat (concept afgewezen, of door Milan
--   gearchiveerd). Hij verdwijnt uit alle lijsten, maar wordt niet verwijderd; terugzetten kan.
-- * Een video die op YouTube staat (youtube_video_id gevuld) kan nooit gearchiveerd worden.
-- * Opschonen: concepten die Milan afwees zonder om een nieuwe versie te vragen, gaan naar 'archived'.
--   Proefrun (eerst los uitvoeren, verandert niets): supabase/dry-run/051_preview.sql
-- * Backup vooraf: C:\Users\famdj\KIVOXEL\backups\kivoxel-backup-2026-11-13-voor-opschonen.json
-- * Terugdraaien: update public.yt_videos set status = 'scripted' where status = 'archived';
--   en de status-check zonder 'archived' terugzetten.

begin;

alter table public.yt_videos drop constraint yt_videos_status_check;
alter table public.yt_videos add constraint yt_videos_status_check
  check (status in ('idea', 'scripted', 'rendering', 'review', 'approved', 'scheduled', 'published', 'failed', 'archived'));
alter table public.yt_videos add constraint yt_videos_archived_not_live
  check (not (status = 'archived' and youtube_video_id is not null));

-- Afgewezen concepten zonder nieuwe versie: nieuwste script afgewezen, geen goedgekeurd script,
-- geen script-stap die nog loopt, niet op YouTube.
update public.yt_videos v
set status = 'archived'
where v.status in ('idea', 'scripted')
  and v.youtube_video_id is null
  and (select s.status from public.yt_scripts s where s.video_id = v.id order by s.version desc limit 1) = 'rejected'
  and not exists (select 1 from public.yt_scripts s where s.video_id = v.id and s.status = 'approved')
  and not exists (select 1 from public.yt_jobs j where j.video_id = v.id and j.step = 'script' and j.status in ('queued', 'running'));

commit;

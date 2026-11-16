-- KIVOXEL Studio: Poortwachter helemaal uit (besluit Milan, 16-11-2026: "verwijder de poortwachter helemaal").
-- De database blokkeert niets meer bij goedkeuren (yt_videos) of bij uploaden/publiceren (yt_jobs).
-- Alleen de twee triggers gaan weg; de functies blijven staan, zodat terugzetten één regel per trigger is:
--   create trigger yt_jobs_gate before insert on public.yt_jobs for each row execute function public.yt_jobs_gate();
--   create trigger yt_videos_gate before update of status on public.yt_videos for each row execute function public.yt_videos_gate();

begin;

drop trigger if exists yt_videos_gate on public.yt_videos;
drop trigger if exists yt_jobs_gate on public.yt_jobs;

commit;

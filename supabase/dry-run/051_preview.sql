-- Proefrun van migratie 051: toont welke video's gearchiveerd worden. Verandert NIETS.
select v.id,
       v.format,
       r.label as opname,
       (select s.top_line from public.yt_scripts s where s.video_id = v.id order by s.version desc limit 1) as titel,
       v.status as nu,
       'archived' as wordt
from public.yt_videos v
left join public.yt_recordings r on r.id = v.recording_id
where v.status in ('idea', 'scripted')
  and v.youtube_video_id is null
  and (select s.status from public.yt_scripts s where s.video_id = v.id order by s.version desc limit 1) = 'rejected'
  and not exists (select 1 from public.yt_scripts s where s.video_id = v.id and s.status = 'approved')
  and not exists (select 1 from public.yt_jobs j where j.video_id = v.id and j.step = 'script' and j.status in ('queued', 'running'))
order by r.label, v.created_at;

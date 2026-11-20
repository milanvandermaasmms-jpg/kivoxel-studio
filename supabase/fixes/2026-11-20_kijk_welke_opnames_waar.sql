-- Alleen kijken, verandert niets (20-11-2026): elke opname en video van de laatste 14 dagen met zijn kanaal,
-- plus de YouTube-video's die de Studio per kanaal ziet. Zo zien we welke Roblox/Fortnite bij KIVOXEL staan.
select 'opname' as soort, c.name as kanaal, r.created_at::date as datum, r.label as naam, r.original_name as bestand,
       (select count(*) from public.yt_videos v where v.recording_id = r.id) as videos,
       (select string_agg(v.youtube_video_id, ', ') from public.yt_videos v where v.recording_id = r.id and v.youtube_video_id is not null) as youtube_ids,
       r.id::text as id
from public.yt_recordings r
left join public.yt_channels c on c.id = r.channel_id
where r.created_at > now() - interval '14 days'
union all
select 'op youtube', c.name, max(s.taken_at)::date, max(s.title), null, null, s.youtube_video_id, coalesce(max(s.video_id::text), '(niet uit de Studio)')
from public.yt_video_snapshots s
left join public.yt_channels c on c.id = s.channel_id
where s.taken_at > now() - interval '3 days'
group by c.name, s.youtube_video_id
order by 1, 2, 3 desc;

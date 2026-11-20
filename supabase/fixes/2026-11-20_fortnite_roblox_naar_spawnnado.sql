-- Reparatie 20-11-2026: Roblox- en Fortnite-opnames (en GTA / Call of Duty) stonden bij KIVOXEL. KIVOXEL is alleen Minecraft.
-- Dit zet elke opname waarvan de naam SpawnNado of een andere game dan Minecraft noemt, met alles wat erbij hoort
-- (momenten, video's, scripts, montages, stappen, kosten, publicaties), bij SpawnNado.
-- Video's die al met de KIVOXEL-sleutel op YouTube stonden, gaan terug naar "Klaar voor YouTube" (niets wordt vanzelf
-- geüpload). Hun YouTube-ID staat in het resultaat: die video's verwijder je zelf bij KIVOXEL in YouTube Studio.
-- Raakt geen Minecraft-opnames en niets dat al bij SpawnNado staat. Veilig om nog eens te draaien.
begin;

create temp table fix_target on commit drop as
select c.studio_id, c.id as channel_id
from public.yt_channels c
where c.slug ~* 'spawn-?nado' or c.name ~* 'spawn-?nado';

do $$
begin
  if (select count(*) from fix_target) <> 1 then
    raise exception 'Niet precies één SpawnNado-kanaal gevonden; er is niets veranderd';
  end if;
end;
$$;

create temp table fix_recordings on commit drop as
select r.id, r.label
from public.yt_recordings r
join fix_target t on t.studio_id = r.studio_id
where r.channel_id is distinct from t.channel_id
  and (r.label || ' ' || coalesce(r.original_name, '')) ~* '(spawn-?nado|fortnite|roblox|\mgta\M|grand theft|call of duty|\mcod\M|warzone|black ops|modern warfare)';

create temp table fix_videos on commit drop as
select v.id, v.recording_id, v.youtube_video_id
from public.yt_videos v
where v.recording_id in (select id from fix_recordings);

-- De kanaalbewakers staan alleen binnen deze transactie even uit (ze weigeren normaal elke kanaalwissel).
alter table public.yt_recordings disable trigger yt_recordings_channel;
alter table public.yt_moments disable trigger yt_moments_channel;
alter table public.yt_videos disable trigger yt_videos_channel;
alter table public.yt_scripts disable trigger yt_scripts_channel;
alter table public.yt_renders disable trigger yt_renders_channel;
alter table public.yt_jobs disable trigger yt_jobs_channel;
alter table public.yt_costs disable trigger yt_costs_channel;
alter table public.yt_publications disable trigger yt_publications_defaults;

update public.yt_recordings set channel_id = (select channel_id from fix_target) where id in (select id from fix_recordings);
update public.yt_moments set channel_id = (select channel_id from fix_target) where recording_id in (select id from fix_recordings);
update public.yt_videos set channel_id = (select channel_id from fix_target) where id in (select id from fix_videos);
update public.yt_scripts set channel_id = (select channel_id from fix_target) where video_id in (select id from fix_videos);
update public.yt_renders set channel_id = (select channel_id from fix_target) where video_id in (select id from fix_videos);
update public.yt_jobs set channel_id = (select channel_id from fix_target)
where recording_id in (select id from fix_recordings) or video_id in (select id from fix_videos);
update public.yt_costs set channel_id = (select channel_id from fix_target)
where video_id in (select id from fix_videos)
   or job_id in (select id from public.yt_jobs where recording_id in (select id from fix_recordings) or video_id in (select id from fix_videos));

-- Al op YouTube (op KIVOXEL): terug naar "Klaar voor YouTube", zodat Milan ze zelf opnieuw verstuurt, nu naar SpawnNado.
update public.yt_publications
set channel_id = (select channel_id from fix_target),
    status = case when youtube_video_id is not null then 'draft' else status end,
    visibility = case when youtube_video_id is not null then 'private' else visibility end,
    publish_at = case when youtube_video_id is not null then null else publish_at end,
    error = case when youtube_video_id is not null then null else error end,
    youtube_video_id = null,
    updated_at = now()
where video_id in (select id from fix_videos);

update public.yt_videos
set status = 'approved', youtube_video_id = null, privacy_status = 'private', published_at = null, scheduled_at = null, updated_at = now()
where id in (select id from fix_videos where youtube_video_id is not null) and status <> 'archived';

alter table public.yt_recordings enable trigger yt_recordings_channel;
alter table public.yt_moments enable trigger yt_moments_channel;
alter table public.yt_videos enable trigger yt_videos_channel;
alter table public.yt_scripts enable trigger yt_scripts_channel;
alter table public.yt_renders enable trigger yt_renders_channel;
alter table public.yt_jobs enable trigger yt_jobs_channel;
alter table public.yt_costs enable trigger yt_costs_channel;
alter table public.yt_publications enable trigger yt_publications_defaults;

-- Wat er verplaatst is. "Verwijder bij KIVOXEL" = die YouTube-video staat nog op het KIVOXEL-kanaal.
select r.label as opname,
       count(v.id) as videos,
       coalesce(string_agg(v.youtube_video_id, ', ') filter (where v.youtube_video_id is not null), '-') as verwijder_bij_kivoxel
from fix_recordings r
left join fix_videos v on v.recording_id = r.id
group by r.label
union all
select '(niets gevonden: alles stond al goed)', 0, '-' where not exists (select 1 from fix_recordings)
order by 1;

commit;

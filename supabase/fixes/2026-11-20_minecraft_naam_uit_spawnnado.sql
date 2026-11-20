-- Reparatie 20-11-2026: Fortnite-, Roblox-, GTA- en CoD-video's op SpawnNado heetten "Minecraft ...".
-- Vervangt het woord Minecraft door de echte game (uit de naam van de opname) in werktitels, scripts (titels, bovenregel,
-- hooks, tekst) en publicaties die nog NIET op YouTube staan. Minecraft-opnames op SpawnNado blijven zoals ze zijn.
-- Veilig om nog eens te draaien: wat al goed is, verandert niet.
begin;

create temp table fix_game on commit drop as
select v.id as video_id,
       case
         when r.label || ' ' || coalesce(r.original_name, '') ~* 'fortnite' then 'Fortnite'
         when r.label || ' ' || coalesce(r.original_name, '') ~* 'roblox' then 'Roblox'
         when r.label || ' ' || coalesce(r.original_name, '') ~* '(\mgta\M|grand theft)' then 'GTA'
         when r.label || ' ' || coalesce(r.original_name, '') ~* '(call of duty|\mcod\M|warzone|black ops|modern warfare)' then 'Call of Duty'
       end as game
from public.yt_videos v
join public.yt_recordings r on r.id = v.recording_id
join public.yt_channels c on c.id = v.channel_id
where (c.slug ~* 'spawn-?nado' or c.name ~* 'spawn-?nado');

delete from fix_game where game is null;

create or replace function pg_temp.fix(t text, g text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(t, '\mMINECRAFT\M', upper(g), 'g'), '\mminecraft\M', lower(g), 'g'), '\mminecraft\M', g, 'gi')
$$;

update public.yt_videos v set title = pg_temp.fix(v.title, f.game)
from fix_game f where f.video_id = v.id and v.title ~* 'minecraft';

update public.yt_scripts s
set titles = pg_temp.fix(s.titles::text, f.game)::jsonb,
    top_line = pg_temp.fix(s.top_line, f.game),
    hook = pg_temp.fix(s.hook, f.game),
    hooks = pg_temp.fix(s.hooks::text, f.game)::jsonb,
    loop_line = pg_temp.fix(s.loop_line, f.game),
    lines = pg_temp.fix(s.lines::text, f.game)::jsonb
from fix_game f
where f.video_id = s.video_id
  and (s.titles::text || coalesce(s.top_line, '') || s.hook || s.hooks::text || coalesce(s.loop_line, '') || s.lines::text) ~* 'minecraft';

update public.yt_publications p
set title = pg_temp.fix(p.title, f.game),
    description = pg_temp.fix(p.description, f.game),
    tags = (select coalesce(array_agg(distinct pg_temp.fix(t, f.game)), '{}') from unnest(p.tags) t),
    updated_at = now()
from fix_game f
where f.video_id = p.video_id and p.youtube_video_id is null
  and (p.title || p.description || array_to_string(p.tags, ',')) ~* 'minecraft';

-- Wat er nog "Minecraft" heeft (zou leeg moeten zijn), en hoeveel video's er per game zijn nagekeken.
select f.game, count(*) as videos_nagekeken,
       count(*) filter (where exists (select 1 from public.yt_scripts s where s.video_id = f.video_id and s.titles::text ~* 'minecraft')) as nog_minecraft
from fix_game f
group by f.game
order by 1;

commit;

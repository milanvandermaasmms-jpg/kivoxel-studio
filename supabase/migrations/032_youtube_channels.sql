-- Familie M&K: YouTube Studio, kanaalbasis (Nexora Media). Nummer 032: de YouTube-lijn gebruikt 030 en hoger.
--
-- Opdracht van Milan (11-11-2026): later meerdere kanalen, vandaag één kanaal goed. Eerste kanaal: PixelRush.
-- * yt_channels: één rij per kanaal, met taal, doelgroep, merkkleur en status. Stem en vervagen kunnen per kanaal
--   afwijken; leeg (null) betekent: de instelling van het gezin in yt_settings geldt. Het maandplafond blijft voor
--   het hele netwerk.
-- * channel_id op opnames, momenten, video's, scripts, renders, stappen en kosten. Een trigger vult hem vanzelf in
--   vanuit de opname of video, dus de werker en het dashboard hoeven nu niets mee te sturen.
-- * Geen dubbele publicatie over kanalen: een opname hoort bij één kanaal, alles wat eruit komt bij hetzelfde kanaal,
--   en een opname of video wisselt nooit van kanaal.
-- * youtube_channel_id komt pas met de koppeling (pakket 56) en is dan uniek over alle kanalen. Alleen de server
--   (service-rol) mag hem invullen.

begin;

create table public.yt_channels (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused', 'planned')),
  language text not null default 'en' check (language in ('en', 'nl')),
  audience text check (length(audience) <= 300),
  brand_color text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Afwijkende instellingen voor dit kanaal; null = die van het gezin.
  voice_name text check (voice_name ~ '^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]{1,60}$'),
  speaking_rate numeric(3, 2) check (speaking_rate between 0.75 and 1.50),
  game_volume numeric(3, 2) check (game_volume between 0 and 1),
  privacy_regions jsonb check (privacy_regions is null or public.yt_valid_regions(privacy_regions)),
  -- Pakket 56: de koppeling met YouTube.
  youtube_channel_id text check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  made_for_kids boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, id),
  unique (studio_id, name)
);
create unique index yt_channels_one_default_idx on public.yt_channels (studio_id) where is_default;
create unique index yt_channels_youtube_idx on public.yt_channels (youtube_channel_id) where youtube_channel_id is not null;
create trigger yt_channels_updated_at before update on public.yt_channels for each row execute function public.set_updated_at();

-- Eén kanaal voor elk gezin dat YouTube Studio al gebruikt: PixelRush (naam van Milan), Engels zoals de scripts.
insert into public.yt_channels (studio_id, name, is_default)
select h.studio_id, 'PixelRush', true
from (
  select studio_id from public.yt_settings
  union select studio_id from public.yt_recordings
) h;

alter table public.yt_recordings add column channel_id uuid;
alter table public.yt_moments add column channel_id uuid;
alter table public.yt_videos add column channel_id uuid;
alter table public.yt_scripts add column channel_id uuid;
alter table public.yt_renders add column channel_id uuid;
alter table public.yt_jobs add column channel_id uuid;
alter table public.yt_costs add column channel_id uuid;

update public.yt_recordings r set channel_id = c.id from public.yt_channels c where c.studio_id = r.studio_id and c.is_default;
update public.yt_moments m set channel_id = r.channel_id from public.yt_recordings r where r.id = m.recording_id;
update public.yt_videos v set channel_id = r.channel_id from public.yt_recordings r where r.id = v.recording_id;
update public.yt_videos v set channel_id = c.id from public.yt_channels c where v.channel_id is null and c.studio_id = v.studio_id and c.is_default;
update public.yt_scripts s set channel_id = v.channel_id from public.yt_videos v where v.id = s.video_id;
update public.yt_renders x set channel_id = v.channel_id from public.yt_videos v where v.id = x.video_id;
update public.yt_jobs j set channel_id = coalesce((select channel_id from public.yt_videos where id = j.video_id), (select channel_id from public.yt_recordings where id = j.recording_id));
update public.yt_costs k set channel_id = coalesce((select channel_id from public.yt_jobs where id = k.job_id), (select channel_id from public.yt_videos where id = k.video_id));

alter table public.yt_recordings alter column channel_id set not null,
  add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
alter table public.yt_moments alter column channel_id set not null,
  add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
alter table public.yt_videos alter column channel_id set not null,
  add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
alter table public.yt_scripts alter column channel_id set not null,
  add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
alter table public.yt_renders alter column channel_id set not null,
  add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
-- Stappen en kosten kunnen bij het hele netwerk horen (zonder opname of video); dan blijft het kanaal leeg.
alter table public.yt_jobs add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);
alter table public.yt_costs add foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id);

create index yt_recordings_channel_idx on public.yt_recordings (channel_id);
create index yt_videos_channel_idx on public.yt_videos (channel_id);
create index yt_costs_channel_idx on public.yt_costs (channel_id, incurred_on);

-- Het standaardkanaal van een gezin; maakt er een aan als het gezin nog geen kanaal heeft.
create function public.yt_default_channel(p_studio uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v uuid;
begin
  select id into v from public.yt_channels where studio_id = p_studio and is_default;
  if v is null then
    insert into public.yt_channels (studio_id, name, is_default) values (p_studio, 'Eerste kanaal', true)
    on conflict do nothing returning id into v;
    if v is null then
      select id into v from public.yt_channels where studio_id = p_studio and is_default;
    end if;
  end if;
  return v;
end;
$$;
revoke execute on function public.yt_default_channel(uuid) from public, anon, authenticated;

-- Vult channel_id in vanuit de bovenliggende rij en weigert een ander kanaal dan dat van de opname of video.
create function public.yt_set_channel() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent uuid;
begin
  if tg_op = 'UPDATE' then
    if new.channel_id is distinct from old.channel_id then
      raise exception 'Een % wisselt niet van kanaal', tg_table_name;
    end if;
    return new;
  end if;
  if tg_table_name = 'yt_recordings' then
    v_parent := coalesce(new.channel_id, public.yt_default_channel(new.studio_id));
  elsif tg_table_name = 'yt_moments' then
    select channel_id into v_parent from public.yt_recordings where id = new.recording_id;
  elsif tg_table_name = 'yt_videos' then
    if new.recording_id is not null then
      select channel_id into v_parent from public.yt_recordings where id = new.recording_id;
    else
      v_parent := coalesce(new.channel_id, public.yt_default_channel(new.studio_id));
    end if;
  elsif tg_table_name in ('yt_scripts', 'yt_renders') then
    select channel_id into v_parent from public.yt_videos where id = new.video_id;
  elsif tg_table_name = 'yt_jobs' then
    if new.video_id is not null then
      select channel_id into v_parent from public.yt_videos where id = new.video_id;
    elsif new.recording_id is not null then
      select channel_id into v_parent from public.yt_recordings where id = new.recording_id;
    else
      v_parent := new.channel_id;
    end if;
  elsif tg_table_name = 'yt_costs' then
    if new.job_id is not null then
      select channel_id into v_parent from public.yt_jobs where id = new.job_id;
    elsif new.video_id is not null then
      select channel_id into v_parent from public.yt_videos where id = new.video_id;
    else
      v_parent := new.channel_id;
    end if;
  end if;
  if new.channel_id is not null and v_parent is not null and new.channel_id <> v_parent then
    raise exception 'Dit hoort bij een ander kanaal';
  end if;
  new.channel_id := coalesce(v_parent, new.channel_id);
  return new;
end;
$$;

create trigger yt_recordings_channel before insert or update of channel_id on public.yt_recordings for each row execute function public.yt_set_channel();
create trigger yt_moments_channel before insert or update of channel_id on public.yt_moments for each row execute function public.yt_set_channel();
create trigger yt_videos_channel before insert or update of channel_id on public.yt_videos for each row execute function public.yt_set_channel();
create trigger yt_scripts_channel before insert or update of channel_id on public.yt_scripts for each row execute function public.yt_set_channel();
create trigger yt_renders_channel before insert or update of channel_id on public.yt_renders for each row execute function public.yt_set_channel();
create trigger yt_jobs_channel before insert or update of channel_id on public.yt_jobs for each row execute function public.yt_set_channel();
create trigger yt_costs_channel before insert or update of channel_id on public.yt_costs for each row execute function public.yt_set_channel();

alter table public.yt_channels enable row level security;
create policy "Beheerders zien kanalen" on public.yt_channels for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders maken kanalen" on public.yt_channels for insert to authenticated with check (public.is_studio_admin(studio_id) and youtube_channel_id is null);
create policy "Beheerders wijzigen kanalen" on public.yt_channels for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));

revoke all on public.yt_channels from anon, authenticated;
grant select on public.yt_channels to authenticated;
grant insert (studio_id, name, status, language, audience, brand_color) on public.yt_channels to authenticated;
-- Niet: youtube_channel_id en is_default (alleen de server); verwijderen kan niet vanuit het dashboard.
grant update (name, status, language, audience, brand_color, voice_name, speaking_rate, game_volume, privacy_regions, made_for_kids) on public.yt_channels to authenticated;
grant select, insert, update, delete on public.yt_channels to service_role;

commit;

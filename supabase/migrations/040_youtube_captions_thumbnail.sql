-- Familie M&K: YouTube Studio, ondertitels en thumbnail (Kivoxel Studio 2.2, fase D4b). Nummer 040: YouTube-lijn.
--
-- * captions_enabled: de ondertitels ook als apart spoor naar YouTube sturen (captions.insert, 400 eenheden).
--   Standaard aan; Milan kan het per video uitzetten.
-- * thumbnail_ms: het beeld uit de montage dat de thumbnail wordt (in milliseconden); leeg = YouTube kiest zelf.
-- * captions_status en thumbnail_status: wat de werker meldt (klaar of de reden waarom niet). Alleen de werker.
-- * request_yt_extras: de knop "Ondertitels en thumbnail naar YouTube" voor een video die al op YouTube staat.
--   Wijzigt de zichtbaarheid niet. Ook voor testvideo's (die blijven privé).
-- * Alleen kolommen en een functie erbij; er wordt niets verwijderd. Terugdraaien:
--   drop function public.request_yt_extras(uuid, boolean, integer);
--   alter table public.yt_publications drop column thumbnail_status, drop column captions_status,
--     drop column thumbnail_ms, drop column captions_enabled;

begin;

alter table public.yt_publications
  add column captions_enabled boolean not null default true,
  add column thumbnail_ms integer check (thumbnail_ms between 0 and 86400000),
  add column captions_status text check (length(captions_status) <= 300),
  add column thumbnail_status text check (length(thumbnail_status) <= 300);

grant insert (captions_enabled, thumbnail_ms) on public.yt_publications to authenticated;
grant update (captions_enabled, thumbnail_ms) on public.yt_publications to authenticated;

create function public.request_yt_extras(p_publication uuid, p_captions boolean, p_thumbnail_ms integer) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p public.yt_publications;
  v_job uuid;
  v_count integer;
begin
  select * into p from public.yt_publications where id = p_publication for update;
  if p.id is null or not public.is_studio_admin(p.studio_id) then
    raise exception 'Publicatie niet gevonden';
  end if;
  if p.youtube_video_id is null then
    raise exception 'Deze video staat nog niet op YouTube';
  end if;
  if p.status not in ('uploaded', 'scheduled', 'published', 'failed') then
    raise exception 'Wacht tot YouTube klaar is met de vorige stap';
  end if;
  if p_thumbnail_ms is not null and (p_thumbnail_ms < 0 or p_thumbnail_ms > 86400000) then
    raise exception 'Ongeldig moment voor de thumbnail';
  end if;
  if not coalesce(p_captions, false) and p_thumbnail_ms is null then
    raise exception 'Kies ondertitels, een thumbnail of allebei';
  end if;

  select count(*) into v_count from public.yt_jobs where studio_id = p.studio_id and step = 'publish' and payload ->> 'publication_id' = p.id::text;
  insert into public.yt_jobs (studio_id, video_id, step, idempotency_key, payload, max_attempts)
  values (p.studio_id, p.video_id, 'publish', 'publish:' || p.id || ':' || (v_count + 1), jsonb_build_object('publication_id', p.id, 'action', 'extras'), 3)
  returning id into v_job;
  -- Een nieuwe vraag om ondertitels wist de oude melding; een al geplaatst spoor wordt niet nog eens gestuurd.
  update public.yt_publications
  set status = 'queued', error = null, captions_enabled = coalesce(p_captions, false), thumbnail_ms = p_thumbnail_ms,
      captions_status = case when coalesce(p_captions, false) and coalesce(captions_status, '') not like 'Klaar%' then null else captions_status end,
      thumbnail_status = case when p_thumbnail_ms is not null then null else thumbnail_status end
  where id = p.id;
  return v_job;
end;
$$;
revoke execute on function public.request_yt_extras(uuid, boolean, integer) from public, anon;
grant execute on function public.request_yt_extras(uuid, boolean, integer) to authenticated;

commit;

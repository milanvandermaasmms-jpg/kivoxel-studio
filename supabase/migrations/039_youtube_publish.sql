-- Familie M&K: YouTube Studio, inplannen en publiceren (Kivoxel Studio 2.2, fase D4). Nummer 039: YouTube-lijn.
--
-- * request_yt_publish(publicatie, actie, tijdstip, zichtbaarheid): de knoppen "Privé uploaden", "Inplannen" en
--   "Nu publiceren". Elke actie is een bewuste klik van een beheerder; de database controleert alles opnieuw.
--   - private:  privé, zonder tijdstip;
--   - schedule: privé met een tijdstip, minstens 15 minuten en hoogstens een jaar vooruit (YouTube zet hem zelf openbaar);
--   - publish:  meteen openbaar of verborgen (alleen met link).
--   Staat de video nog niet op YouTube, dan komt er een uploadstap; staat hij er al (bijvoorbeeld eerst privé
--   geüpload), dan een stap die alleen de zichtbaarheid bij YouTube bijwerkt.
-- * Testvideo's worden nooit openbaar of ingepland (2.2, hoofdstuk 23): alleen privé.
-- * request_yt_upload (038) blijft werken en doet hetzelfde als de actie private.
-- * Een mislukte of geannuleerde stap voor de zichtbaarheid zet de publicatie op "mislukt" met de reden; de video
--   op YouTube blijft zoals hij was.
-- * Er wordt niets verwijderd. Terugdraaien: drop function public.request_yt_publish(uuid, text, timestamptz, text);
--   en yt_upload_outcome en request_yt_upload terugzetten zoals in 038.

begin;

create function public.request_yt_publish(p_publication uuid, p_action text, p_publish_at timestamptz default null, p_visibility text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  p public.yt_publications;
  v_job uuid;
  v_count integer;
  v_step text;
  v_visibility text;
  v_publish_at timestamptz;
begin
  select * into p from public.yt_publications where id = p_publication for update;
  if p.id is null or not public.is_studio_admin(p.studio_id) then
    raise exception 'Publicatie niet gevonden';
  end if;
  if p_action not in ('private', 'schedule', 'publish') then
    raise exception 'Onbekende actie';
  end if;
  if p.is_test and p_action <> 'private' then
    raise exception 'Een testvideo wordt nooit openbaar of ingepland; alleen privé';
  end if;
  if length(trim(p.title)) = 0 or p.made_for_kids is null or p.contains_synthetic_media is null or p.render_id is null then
    raise exception 'Vul eerst titel, doelgroep en AI-melding in, en sla het concept op';
  end if;
  if not exists (select 1 from public.yt_videos where id = p.video_id and status in ('approved', 'scheduled', 'published')) then
    raise exception 'Keur de video eerst goed in de controle';
  end if;

  if p_action = 'private' then
    v_visibility := 'private';
    v_publish_at := null;
  elsif p_action = 'schedule' then
    if p_publish_at is null or p_publish_at < now() + interval '15 minutes' or p_publish_at > now() + interval '1 year' then
      raise exception 'Kies een moment minstens een kwartier en hoogstens een jaar vooruit';
    end if;
    v_visibility := 'private';
    v_publish_at := p_publish_at;
  else
    if coalesce(p_visibility, '') not in ('public', 'unlisted') then
      raise exception 'Kies openbaar of verborgen';
    end if;
    v_visibility := p_visibility;
    v_publish_at := null;
  end if;

  if p.youtube_video_id is null then
    if p.status not in ('draft', 'failed') then
      raise exception 'Deze publicatie is al onderweg naar YouTube';
    end if;
    v_step := 'upload';
  else
    if p.status not in ('uploaded', 'scheduled', 'published', 'failed') then
      raise exception 'Wacht tot YouTube klaar is met de vorige stap';
    end if;
    v_step := 'publish';
  end if;

  select count(*) into v_count from public.yt_jobs where studio_id = p.studio_id and step = v_step and payload ->> 'publication_id' = p.id::text;
  insert into public.yt_jobs (studio_id, video_id, step, idempotency_key, payload, max_attempts)
  values (p.studio_id, p.video_id, v_step, v_step || ':' || p.id || ':' || (v_count + 1), jsonb_build_object('publication_id', p.id, 'action', p_action), 5)
  returning id into v_job;
  update public.yt_publications set status = 'queued', error = null, visibility = v_visibility, publish_at = v_publish_at where id = p.id;
  return v_job;
end;
$$;
revoke execute on function public.request_yt_publish(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.request_yt_publish(uuid, text, timestamptz, text) to authenticated;

-- Oude knop (038) blijft werken.
create or replace function public.request_yt_upload(p_publication uuid) returns uuid
language sql security definer set search_path = ''
as $$ select public.request_yt_publish(p_publication, 'private', null, null) $$;

-- Ook een mislukte stap voor de zichtbaarheid maakt de publicatie weer bruikbaar, met de reden.
create or replace function public.yt_upload_outcome() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'failed') and old.status is distinct from new.status then
    if new.step = 'upload' then
      update public.yt_publications
      set status = 'failed', error = left(coalesce(new.error, 'Geannuleerd'), 500)
      where id = (new.payload ->> 'publication_id')::uuid and studio_id = new.studio_id and status in ('queued', 'uploading') and youtube_video_id is null;
    elsif new.step = 'publish' then
      update public.yt_publications
      set status = 'failed', error = left(coalesce(new.error, 'Geannuleerd'), 500)
      where id = (new.payload ->> 'publication_id')::uuid and studio_id = new.studio_id and status = 'queued';
    end if;
  end if;
  return new;
end;
$$;

commit;

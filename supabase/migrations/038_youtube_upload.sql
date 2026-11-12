-- Familie M&K: YouTube Studio, privé uploaden (Kivoxel Studio 2.2, fase D3). Nummer 038: YouTube-lijn.
--
-- * request_yt_upload: de knop "Privé uploaden". Alleen een beheerder, alleen een concept (of een mislukte poging)
--   zonder YouTube-video, en alleen als titel, doelgroep, AI-melding en montage zijn ingevuld. Deze stap uploadt
--   alleen privé; met een publicatiemoment of een andere zichtbaarheid weigert hij (dat komt in D4).
--   De functie zet de publicatie op "wacht op upload" en zet één uploadstap klaar voor de werker.
-- * Een uploadstap die geannuleerd wordt of definitief mislukt, zet de publicatie op "mislukt" met de reden,
--   zodat het concept weer te wijzigen is en niet blijft hangen.
-- * Alleen nieuwe functies en een trigger; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   drop trigger yt_jobs_upload_outcome on public.yt_jobs; drop function public.yt_upload_outcome();
--   drop function public.request_yt_upload(uuid);

begin;

create function public.request_yt_upload(p_publication uuid) returns uuid
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
  if p.youtube_video_id is not null then
    raise exception 'Deze video staat al op YouTube';
  end if;
  if p.status not in ('draft', 'failed') then
    raise exception 'Deze publicatie is al onderweg naar YouTube';
  end if;
  if length(trim(p.title)) = 0 or p.made_for_kids is null or p.contains_synthetic_media is null or p.render_id is null then
    raise exception 'Vul eerst titel, doelgroep en AI-melding in, en sla het concept op';
  end if;
  if p.visibility <> 'private' or p.publish_at is not null then
    raise exception 'Nu kan alleen privé uploaden: zet de zichtbaarheid op Privé en maak het tijdstip leeg (inplannen komt later)';
  end if;
  if not exists (select 1 from public.yt_videos where id = p.video_id and status in ('approved', 'scheduled', 'published')) then
    raise exception 'Keur de video eerst goed in de controle';
  end if;

  select count(*) into v_count from public.yt_jobs where studio_id = p.studio_id and step = 'upload' and payload ->> 'publication_id' = p.id::text;
  insert into public.yt_jobs (studio_id, video_id, step, idempotency_key, payload, max_attempts)
  values (p.studio_id, p.video_id, 'upload', 'upload:' || p.id || ':' || (v_count + 1), jsonb_build_object('publication_id', p.id), 5)
  returning id into v_job;
  update public.yt_publications set status = 'queued', error = null where id = p.id;
  return v_job;
end;
$$;
revoke execute on function public.request_yt_upload(uuid) from public, anon;
grant execute on function public.request_yt_upload(uuid) to authenticated;

-- Een geannuleerde of definitief mislukte uploadstap: de publicatie wordt weer te wijzigen, met de reden erbij.
create function public.yt_upload_outcome() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.step = 'upload' and new.status in ('cancelled', 'failed') and old.status is distinct from new.status then
    update public.yt_publications
    set status = 'failed', error = left(coalesce(new.error, 'Geannuleerd'), 500)
    where id = (new.payload ->> 'publication_id')::uuid and studio_id = new.studio_id and status in ('queued', 'uploading') and youtube_video_id is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.yt_upload_outcome() from public, anon, authenticated;
create trigger yt_jobs_upload_outcome after update of status on public.yt_jobs for each row execute function public.yt_upload_outcome();

commit;

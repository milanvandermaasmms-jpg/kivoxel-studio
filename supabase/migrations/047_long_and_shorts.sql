-- KIVOXEL Studio: lange video + Shorts, 3 titels, 3 thumbnails en Keur 1 (multi-kanaal-Studio, fase C).
--
-- * yt_scripts.titles: 3 titelvarianten van Gemini (zoekwoord, nieuwsgierigheid, uitdaging/getal), in dezelfde
--   aanroep als het script, dus zonder extra kosten. Alleen de werker schrijft ze.
-- * yt_scripts.feedback: de opmerking van Milan waarmee deze versie is gemaakt ("hook sneller").
-- * yt_renders.thumbnails: de thumbnails die de werker na de montage met FFmpeg maakt (3 bij een lange video,
--   1 cover bij een Short), als lijst van {file, key, label, text, at_ms}. Alleen de werker schrijft ze.
-- * Keur 1 automatisch: staat bij een kanaal concept_auto_approve aan (standaard uit), dan keurt de database een
--   nieuw concept meteen goed en zet de montage klaar. Alleen als de video nog geen goedgekeurd script heeft en het
--   script geen privé-woord, verboden woord of persoonsgegevens bevat; anders blijft het concept voor Milan staan.
-- * Terugdraaien: drop trigger yt_scripts_auto_approve on public.yt_scripts; drop function public.yt_scripts_auto_approve();
--   alter table public.yt_scripts drop column titles, drop column feedback; alter table public.yt_renders drop column thumbnails;

begin;

alter table public.yt_scripts
  add column titles jsonb not null default '[]'::jsonb check (jsonb_typeof(titles) = 'array' and jsonb_array_length(titles) <= 3),
  add column feedback text check (length(feedback) <= 500);
alter table public.yt_renders
  add column thumbnails jsonb not null default '[]'::jsonb check (jsonb_typeof(thumbnails) = 'array' and jsonb_array_length(thumbnails) <= 3);

create function public.yt_scripts_auto_approve() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v public.yt_videos;
  v_text text;
begin
  if new.status <> 'draft' then
    return null;
  end if;
  select * into v from public.yt_videos where id = new.video_id;
  if v.id is null or v.status not in ('idea', 'scripted') then
    return null;
  end if;
  if not coalesce((select concept_auto_approve from public.yt_channels where id = v.channel_id), false) then
    return null;
  end if;
  if exists (select 1 from public.yt_scripts where video_id = v.id and status = 'approved') then
    return null;
  end if;
  v_text := concat_ws(' ', new.top_line, new.hook, new.loop_line,
    (select string_agg(l ->> 'text', ' ') from jsonb_array_elements(new.lines) l),
    (select string_agg(concat_ws(' ', h ->> 'first_line', h ->> 'overlay'), ' ') from jsonb_array_elements(new.hooks) h));
  if public.yt_term_hit(v_text, (select private_terms from public.yt_settings where studio_id = v.studio_id)) is not null
    or public.yt_term_hit(v_text, (select banned_words from public.yt_channels where id = v.channel_id)) is not null
    or public.yt_personal_data(v_text) is not null then
    return null;
  end if;
  update public.yt_scripts set status = 'approved' where id = new.id;
  insert into public.yt_jobs (studio_id, video_id, step, idempotency_key, payload)
  values (v.studio_id, v.id, 'render', 'render:' || new.id || ':1', jsonb_build_object('script_id', new.id))
  on conflict do nothing;
  update public.yt_videos set status = 'rendering' where id = v.id and status in ('idea', 'scripted');
  return null;
end;
$$;
create trigger yt_scripts_auto_approve after insert on public.yt_scripts for each row execute function public.yt_scripts_auto_approve();
revoke execute on function public.yt_scripts_auto_approve() from public, anon, authenticated;

commit;

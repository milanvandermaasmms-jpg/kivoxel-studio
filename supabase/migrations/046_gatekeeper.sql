-- KIVOXEL Studio: Poortwachter (multi-kanaal-Studio, fase B). Zie docs/studio-multikanaal-plan.md.
--
-- Harde controles in de database, niet alleen in de app. Het dashboard toont dezelfde regels als checklist.
-- * yt_settings.private_terms: woorden die nooit in een script, titel, beschrijving of tag mogen staan, zoals
--   namen van de kinderen, school, woonplaats en gamertags. Milan vult ze zelf in; alleen beheerders zien ze.
-- * Goedkeuren van een montage (status approved) lukt niet als het goedgekeurde script een privé-woord, een
--   verboden woord van het kanaal of een e-mailadres/telefoonnummer bevat, als er een gezicht in beeld is, of als
--   een gamertag/chat/melding niet vervaagd of een stem niet gedempt is.
-- * Een upload- of publicatiestap naar YouTube lukt alleen als ook titel, beschrijving en tags schoon zijn,
--   Made for Kids en de AI-melding passen bij het kanaal, er bij een slaapkanaal een volumetip in de beschrijving
--   staat en "Lumi" nooit zonder "Dreamnest" in de titel staat.
-- * Alleen nieuwe functies, triggers en één kolom. Terugdraaien:
--   drop trigger yt_jobs_gate on public.yt_jobs; drop trigger yt_videos_gate on public.yt_videos;
--   drop function public.yt_jobs_gate(), public.yt_videos_gate(), public.yt_publication_gate_problems(uuid),
--   public.yt_video_gate_problems(uuid, uuid), public.yt_personal_data(text), public.yt_term_hit(text, text[]);
--   alter table public.yt_settings drop column private_terms;

begin;

alter table public.yt_settings
  add column private_terms text[] not null default '{}' check (cardinality(private_terms) <= 200 and length(array_to_string(private_terms, '|')) <= 4000);

-- Het eerste woord uit de lijst dat als heel woord in de tekst staat (hoofdletters maken niet uit), of null.
create function public.yt_term_hit(p_text text, p_terms text[]) returns text
language sql immutable set search_path = ''
as $$
  select t from unnest(coalesce(p_terms, '{}')) t
  where length(trim(t)) >= 2
    and coalesce(p_text, '') ~* ('(^|[^[:alnum:]])' || regexp_replace(trim(t), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^[:alnum:]]|$)')
  limit 1
$$;

-- Een e-mailadres of Nederlands telefoonnummer in de tekst, of null.
create function public.yt_personal_data(p_text text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(p_text, '') ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' then 'een e-mailadres'
    when coalesce(p_text, '') ~ '(\+31|0031|(^|[^0-9])0)[ .-]?[1-9]([ .-]?[0-9]){8}([^0-9]|$)' then 'een telefoonnummer'
  end
$$;

-- Wat het goedkeuren of uploaden van een video tegenhoudt. p_render: de montage die geüpload wordt; null = de nieuwste.
create function public.yt_video_gate_problems(p_video uuid, p_render uuid default null) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.yt_videos;
  v_text text;
  v_hit text;
  v_flags text[];
  r public.yt_renders;
  v_out text[] := '{}';
begin
  select * into v from public.yt_videos where id = p_video;
  if v.id is null then
    return v_out;
  end if;

  select concat_ws(' ', s.top_line, s.hook, s.loop_line,
           (select string_agg(l ->> 'text', ' ') from jsonb_array_elements(s.lines) l),
           (select string_agg(concat_ws(' ', h ->> 'first_line', h ->> 'overlay'), ' ') from jsonb_array_elements(s.hooks) h))
  into v_text
  from public.yt_scripts s where s.video_id = v.id and s.status = 'approved'
  order by s.version desc limit 1;

  v_hit := public.yt_term_hit(v_text, (select private_terms from public.yt_settings where studio_id = v.studio_id));
  if v_hit is not null then
    v_out := v_out || format('Het script noemt een privé-woord ("%s").', v_hit);
  end if;
  v_hit := public.yt_term_hit(v_text, (select banned_words from public.yt_channels where id = v.channel_id));
  if v_hit is not null then
    v_out := v_out || format('Het script bevat het verboden woord "%s".', v_hit);
  end if;
  v_hit := public.yt_personal_data(v_text);
  if v_hit is not null then
    v_out := v_out || format('Het script bevat %s.', v_hit);
  end if;

  select coalesce(array_agg(distinct f), '{}') into v_flags
  from public.yt_video_moments vm join public.yt_moments m on m.id = vm.moment_id, unnest(m.privacy_flags) f
  where vm.video_id = v.id;
  if 'face' = any (v_flags) then
    v_out := v_out || 'Er is een gezicht in beeld.'::text;
  end if;
  if p_render is not null then
    select * into r from public.yt_renders where id = p_render;
  else
    select * into r from public.yt_renders where video_id = v.id order by created_at desc limit 1;
  end if;
  if r.id is not null then
    if v_flags && array['gamertag', 'chat', 'notification'] and not r.privacy_blur then
      v_out := v_out || 'Een gamertag, chat of melding is niet vervaagd.'::text;
    end if;
    if 'voice' = any (v_flags) and not r.game_muted then
      v_out := v_out || 'Een stem is niet gedempt.'::text;
    end if;
  end if;
  return v_out;
end;
$$;

-- Wat een upload of publicatie naar YouTube tegenhoudt.
create function public.yt_publication_gate_problems(p_publication uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  p public.yt_publications;
  c public.yt_channels;
  v_text text;
  v_hit text;
  v_out text[];
begin
  select * into p from public.yt_publications where id = p_publication;
  if p.id is null then
    return '{}';
  end if;
  select * into c from public.yt_channels where id = p.channel_id;
  v_out := public.yt_video_gate_problems(p.video_id, p.render_id);
  v_text := concat_ws(' ', p.title, p.description, array_to_string(p.tags, ' '));

  v_hit := public.yt_term_hit(v_text, (select private_terms from public.yt_settings where studio_id = p.studio_id));
  if v_hit is not null then
    v_out := v_out || format('Titel, beschrijving of tags noemen een privé-woord ("%s").', v_hit);
  end if;
  v_hit := public.yt_term_hit(v_text, c.banned_words);
  if v_hit is not null then
    v_out := v_out || format('Titel, beschrijving of tags bevatten het verboden woord "%s".', v_hit);
  end if;
  v_hit := public.yt_personal_data(v_text);
  if v_hit is not null then
    v_out := v_out || format('Titel, beschrijving of tags bevatten %s.', v_hit);
  end if;
  if c.synthetic_media and p.contains_synthetic_media is not true then
    v_out := v_out || 'Dit kanaal gebruikt AI-beeld of AI-muziek: zet de AI-melding aan.'::text;
  end if;
  if c.safety_profile = 'infant_sleep' then
    if p.made_for_kids is not true then
      v_out := v_out || 'Een slaapvideo voor baby''s is altijd Made for Kids.'::text;
    end if;
    if p.description !~* '2[ ]?(m|meter)' then
      v_out := v_out || 'Zet de volumetip in de beschrijving (apparaat minstens 2 meter van het bedje, volume laag).'::text;
    end if;
  end if;
  if p.title ~* '(^|[^[:alnum:]])lumi([^[:alnum:]]|$)' and p.title !~* 'dreamnest' then
    v_out := v_out || 'Noem Lumi in de titel altijd samen met Dreamnest ("Lumi van Dreamnest").'::text;
  end if;
  return v_out;
end;
$$;

create function public.yt_jobs_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_problems text[];
begin
  if new.step in ('upload', 'publish') and new.payload ? 'publication_id' then
    v_problems := public.yt_publication_gate_problems((new.payload ->> 'publication_id')::uuid);
    if cardinality(v_problems) > 0 then
      raise exception 'Poortwachter: %', array_to_string(v_problems, ' ');
    end if;
  end if;
  return new;
end;
$$;
create trigger yt_jobs_gate before insert on public.yt_jobs for each row execute function public.yt_jobs_gate();

create function public.yt_videos_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_problems text[];
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    v_problems := public.yt_video_gate_problems(new.id, null);
    if cardinality(v_problems) > 0 then
      raise exception 'Poortwachter: %', array_to_string(v_problems, ' ');
    end if;
  end if;
  return new;
end;
$$;
create trigger yt_videos_gate before update of status on public.yt_videos for each row execute function public.yt_videos_gate();

revoke execute on function public.yt_video_gate_problems(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.yt_publication_gate_problems(uuid) from public, anon, authenticated;
revoke execute on function public.yt_jobs_gate() from public, anon, authenticated;
revoke execute on function public.yt_videos_gate() from public, anon, authenticated;

commit;

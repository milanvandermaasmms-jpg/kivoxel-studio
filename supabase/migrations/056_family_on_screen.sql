-- KIVOXEL Studio: gezicht, stem en gamertag van de kinderen mogen in beeld (besluit Milan, 16-11-2026).
--
-- * De Poortwachter houdt een video niet meer tegen om een gezicht in beeld, een hoorbare stem of een
--   gamertag. Chat en meldingen (berichten van anderen) moeten nog steeds vervaagd zijn; privé-woorden
--   (echte namen, school, woonplaats), e-mailadressen en telefoonnummers blijven geblokkeerd.
-- * Het gamegeluid gaat niet meer vanzelf uit bij een stem (mute_flagged_voice standaard uit); vervagen van de
--   vaste PS5-hoeken blijft een schakelaar die Milan zelf aan of uit zet.
-- * Terugdraaien: voer de functie yt_video_gate_problems uit 046_gatekeeper.sql opnieuw uit en
--   alter table public.yt_settings alter column mute_flagged_voice set default true;

begin;

alter table public.yt_settings alter column mute_flagged_voice set default false;
update public.yt_settings set mute_flagged_voice = false;

create or replace function public.yt_video_gate_problems(p_video uuid, p_render uuid default null) returns text[]
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
  if p_render is not null then
    select * into r from public.yt_renders where id = p_render;
  else
    select * into r from public.yt_renders where video_id = v.id order by created_at desc limit 1;
  end if;
  if r.id is not null and v_flags && array['chat', 'notification'] and not r.privacy_blur then
    v_out := v_out || 'Een chat of melding is niet vervaagd.'::text;
  end if;
  return v_out;
end;
$$;

commit;

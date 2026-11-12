-- Familie M&K: YouTube Studio, vervagen en dempen (Viral Engine fase 1, stap 1.5). Nummer 031: de YouTube-lijn
-- gebruikt 030 en hoger (zie docs/taakverdeling.md).
--
-- Keuze van Milan (11-11-2026): vaste PS5-hoeken vervagen in plaats van posities per beeld via Gemini.
-- * yt_settings.privacy_regions: de vlakken die in elke montage vervaagd worden, als delen van het beeld (0 tot 1).
--   Voorstel: linksboven (chat van Minecraft Bedrock) en rechtsboven (meldingen van de PS5). Milan controleert ze
--   in de preview en past ze aan in het dashboard.
-- * yt_settings.mute_flagged_voice: bij een moment met een stemvlag gaat het gamegeluid in die montage helemaal uit.
-- * yt_renders.privacy_blur en game_muted: of een montage met die bescherming is gemaakt. Zonder die vlag kan een
--   video met een privacyvlag niet worden goedgekeurd.
-- * yt_videos.review_note: de reden van een afkeuring na de preview.
-- * mark_yt_recording_real: "Is dit toch echte gameplay?" in één transactie, zodat een opname nooit half omgezet blijft.

begin;

alter table public.yt_settings
  add column privacy_blur boolean not null default true,
  add column privacy_regions jsonb not null default '[{"x":0,"y":0,"w":0.38,"h":0.3},{"x":0.7,"y":0,"w":0.3,"h":0.18}]'::jsonb,
  add column mute_flagged_voice boolean not null default true;

-- Hoogstens 6 vlakken, elk binnen het beeld en niet kleiner dan 8% (anders werkt de vervaging niet goed).
create function public.yt_valid_regions(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 6
    and not exists (
      select 1 from jsonb_array_elements(p) r
      where jsonb_typeof(r) <> 'object'
        or jsonb_typeof(r->'x') <> 'number' or jsonb_typeof(r->'y') <> 'number'
        or jsonb_typeof(r->'w') <> 'number' or jsonb_typeof(r->'h') <> 'number'
        or (r->>'x')::numeric < 0 or (r->>'y')::numeric < 0
        or (r->>'w')::numeric < 0.08 or (r->>'h')::numeric < 0.08
        or (r->>'x')::numeric + (r->>'w')::numeric > 1.0001
        or (r->>'y')::numeric + (r->>'h')::numeric > 1.0001
    )
$$;
alter table public.yt_settings add constraint yt_settings_privacy_regions_valid check (public.yt_valid_regions(privacy_regions));

alter table public.yt_renders
  add column privacy_blur boolean not null default false,
  add column game_muted boolean not null default false;

alter table public.yt_videos add column review_note text check (length(review_note) <= 500);

-- Draait met de rechten van wie hem aanroept: RLS bepaalt dus nog steeds dat alleen een beheerder dit kan.
create function public.mark_yt_recording_real(p_recording uuid, p_label text) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_studio uuid;
begin
  if p_label is null or length(trim(p_label)) not between 1 and 200 or trim(p_label) ~* '^testdata' then
    raise exception 'Geef de opname een naam zonder "testdata"';
  end if;
  update public.yt_recordings set label = trim(p_label), is_test = false where id = p_recording returning studio_id into v_studio;
  if v_studio is null then
    raise exception 'Opname niet gevonden';
  end if;
  delete from public.yt_videos where recording_id = p_recording and is_test;
  delete from public.yt_moments where recording_id = p_recording and source = 'test';
  insert into public.yt_jobs (studio_id, recording_id, step, idempotency_key)
  values (v_studio, p_recording, 'analyse', 'analyse:' || p_recording || ':real')
  on conflict do nothing;
end;
$$;
revoke execute on function public.mark_yt_recording_real(uuid, text) from public, anon;
grant execute on function public.mark_yt_recording_real(uuid, text) to authenticated;

commit;

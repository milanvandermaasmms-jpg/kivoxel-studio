-- KIVOXEL Studio: kanaalprofielen (multi-kanaal-Studio, fase A). Zie docs/studio-multikanaal-plan.md.
--
-- Besluit van Milan (13-11-2026): verder op het eigen project en de bestaande yt_channels, geen apart schema.
-- * Elk kanaal krijgt een profiel: korte naam (slug, ook de map channels/<slug>/), werkwijze (upload, genereren of
--   allebei), veiligheidsprofiel, verboden woorden, AI-label, vaste publicatietijden en of het concept (Keur 1)
--   vanzelf door mag (standaard uit; werkt vanaf fase C).
-- * providers: welke diensten het kanaal gebruikt. Standaard alleen Gemini en de Google-stem; muziek en video staan
--   uit. Alleen de server mag dit wijzigen: een betaalde dienst komt er pas na akkoord en budget van Milan.
-- * Dreamnest NL komt erbij als gepland kanaal (nog geen opnames, nog geen YouTube-koppeling).

begin;

alter table public.yt_channels
  add column slug text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  add column mode text not null default 'upload' check (mode in ('upload', 'generate', 'hybrid')),
  add column safety_profile text not null default 'kids_gaming' check (safety_profile in ('kids_gaming', 'infant_sleep', 'general')),
  add column banned_words text[] not null default '{}' check (cardinality(banned_words) <= 100 and length(array_to_string(banned_words, '|')) <= 3000),
  add column synthetic_media boolean not null default false,
  add column concept_auto_approve boolean not null default false,
  add column publish_slots text[] not null default '{}' check (cardinality(publish_slots) <= 6 and array_to_string(publish_slots, ',') ~ '^(([01][0-9]|2[0-3]):[0-5][0-9](,|$))*$'),
  add column providers jsonb not null default '{"llm":"gemini","tts":"google","music":"none","video":"none"}'::jsonb check (jsonb_typeof(providers) = 'object'),
  add constraint yt_channels_slug_unique unique (studio_id, slug);

-- Het bestaande standaardkanaal is KIVOXEL.
update public.yt_channels set slug = 'kivoxel' where is_default and slug is null;

-- Dreamnest NL als gepland kanaal voor elke studio die al bestaat.
insert into public.yt_channels (studio_id, name, slug, status, language, audience, brand_color, made_for_kids, mode, safety_profile, banned_words, synthetic_media, publish_slots)
select s.id, 'Dreamnest NL', 'dreamnest-nl', 'planned', 'nl',
  'Ouders van baby''s en peuters (0-3 jaar); speelt af bij het slapengaan, scherm omlaag.', '#8a7bd8', true,
  'generate', 'infant_sleep',
  array['geneest', 'koliek weg', 'gegarandeerd', 'breinontwikkeling', 'slimmer', 'IQ', 'therapie'],
  true, array['19:00', '20:00']
from public.studios s
where not exists (select 1 from public.yt_channels c where c.studio_id = s.id and (c.slug = 'dreamnest-nl' or c.name = 'Dreamnest NL'));

revoke insert, update on public.yt_channels from authenticated;
grant insert (studio_id, name, status, language, audience, brand_color, slug, mode, safety_profile, banned_words, synthetic_media, publish_slots, made_for_kids) on public.yt_channels to authenticated;
grant update (name, status, language, audience, brand_color, voice_name, speaking_rate, game_volume, privacy_regions, made_for_kids,
  slug, mode, safety_profile, banned_words, synthetic_media, concept_auto_approve, publish_slots) on public.yt_channels to authenticated;
-- Niet: providers, youtube_channel_id en is_default (alleen de server).

commit;

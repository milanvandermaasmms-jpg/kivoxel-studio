-- Familie M&K: YouTube Studio, koppeling met YouTube (Kivoxel Studio 2.2, fase D1). Nummer 036: YouTube-lijn.
--
-- * De werker op Milans pc logt in bij Google en bewaart de tokens versleuteld op die pc. Ze komen nooit in de
--   database (2.2, hoofdstuk 17). Hier staat alleen de stand van de koppeling per kanaal: naam en foto van het
--   YouTube-kanaal, wanneer gekoppeld, de laatste controle en een eventuele fout.
-- * Alleen de werker (service-rol) vult deze kolommen in; het dashboard leest ze alleen. Beheerders zien ze via de
--   bestaande leesregel van yt_channels; kinderen en andere leden zien geen kanalen.
-- * Alleen kolommen erbij; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   alter table public.yt_channels drop column youtube_error, drop column youtube_synced_at,
--     drop column youtube_connected_at, drop column youtube_thumbnail_url, drop column youtube_title;

begin;

alter table public.yt_channels
  add column youtube_title text check (length(youtube_title) <= 100),
  add column youtube_thumbnail_url text check (youtube_thumbnail_url ~ '^https://[a-z0-9.-]+\.(ggpht|googleusercontent|ytimg)\.com/' and length(youtube_thumbnail_url) <= 500),
  add column youtube_connected_at timestamptz,
  add column youtube_synced_at timestamptz,
  add column youtube_error text check (length(youtube_error) <= 500);
-- Gekoppeld betekent: er is een YouTube-kanaal-ID.
alter table public.yt_channels add constraint yt_channels_connected_has_id check (youtube_connected_at is null or youtube_channel_id is not null);

-- Geen grant voor authenticated: de kolomrechten uit 032 noemen deze kolommen niet, dus het dashboard kan ze niet wijzigen.

commit;

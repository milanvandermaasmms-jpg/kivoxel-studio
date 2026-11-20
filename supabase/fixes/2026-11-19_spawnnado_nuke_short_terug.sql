-- Reparatie 19-11-2026: de SpawnNado-Short "Roblox Player Drops a Massive Nuke on an Entire Army!" staat door een
-- mislukte upload (07:47, nog met de KIVOXEL-sleutel) als privé onder Live op YouTube. YouTube kent die video niet.
-- Terug naar keuren: de publicatie wordt weer een concept, de video gaat naar Te keuren. Raakt alleen deze ene rij.
begin;

update public.yt_publications
set status = 'draft', youtube_video_id = null, visibility = 'private', publish_at = null, error = null, updated_at = now()
where youtube_video_id = 'c7FFxivEZbQ' and video_id = 'e57fd0e5-6d4c-48c7-8b77-b93df5d63465';

update public.yt_videos
set status = 'review', youtube_video_id = null, privacy_status = 'private', published_at = null, scheduled_at = null, updated_at = now()
where id = 'e57fd0e5-6d4c-48c7-8b77-b93df5d63465' and status <> 'archived';

commit;

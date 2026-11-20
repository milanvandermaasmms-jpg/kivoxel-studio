-- Reparatie 19-11-2026: twee SpawnNado-video's gingen met de KIVOXEL-sleutel naar YouTube (op KIVOXEL, privé).
-- Milan heeft ze bij KIVOXEL verwijderd. Hier gaan ze terug naar "Klaar voor YouTube", zodat ze na de herstart
-- van de werker opnieuw verstuurd kunnen worden, nu naar SpawnNado. Raakt alleen deze twee YouTube-ID's.
begin;

update public.yt_publications
set status = 'draft', youtube_video_id = null, visibility = 'private', publish_at = null, error = null, updated_at = now()
where youtube_video_id in ('Q9FxPzdvPTU', 'GiharvHtqmY');

update public.yt_videos
set status = 'approved', youtube_video_id = null, privacy_status = 'private', published_at = null, scheduled_at = null, updated_at = now()
where youtube_video_id in ('Q9FxPzdvPTU', 'GiharvHtqmY');

commit;

-- Familie M&K: YouTube Studio, kwaliteitscontrole (Kivoxel Studio 2.2, fase C1). Nummer 034: YouTube-lijn.
--
-- * yt_renders.qc: de echte metingen van een montage (ffprobe en één FFmpeg-ronde: luidheid in LUFS, pieken,
--   stiltes, zwart en stilstaand beeld, beeldwissels) en de checklist (groen/oranje/rood). Alleen de werker schrijft;
--   beheerders lezen. Rood blokkeert niet, maar vraagt bij het goedkeuren een bewuste bevestiging.
-- * Alleen een kolom erbij; er wordt niets gewijzigd of verwijderd. Terugdraaien:
--   alter table public.yt_renders drop column qc;

begin;

alter table public.yt_renders add column qc jsonb check (qc is null or jsonb_typeof(qc) = 'object');

commit;

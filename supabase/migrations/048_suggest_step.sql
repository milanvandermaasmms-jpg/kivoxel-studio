-- KIVOXEL Studio: AI-suggesties voor tags, titels en beschrijving (superprompt opschonen, fase 1.6).
--
-- * yt_jobs.step krijgt de waarde 'suggest'. Het dashboard zet zo'n stap klaar met de knop "Vraag AI-suggesties";
--   de werker vraagt Gemini om 10-15 tags, 3 titels en een beschrijving en zet die in yt_jobs.result.
--   Er wordt niets automatisch in het concept gezet: Milan kiest zelf wat hij overneemt.
-- * De kosten lopen via reserve_yt_cost (categorie analysis), dus binnen het maandplafond; testvideo's zijn gratis.
-- * Terugdraaien: delete from public.yt_jobs where step = 'suggest'; en de check terugzetten zonder 'suggest'.

begin;

alter table public.yt_jobs drop constraint yt_jobs_step_check;
alter table public.yt_jobs add constraint yt_jobs_step_check
  check (step in ('intake', 'analyse', 'script', 'voiceover', 'render', 'upload', 'publish', 'suggest'));

commit;

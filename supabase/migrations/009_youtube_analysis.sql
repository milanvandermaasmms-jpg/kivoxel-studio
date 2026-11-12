-- Familie M&K: YouTube Studio, analyse en script (pakket 52).
--
-- * yt_settings: het akkoord en het maandplafond voor betaalde verwerking. Zolang een beheerder dat niet heeft
--   aangezet, weigert reserve_yt_cost elke betaalde stap. Alleen opnames gelabeld als testdata worden dan zonder
--   AI (en zonder kosten) verwerkt.
-- * yt_moments: bruikbare momenten in een opname, met tijdcode, reden en de controle op context en afloop.
-- * yt_video_moments: welke momenten een video gebruikt (een Short één, een lange video meerdere).
-- * yt_scripts: hook, vaste tekstregel, script en montageplan per video, in versies ("Opnieuw genereren").
-- * Alles alleen voor beheerders, net als migratie 007. Kosten tellen één keer per stap (yt_costs_job_once_idx).

begin;

-- ---------- Akkoord en maandplafond ----------

create table public.yt_settings (
  studio_id uuid primary key references public.studios (id) on delete cascade,
  paid_processing_enabled boolean not null default false,
  analysis_service text not null default 'gemini-flash-lite' check (analysis_service in ('gemini-flash-lite')),
  -- Plafond per kalendermaand (Europe/Amsterdam), in hele eurocenten. Bovengrens als vangnet tegen een tikfout.
  monthly_cap_cents integer not null default 0 check (monthly_cap_cents between 0 and 100000),
  warn_at_percent integer not null default 80 check (warn_at_percent between 1 and 100),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not paid_processing_enabled or (monthly_cap_cents > 0 and approved_at is not null))
);

-- Wie betaalde verwerking aanzet of het plafond wijzigt, geeft daarmee akkoord: dat wordt vastgelegd.
create function public.yt_settings_approval()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.paid_processing_enabled and (tg_op = 'INSERT' or not old.paid_processing_enabled or new.monthly_cap_cents <> old.monthly_cap_cents) then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger yt_settings_approval before insert or update on public.yt_settings for each row execute function public.yt_settings_approval();

-- ---------- Momenten ----------

create table public.yt_moments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  recording_id uuid not null,
  analysis_job_id uuid,
  kind text not null check (kind in ('near_death', 'rescue', 'mistake', 'rare_find', 'discovery', 'escape', 'surprise', 'build_result')),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  peak_ms integer,
  reason text not null check (length(reason) between 1 and 500),
  score smallint not null check (score between 0 and 100),
  has_context boolean not null,
  context_note text check (length(context_note) <= 300),
  has_payoff boolean not null,
  payoff_note text check (length(payoff_note) <= 300),
  -- Wat in pakket 54 vervaagd of gedempt moet worden.
  privacy_flags text[] not null default '{}' check (privacy_flags <@ array['gamertag', 'chat', 'voice', 'notification', 'face', 'real_name']),
  suggested_format text check (suggested_format in ('A', 'B', 'C')),
  usable boolean not null generated always as (has_context and has_payoff) stored,
  source text not null check (source in ('ai', 'test', 'manual')),
  model text check (length(model) <= 100),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_ms > start_ms),
  check (peak_ms is null or peak_ms between start_ms and end_ms),
  unique (studio_id, recording_id, kind, start_ms),
  unique (studio_id, id),
  foreign key (studio_id, recording_id) references public.yt_recordings (studio_id, id) on delete cascade,
  foreign key (studio_id, analysis_job_id) references public.yt_jobs (studio_id, id) on delete set null (analysis_job_id)
);
create index yt_moments_recording_idx on public.yt_moments (recording_id, start_ms);

-- ---------- Video's: vaste sleutel en kijkersbelofte ----------

-- plan_key (bijvoorbeeld "A:<moment>" of "C:<opname>") voorkomt dat een nieuwe analyse dezelfde video twee keer aanmaakt.
alter table public.yt_videos
  add column plan_key text check (length(plan_key) between 1 and 200),
  add column promise text check (length(promise) <= 200),
  add constraint yt_videos_plan_key_unique unique (studio_id, plan_key);

create table public.yt_video_moments (
  studio_id uuid not null references public.studios (id) on delete cascade,
  video_id uuid not null,
  moment_id uuid not null,
  position smallint not null default 0 check (position between 0 and 50),
  primary key (video_id, moment_id),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade,
  foreign key (studio_id, moment_id) references public.yt_moments (studio_id, id) on delete cascade
);

-- ---------- Scripts en montageplannen ----------

create table public.yt_scripts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  video_id uuid not null,
  version integer not null check (version >= 1),
  language text not null default 'en' check (language in ('en', 'nl')),
  -- Vaste tekstregel bovenin een Short (onderzoek hoofdstuk 3b).
  top_line text check (length(top_line) <= 60),
  hook text not null check (length(hook) between 1 and 300),
  -- [{ "at_ms": 0, "text": "..." }]: verteltekst op de tijdlijn van de eindvideo.
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  -- [{ "src_start_ms", "src_end_ms", "out_start_ms", "speed", "part", "effects": [], "note" }]
  edit_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(edit_plan) = 'array'),
  target_ms integer not null check (target_ms > 0),
  source text not null check (source in ('ai', 'test', 'manual')),
  model text check (length(model) <= 100),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, version),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade
);
-- Per video hooguit één goedgekeurde versie.
create unique index yt_scripts_one_approved_idx on public.yt_scripts (video_id) where status = 'approved';
create trigger yt_scripts_updated_at before update on public.yt_scripts for each row execute function public.set_updated_at();

-- ---------- Kosten vastleggen vóór een betaalde stap ----------

-- De werker roept dit aan vóór een betaalde stap. Weigert als betaalde verwerking uitstaat of als de geschatte kosten
-- het maandplafond zouden overschrijden. Legt de schatting vast als kostenpost bij de stap (één keer per stap en
-- categorie: een herstart reserveert niet opnieuw). Geeft het bedrag terug dat deze maand dan in totaal is gebruikt.
create function public.reserve_yt_cost(p_studio uuid, p_job uuid, p_category text, p_service text, p_estimate_cents integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s public.yt_settings;
  spent integer;
  month_start date := date_trunc('month', (now() at time zone 'Europe/Amsterdam'))::date;
begin
  if p_estimate_cents is null or p_estimate_cents < 0 then
    raise exception 'Ongeldige schatting';
  end if;
  select * into s from public.yt_settings where studio_id = p_studio for update;
  if not found or not s.paid_processing_enabled then
    raise exception 'Betaalde verwerking staat uit: eerst akkoord en een maandplafond in YouTube Studio';
  end if;
  if exists (select 1 from public.yt_costs c where c.job_id = p_job and c.category = p_category) then
    select coalesce(sum(c.amount_cents), 0) into spent from public.yt_costs c where c.studio_id = p_studio and c.currency = 'EUR' and c.incurred_on >= month_start;
    return spent;
  end if;
  select coalesce(sum(c.amount_cents), 0) into spent from public.yt_costs c where c.studio_id = p_studio and c.currency = 'EUR' and c.incurred_on >= month_start;
  if spent + p_estimate_cents > s.monthly_cap_cents then
    raise exception 'Maandplafond bereikt: % van % cent gebruikt, deze stap kost ongeveer % cent', spent, s.monthly_cap_cents, p_estimate_cents;
  end if;
  insert into public.yt_costs (studio_id, job_id, category, service, description, amount_cents, currency, is_estimate, incurred_on)
  values (p_studio, p_job, p_category, p_service, 'Schatting vóór de stap', p_estimate_cents, 'EUR', true, (now() at time zone 'Europe/Amsterdam')::date);
  return spent + p_estimate_cents;
end;
$$;

-- ---------- RLS: alleen beheerders ----------

alter table public.yt_settings enable row level security;
alter table public.yt_moments enable row level security;
alter table public.yt_video_moments enable row level security;
alter table public.yt_scripts enable row level security;

create policy "Beheerders zien de instellingen" on public.yt_settings for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders maken de instellingen" on public.yt_settings for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen de instellingen" on public.yt_settings for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));

create policy "Beheerders zien momenten" on public.yt_moments for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders voegen momenten toe" on public.yt_moments for insert to authenticated with check (public.is_studio_admin(studio_id) and source = 'manual');
create policy "Beheerders verwijderen momenten" on public.yt_moments for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien videomomenten" on public.yt_video_moments for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders koppelen momenten" on public.yt_video_moments for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders ontkoppelen momenten" on public.yt_video_moments for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien scripts" on public.yt_scripts for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders voegen scripts toe" on public.yt_scripts for insert to authenticated with check (public.is_studio_admin(studio_id) and source = 'manual');
create policy "Beheerders keuren scripts" on public.yt_scripts for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen scripts" on public.yt_scripts for delete to authenticated using (public.is_studio_admin(studio_id));

revoke all on public.yt_settings, public.yt_moments, public.yt_video_moments, public.yt_scripts from anon;
grant select, insert, update on public.yt_settings to authenticated;
grant select, insert, delete on public.yt_moments, public.yt_video_moments to authenticated;
grant select, insert, delete on public.yt_scripts to authenticated;
-- Het dashboard keurt alleen goed of af; de inhoud van een versie blijft zoals de werker hem maakte.
grant update (status) on public.yt_scripts to authenticated;

revoke execute on function public.reserve_yt_cost(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_yt_cost(uuid, uuid, text, text, integer) to service_role;

commit;

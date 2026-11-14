-- KIVOXEL Studio: Ivar — Studio Assistant.
--
-- * Geen tweede wachtrij: een antwoord van Ivar is een gewone stap 'assistant' in yt_jobs. De werker op de pc pakt hem
--   op (eigen baan, naast de montage), gebruikt Gemini Flash-Lite via reserve_yt_cost (maandplafond) en schrijft het
--   antwoord terug. Stoppen = cancel_yt_job; opnieuw = dezelfde stap, dus nooit een tweede betaalde reservering.
-- * Gesprekken, geheugen, ideeën en conceptwijzigingen staan per studio, kanaal en project. Alleen beheerders.
-- * Een conceptwijziging (titel, beschrijving, tags) is altijd terug te draaien en wordt alleen toegepast als het
--   concept intussen niet door iemand anders is gewijzigd. Publiceren kan Ivar niet: dat blijft Milans klik.
--
-- Terugdraaien:
--   drop table public.ivar_actions, public.ivar_revisions, public.ivar_ideas, public.ivar_memory, public.ivar_messages, public.ivar_conversations cascade;
--   drop function public.ivar_send, public.ivar_stop, public.ivar_retry, public.ivar_apply_revision, public.ivar_revert_revision, public.ivar_field_value, public.ivar_set_field;
--   (en de stap 'assistant' uit yt_jobs_step_check halen)

begin;

alter table public.yt_jobs drop constraint yt_jobs_step_check;
alter table public.yt_jobs add constraint yt_jobs_step_check
  check (step in ('intake', 'analyse', 'script', 'voiceover', 'render', 'upload', 'publish', 'suggest', 'viral', 'reference', 'assistant'));

-- ---------- Gesprekken ----------

create table public.ivar_conversations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  -- null = de hele studio
  channel_id uuid,
  project_kind text check (project_kind in ('recording', 'video', 'episode')),
  project_id uuid,
  project_label text check (length(project_label) <= 200),
  title text not null default 'Nieuw gesprek' check (length(trim(title)) between 1 and 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (studio_id, id),
  check ((project_kind is null) = (project_id is null)),
  check (project_id is null or channel_id is not null),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade
);
create index ivar_conversations_idx on public.ivar_conversations (studio_id, last_message_at desc);
create trigger ivar_conversations_updated_at before update on public.ivar_conversations for each row execute function public.set_updated_at();

create table public.ivar_messages (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (length(content) <= 8000),
  -- Resultaatkaarten (titels, analyse, concept, render, metadata, taak); alleen de werker schrijft ze.
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array' and length(cards::text) <= 60000),
  -- De zichtbare scope op het moment van versturen (kanaal → project → onderdeel).
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object' and length(scope::text) <= 2000),
  status text not null default 'done' check (status in ('pending', 'running', 'done', 'error', 'stopped')),
  -- Wat Ivar nu doet ("Bekijkt het project"), zonder verzonnen percentages.
  note text check (length(note) <= 200),
  job_id uuid,
  reply_to uuid references public.ivar_messages (id) on delete cascade,
  -- Tegen dubbel versturen (dubbelklik, opnieuw verbinden): dezelfde sleutel geeft hetzelfde bericht terug.
  client_key text check (client_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, client_key),
  foreign key (studio_id, conversation_id) references public.ivar_conversations (studio_id, id) on delete cascade,
  foreign key (studio_id, job_id) references public.yt_jobs (studio_id, id) on delete set null (job_id)
);
create index ivar_messages_idx on public.ivar_messages (conversation_id, created_at);
create trigger ivar_messages_updated_at before update on public.ivar_messages for each row execute function public.set_updated_at();

-- ---------- Geheugen: studio, kanaal of project ----------

create table public.ivar_memory (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid,
  project_kind text check (project_kind in ('recording', 'video', 'episode')),
  project_id uuid,
  scope text not null generated always as (case when project_id is not null then 'project' when channel_id is not null then 'channel' else 'studio' end) stored,
  content text not null check (length(trim(content)) between 1 and 500),
  source text not null default 'milan' check (source in ('milan', 'ivar')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((project_kind is null) = (project_id is null)),
  check (project_id is null or channel_id is not null),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade
);
create index ivar_memory_idx on public.ivar_memory (studio_id, channel_id);
create trigger ivar_memory_updated_at before update on public.ivar_memory for each row execute function public.set_updated_at();

-- ---------- Ideeën (videoconcepten) ----------

create table public.ivar_ideas (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid not null,
  conversation_id uuid,
  title text not null check (length(trim(title)) between 1 and 120),
  premise text not null default '' check (length(premise) <= 1000),
  opening text not null default '' check (length(opening) <= 500),
  source_material text not null default '' check (length(source_material) <= 500),
  shorts jsonb not null default '[]'::jsonb check (jsonb_typeof(shorts) = 'array' and jsonb_array_length(shorts) <= 5 and length(shorts::text) <= 2000),
  status text not null default 'idea' check (status in ('idea', 'project', 'dropped')),
  episode_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (studio_id, channel_id) references public.yt_channels (studio_id, id) on delete cascade,
  foreign key (studio_id, conversation_id) references public.ivar_conversations (studio_id, id) on delete set null (conversation_id)
);
create index ivar_ideas_idx on public.ivar_ideas (studio_id, channel_id, created_at desc);
create trigger ivar_ideas_updated_at before update on public.ivar_ideas for each row execute function public.set_updated_at();

-- ---------- Conceptwijzigingen met terugdraaien ----------

create table public.ivar_revisions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  channel_id uuid,
  video_id uuid not null,
  -- 'publication' = het publicatieconcept (yt_publications, alleen zolang het een concept is); 'video' = de werktitel.
  target text not null check (target in ('publication', 'video')),
  target_id uuid not null,
  field text not null check (field in ('title', 'description', 'tags')),
  before_value jsonb not null,
  after_value jsonb not null,
  note text check (length(note) <= 300),
  -- Opties uit één voorstel (bijv. drie titels): één tegelijk toegepast.
  group_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'reverted', 'superseded')),
  conversation_id uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  reverted_at timestamptz,
  check (target = 'publication' or field = 'title'),
  foreign key (studio_id, video_id) references public.yt_videos (studio_id, id) on delete cascade,
  foreign key (studio_id, conversation_id) references public.ivar_conversations (studio_id, id) on delete set null (conversation_id)
);
create index ivar_revisions_idx on public.ivar_revisions (video_id, created_at desc);

-- ---------- Activiteitenlog ----------

create table public.ivar_actions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  conversation_id uuid,
  message_id uuid references public.ivar_messages (id) on delete set null,
  actor text not null default 'ivar' check (actor in ('ivar', 'milan')),
  tool text not null check (tool ~ '^[a-z_]{2,60}$'),
  ok boolean not null,
  summary text not null check (length(summary) <= 300),
  input jsonb check (input is null or length(input::text) <= 4000),
  channel_id uuid,
  project_kind text check (project_kind in ('recording', 'video', 'episode')),
  project_id uuid,
  job_id uuid,
  dn_job_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (studio_id, conversation_id) references public.ivar_conversations (studio_id, id) on delete set null (conversation_id)
);
create index ivar_actions_idx on public.ivar_actions (studio_id, created_at desc);
create index ivar_actions_conversation_idx on public.ivar_actions (conversation_id, created_at desc);

-- ---------- Versturen, stoppen, opnieuw ----------

-- Eén stap: het bericht, de stap in de wachtrij en een lege plek voor het antwoord. Dezelfde client_key = hetzelfde
-- bericht (geen dubbele betaalde stap). Zolang Ivar nog met een antwoord bezig is, wacht een nieuw bericht.
create function public.ivar_send(p_conversation uuid, p_content text, p_client_key text, p_scope jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.ivar_conversations;
  existing public.ivar_messages;
  msg uuid;
  reply uuid;
  job uuid;
  body text := trim(coalesce(p_content, ''));
begin
  select * into c from public.ivar_conversations where id = p_conversation for update;
  if c.id is null or not public.is_studio_admin(c.studio_id) then
    raise exception 'Gesprek niet gevonden';
  end if;
  if length(body) = 0 or length(body) > 4000 then
    raise exception 'Een bericht is 1 tot 4000 tekens';
  end if;
  select * into existing from public.ivar_messages where conversation_id = c.id and client_key = p_client_key;
  if existing.id is not null then
    select id, job_id into reply, job from public.ivar_messages where reply_to = existing.id limit 1;
    return jsonb_build_object('message_id', existing.id, 'reply_id', reply, 'job_id', job, 'duplicate', true);
  end if;
  if exists (select 1 from public.ivar_messages where conversation_id = c.id and role = 'assistant' and status in ('pending', 'running')) then
    raise exception 'Ivar is nog bezig met het vorige antwoord. Wacht even of stop dat antwoord eerst.';
  end if;
  insert into public.ivar_messages (studio_id, conversation_id, role, content, scope, status, client_key)
  values (c.studio_id, c.id, 'user', body, coalesce(p_scope, '{}'::jsonb), 'done', p_client_key)
  returning id into msg;
  insert into public.yt_jobs (studio_id, channel_id, step, idempotency_key, payload, max_attempts)
  values (c.studio_id, c.channel_id, 'assistant', 'assistant:' || msg, jsonb_build_object('conversation_id', c.id, 'message_id', msg), 1)
  returning id into job;
  insert into public.ivar_messages (studio_id, conversation_id, role, status, note, job_id, reply_to)
  values (c.studio_id, c.id, 'assistant', 'pending', 'Wacht op de werker op de pc', job, msg)
  returning id into reply;
  update public.ivar_conversations
  set last_message_at = now(), title = case when title = 'Nieuw gesprek' then left(regexp_replace(body, '\s+', ' ', 'g'), 60) else title end
  where id = c.id;
  return jsonb_build_object('message_id', msg, 'reply_id', reply, 'job_id', job, 'duplicate', false);
end;
$$;

-- Stopt alleen het antwoord van Ivar, nooit een render of analyse (die heeft een eigen stap).
create function public.ivar_stop(p_reply uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ivar_messages;
  j public.yt_jobs;
begin
  select * into m from public.ivar_messages where id = p_reply and role = 'assistant' for update;
  if m.id is null or not public.is_studio_admin(m.studio_id) then
    raise exception 'Antwoord niet gevonden';
  end if;
  if m.status not in ('pending', 'running') then
    return m.status;
  end if;
  select * into j from public.yt_jobs where id = m.job_id and step = 'assistant' for update;
  if j.status = 'running' then
    update public.yt_jobs set cancel_requested = true where id = j.id;
    update public.ivar_messages set note = 'Wordt gestopt' where id = m.id;
    return 'requested';
  end if;
  if j.status = 'queued' then
    update public.yt_jobs set status = 'cancelled', finished_at = now() where id = j.id;
  end if;
  update public.ivar_messages set status = 'stopped', note = null, content = case when content = '' then 'Gestopt.' else content end where id = m.id;
  return 'stopped';
end;
$$;

-- Opnieuw: dezelfde stap terug in de wachtrij. De kostenreservering hoort bij de stap, dus er komt geen tweede bij.
create function public.ivar_retry(p_reply uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.ivar_messages;
begin
  select * into m from public.ivar_messages where id = p_reply and role = 'assistant' for update;
  if m.id is null or not public.is_studio_admin(m.studio_id) then
    raise exception 'Antwoord niet gevonden';
  end if;
  if m.status not in ('error', 'stopped') or m.job_id is null then
    raise exception 'Dit antwoord kan niet opnieuw';
  end if;
  if exists (select 1 from public.ivar_messages where conversation_id = m.conversation_id and role = 'assistant' and status in ('pending', 'running') and id <> m.id) then
    raise exception 'Ivar is nog bezig met een ander antwoord';
  end if;
  update public.yt_jobs
  set status = 'queued', attempts = 0, error = null, locked_by = null, locked_at = null, started_at = null, finished_at = null, cancel_requested = false
  where id = m.job_id and step = 'assistant' and status in ('failed', 'cancelled', 'done');
  update public.ivar_messages set status = 'pending', note = 'Wacht op de werker op de pc', content = '', cards = '[]'::jsonb where id = m.id;
end;
$$;

-- ---------- Conceptwijzigingen ----------

create function public.ivar_field_value(p_target text, p_id uuid, p_field text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_target = 'publication' then
    select case p_field when 'title' then to_jsonb(title) when 'description' then to_jsonb(description) else to_jsonb(tags) end
    into v from public.yt_publications where id = p_id and status = 'draft';
  else
    select to_jsonb(coalesce(title, '')) into v from public.yt_videos where id = p_id and youtube_video_id is null and status not in ('published', 'archived');
  end if;
  return v;
end;
$$;

create function public.ivar_set_field(p_target text, p_id uuid, p_field text, p_value jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_target = 'publication' then
    if p_field = 'title' then
      update public.yt_publications set title = p_value #>> '{}' where id = p_id and status = 'draft';
    elsif p_field = 'description' then
      update public.yt_publications set description = p_value #>> '{}' where id = p_id and status = 'draft';
    else
      update public.yt_publications set tags = array(select jsonb_array_elements_text(p_value)) where id = p_id and status = 'draft';
    end if;
  else
    update public.yt_videos set title = nullif(p_value #>> '{}', '') where id = p_id and youtube_video_id is null;
  end if;
  if not found then
    raise exception 'Dit concept kan niet meer worden gewijzigd (al geüpload of gepubliceerd)';
  end if;
end;
$$;

-- Toepassen: alleen als het concept nog is zoals Ivar het zag (of als een andere optie uit hetzelfde voorstel is toegepast).
create function public.ivar_apply_revision(p_revision uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ivar_revisions;
  cur jsonb;
  sibling uuid;
begin
  select * into r from public.ivar_revisions where id = p_revision for update;
  if r.id is null or not public.is_studio_admin(r.studio_id) then
    raise exception 'Voorstel niet gevonden';
  end if;
  if r.status not in ('proposed', 'reverted', 'superseded') then
    raise exception 'Dit voorstel is al toegepast';
  end if;
  cur := public.ivar_field_value(r.target, r.target_id, r.field);
  if cur is null then
    raise exception 'Dit concept kan niet meer worden gewijzigd (al geüpload of gepubliceerd)';
  end if;
  if cur is distinct from r.before_value then
    select s.id into sibling from public.ivar_revisions s
    where s.group_id = r.group_id and r.group_id is not null and s.id <> r.id and s.status = 'applied' and s.after_value = cur
    limit 1;
    if sibling is null then
      raise exception 'Het concept is intussen gewijzigd. Vraag Ivar om een nieuw voorstel op de huidige versie.';
    end if;
    update public.ivar_revisions set status = 'superseded' where id = sibling;
  end if;
  perform public.ivar_set_field(r.target, r.target_id, r.field, r.after_value);
  update public.ivar_revisions set status = 'applied', applied_at = now(), reverted_at = null where id = r.id;
end;
$$;

create function public.ivar_revert_revision(p_revision uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ivar_revisions;
  cur jsonb;
begin
  select * into r from public.ivar_revisions where id = p_revision for update;
  if r.id is null or not public.is_studio_admin(r.studio_id) then
    raise exception 'Voorstel niet gevonden';
  end if;
  if r.status <> 'applied' then
    raise exception 'Alleen een toegepast voorstel kan worden teruggedraaid';
  end if;
  cur := public.ivar_field_value(r.target, r.target_id, r.field);
  if cur is null then
    raise exception 'Dit concept kan niet meer worden gewijzigd (al geüpload of gepubliceerd)';
  end if;
  if cur is distinct from r.after_value then
    raise exception 'Het concept is na deze wijziging nog eens aangepast; terugdraaien zou dat overschrijven.';
  end if;
  perform public.ivar_set_field(r.target, r.target_id, r.field, r.before_value);
  update public.ivar_revisions set status = 'reverted', reverted_at = now() where id = r.id;
end;
$$;

-- ---------- RLS: alleen beheerders ----------

alter table public.ivar_conversations enable row level security;
alter table public.ivar_messages enable row level security;
alter table public.ivar_memory enable row level security;
alter table public.ivar_ideas enable row level security;
alter table public.ivar_revisions enable row level security;
alter table public.ivar_actions enable row level security;

create policy "Beheerders zien gesprekken" on public.ivar_conversations for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders beginnen gesprekken" on public.ivar_conversations for insert to authenticated with check (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen gesprekken" on public.ivar_conversations for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen gesprekken" on public.ivar_conversations for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien berichten" on public.ivar_messages for select to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien het geheugen" on public.ivar_memory for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders vullen het geheugen" on public.ivar_memory for insert to authenticated with check (public.is_studio_admin(studio_id) and source = 'milan');
create policy "Beheerders wijzigen het geheugen" on public.ivar_memory for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders wissen het geheugen" on public.ivar_memory for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien ideeën" on public.ivar_ideas for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders wijzigen ideeën" on public.ivar_ideas for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));
create policy "Beheerders verwijderen ideeën" on public.ivar_ideas for delete to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien voorstellen" on public.ivar_revisions for select to authenticated using (public.is_studio_admin(studio_id));

create policy "Beheerders zien het logboek van Ivar" on public.ivar_actions for select to authenticated using (public.is_studio_admin(studio_id));
create policy "Beheerders leggen eigen klikken vast" on public.ivar_actions for insert to authenticated with check (public.is_studio_admin(studio_id) and actor = 'milan');

revoke all on public.ivar_conversations, public.ivar_messages, public.ivar_memory, public.ivar_ideas, public.ivar_revisions, public.ivar_actions from anon, authenticated;
grant select, delete on public.ivar_conversations to authenticated;
grant insert (studio_id, channel_id, project_kind, project_id, project_label, title) on public.ivar_conversations to authenticated;
grant update (channel_id, project_kind, project_id, project_label, title) on public.ivar_conversations to authenticated;
grant select on public.ivar_messages to authenticated;
grant select, delete on public.ivar_memory to authenticated;
grant insert (studio_id, channel_id, project_kind, project_id, content) on public.ivar_memory to authenticated;
grant update (content, channel_id, project_kind, project_id) on public.ivar_memory to authenticated;
grant select, delete on public.ivar_ideas to authenticated;
grant update (status, episode_id) on public.ivar_ideas to authenticated;
grant select on public.ivar_revisions to authenticated;
grant select on public.ivar_actions to authenticated;
grant insert (studio_id, conversation_id, actor, tool, ok, summary, input, channel_id, project_kind, project_id, job_id, dn_job_id) on public.ivar_actions to authenticated;
grant select, insert, update, delete on public.ivar_conversations, public.ivar_messages, public.ivar_memory, public.ivar_ideas, public.ivar_revisions, public.ivar_actions to service_role;

revoke execute on function public.ivar_send(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ivar_send(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.ivar_stop(uuid) from public, anon;
grant execute on function public.ivar_stop(uuid) to authenticated;
revoke execute on function public.ivar_retry(uuid) from public, anon;
grant execute on function public.ivar_retry(uuid) to authenticated;
revoke execute on function public.ivar_apply_revision(uuid) from public, anon;
grant execute on function public.ivar_apply_revision(uuid) to authenticated;
revoke execute on function public.ivar_revert_revision(uuid) from public, anon;
grant execute on function public.ivar_revert_revision(uuid) to authenticated;
revoke execute on function public.ivar_field_value(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.ivar_set_field(text, uuid, text, jsonb) from public, anon, authenticated;

alter publication supabase_realtime add table public.ivar_messages;

commit;

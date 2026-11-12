-- KIVOXEL Studio: het aantal video's "klaar voor review" voor de tegel in het familie-dashboard.
--
-- Het familie-dashboard heeft geen account in dit project. Het vraagt alleen een getal op, met een geheim token
-- dat in beide .env.local-bestanden (en in Vercel) staat. Hier wordt alleen de SHA-256 van dat token bewaard.
-- Zonder geldig token geeft de functie null: geen foutmelding die iets verraadt, en nooit titels of andere gegevens.

begin;

create table public.studio_tile_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  label text not null default 'familie-dashboard',
  created_at timestamptz not null default now()
);
alter table public.studio_tile_tokens enable row level security;
-- Geen policies: alleen de eigenaar via de SQL Editor (en de functie hieronder) komt erbij.
revoke all on public.studio_tile_tokens from anon, authenticated;

create function public.kivoxel_review_count(p_token text)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  if not exists (
    select 1 from public.studio_tile_tokens t
    where t.token_sha256 = encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    return null;
  end if;
  return (select count(*)::integer from public.yt_videos v where v.status = 'review' and not v.is_test);
end;
$$;

revoke execute on function public.kivoxel_review_count(text) from public;
grant execute on function public.kivoxel_review_count(text) to anon, authenticated;

commit;

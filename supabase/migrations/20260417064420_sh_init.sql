-- Secret Hitler (networked) — Supabase schema + RLS
-- Run this ONCE in the Supabase SQL editor (or via `supabase db push`).

create table if not exists public.sh_games (
  code text primary key,
  host_id uuid not null default gen_random_uuid(),
  status text not null default 'waiting',
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sh_games_updated_at_idx on public.sh_games (updated_at desc);

-- Lock the table from anon. The Edge Function uses the service_role key and
-- bypasses RLS; clients never read this table directly — they call the
-- Edge Function to fetch a filtered state (public + their private slice).
alter table public.sh_games enable row level security;

drop policy if exists sh_games_no_anon_select on public.sh_games;
create policy sh_games_no_anon_select on public.sh_games
  for select
  using (false);

drop policy if exists sh_games_no_anon_write on public.sh_games;
create policy sh_games_no_anon_write on public.sh_games
  for all
  using (false)
  with check (false);

-- Optional: tidy up stale games (>24h since last activity). Call manually or
-- schedule via Supabase cron. Safe to skip at first.
create or replace function public.sh_cleanup_old_games()
returns int
language plpgsql
security definer
as $$
declare n int;
begin
  delete from public.sh_games where updated_at < now() - interval '24 hours'
  returning 1 into n;
  get diagnostics n = row_count;
  return n;
end;
$$;

alter table public.sh_games alter column host_id type text using host_id::text;
alter table public.sh_games alter column host_id drop default;

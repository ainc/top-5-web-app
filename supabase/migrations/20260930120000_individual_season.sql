-- The open season scores individuals. ACES, Alpha, and Awesomes were sheet sections, not teams.
-- teams stays so a commissioner can name real teams and set scoring_mode to 'teams' later.
-- commissioner replaces super_admin. The developer is the Supabase service role, not a user_roles row.

alter table public.seasons
  add column if not exists scoring_mode text not null default 'individual';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seasons_scoring_mode_check') then
    alter table public.seasons
      add constraint seasons_scoring_mode_check check (scoring_mode in ('individual', 'teams'));
  end if;
end $$;

update public.seasons set scoring_mode = 'individual' where is_open;

create table if not exists public.season_members (
  season_id uuid not null references public.seasons (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (season_id, profile_id)
);

insert into public.season_members (season_id, profile_id)
select distinct season_id, profile_id from public.team_members
on conflict do nothing;

insert into public.season_members (season_id, profile_id)
select distinct season_id, profile_id from public.day_entries
on conflict do nothing;

alter table public.teams drop constraint if exists teams_name_check;

delete from public.teams where name in ('ACES', 'Alpha', 'Awesomes');

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check check (role in ('member', 'admin', 'commissioner'));

grant select, insert, update, delete on public.season_members to anon, authenticated;

alter table public.season_members enable row level security;
drop policy if exists "public read" on public.season_members;
drop policy if exists "public insert" on public.season_members;
drop policy if exists "public update" on public.season_members;
drop policy if exists "public delete" on public.season_members;
create policy "public read" on public.season_members for select to anon, authenticated using (true);
create policy "public insert" on public.season_members for insert to anon, authenticated with check (true);
create policy "public update" on public.season_members for update to anon, authenticated using (true) with check (true);
create policy "public delete" on public.season_members for delete to anon, authenticated using (true);

-- A commissioner turns team scoring on, then names the teams:
-- update public.seasons set scoring_mode = 'teams' where is_open;
-- insert into public.teams (season_id, name)
-- select id, 'Team name' from public.seasons where is_open;

notify pgrst, 'reload schema';

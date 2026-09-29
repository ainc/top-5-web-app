-- Scorecard tables for the AG Grid app.
-- Profiles are the people on the roster. auth_user_id stays empty until sign-in exists.
-- Writes are open to the publishable key for now, because the person menu can edit any row.
-- Replace those policies with per-user checks when authentication is added.

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  length_weeks integer not null check (length_weeks > 0),
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists seasons_one_open on public.seasons (is_open) where is_open;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('member', 'admin', 'super_admin'))
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (name in ('ACES', 'Alpha', 'Awesomes')),
  unique (season_id, name)
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (season_id, profile_id)
);

create table if not exists public.scoring_rules (
  season_id uuid primary key references public.seasons (id) on delete cascade,
  points_per_task integer not null default 0 check (points_per_task >= 0)
);

create table if not exists public.bonus_definitions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  key text not null,
  name text not null,
  points integer not null check (points >= 0),
  retired_at timestamptz,
  unique (season_id, key)
);

create table if not exists public.day_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  notes text not null default '',
  unique (profile_id, entry_date)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  slot integer not null check (slot between 1 and 5),
  title text not null default '',
  done boolean not null default false,
  unique (profile_id, entry_date, slot)
);

create table if not exists public.bonus_checks (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  bonus_id uuid not null references public.bonus_definitions (id) on delete cascade,
  checked boolean not null default false,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  unique (profile_id, entry_date, bonus_id)
);

-- File name or "Sample sheet" for the week on screen. Not part of scoring.
create table if not exists public.week_meta (
  week_monday date primary key,
  source text not null
);

create index if not exists day_entries_date_idx on public.day_entries (entry_date);
create index if not exists tasks_date_idx on public.tasks (entry_date);
create index if not exists bonus_checks_date_idx on public.bonus_checks (entry_date);

-- Daily points: completed tasks times points_per_task, plus the bonus values saved at check time.
create or replace view public.day_scores
with (security_invoker = true) as
select
  e.profile_id,
  e.season_id,
  e.entry_date,
  e.notes,
  coalesce(sr.points_per_task, 0) * coalesce(td.done_count, 0) as task_points,
  coalesce(bc.bonus_points, 0) as bonus_points,
  coalesce(sr.points_per_task, 0) * coalesce(td.done_count, 0) + coalesce(bc.bonus_points, 0) as daily_points
from public.day_entries e
left join public.scoring_rules sr on sr.season_id = e.season_id
left join (
  select profile_id, entry_date, (count(*) filter (where done))::integer as done_count
  from public.tasks
  group by profile_id, entry_date
) td on td.profile_id = e.profile_id and td.entry_date = e.entry_date
left join (
  select profile_id, entry_date, coalesce((sum(points_awarded) filter (where checked))::integer, 0) as bonus_points
  from public.bonus_checks
  group by profile_id, entry_date
) bc on bc.profile_id = e.profile_id and bc.entry_date = e.entry_date;

insert into public.seasons (name, starts_on, length_weeks, is_open)
select 'Current season', date '2026-09-28', 12, true
where not exists (select 1 from public.seasons where is_open);

insert into public.scoring_rules (season_id, points_per_task)
select id, 0 from public.seasons where is_open
on conflict (season_id) do nothing;

insert into public.teams (season_id, name)
select s.id, t.name
from public.seasons s
cross join (values ('ACES'), ('Alpha'), ('Awesomes')) as t(name)
where s.is_open
on conflict (season_id, name) do nothing;

insert into public.bonus_definitions (season_id, key, name, points)
select s.id, b.key, b.name, b.points
from public.seasons s
cross join (
  values
    ('top5', 'Top 5 complete', 15),
    ('exercise', 'Exercise', 5),
    ('reading', 'Reading', 5)
) as b(key, name, points)
where s.is_open
on conflict (season_id, key) do nothing;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.user_roles,
  public.seasons,
  public.teams,
  public.team_members,
  public.scoring_rules,
  public.bonus_definitions,
  public.day_entries,
  public.tasks,
  public.bonus_checks,
  public.week_meta
to anon, authenticated;
grant select on public.day_scores to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_roles', 'seasons', 'teams', 'team_members',
    'scoring_rules', 'bonus_definitions', 'day_entries', 'tasks',
    'bonus_checks', 'week_meta'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('drop policy if exists "public insert" on public.%I', t);
    execute format('drop policy if exists "public update" on public.%I', t);
    execute format('drop policy if exists "public delete" on public.%I', t);
    execute format(
      'create policy "public read" on public.%I for select to anon, authenticated using (true)',
      t
    );
    execute format(
      'create policy "public insert" on public.%I for insert to anon, authenticated with check (true)',
      t
    );
    execute format(
      'create policy "public update" on public.%I for update to anon, authenticated using (true) with check (true)',
      t
    );
    execute format(
      'create policy "public delete" on public.%I for delete to anon, authenticated using (true)',
      t
    );
  end loop;
end $$;

-- Live updates for the grids. Ignore a duplicate add if the migration is applied twice.
do $$
declare
  t text;
begin
  foreach t in array array['day_entries', 'tasks', 'bonus_checks']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then
        null;
      when others then
        raise notice 'realtime %: %', t, sqlerrm;
    end;
  end loop;
end $$;

-- After someone signs up, grant the first super admin with:
-- insert into public.user_roles (profile_id, role)
-- select id, 'super_admin' from public.profiles where auth_user_id = '<user uuid>';

notify pgrst, 'reload schema';

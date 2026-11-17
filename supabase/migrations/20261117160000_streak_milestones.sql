-- Per-season streak milestone awards. Previously hardcoded in src/streaks.ts,
-- now stored beside scoring_rules and bonus_definitions so commissioners can
-- adjust the milestone days and bonus payouts between seasons.

create table if not exists public.streak_milestones (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  day integer not null check (day > 0),
  points integer not null check (points >= 0),
  unique (season_id, day)
);

-- Seed every existing season with the original milestone ladder.
insert into public.streak_milestones (season_id, day, points)
select s.id, m.day, m.points
from public.seasons as s
cross join (
  values
    (3, 5),
    (5, 5),
    (8, 5),
    (10, 10),
    (15, 20),
    (20, 25),
    (25, 25)
) as m(day, points)
on conflict (season_id, day) do nothing;

alter table public.streak_milestones enable row level security;

revoke all on public.streak_milestones from anon, authenticated;
grant select on public.streak_milestones to anon, authenticated;
grant insert, update, delete on public.streak_milestones to authenticated;

drop policy if exists "public read" on public.streak_milestones;
create policy "public read" on public.streak_milestones
  for select to anon, authenticated
  using (true);

drop policy if exists "staff insert" on public.streak_milestones;
create policy "staff insert" on public.streak_milestones
  for insert to authenticated
  with check ((select app_private.is_staff()));

drop policy if exists "staff update" on public.streak_milestones;
create policy "staff update" on public.streak_milestones
  for update to authenticated
  using ((select app_private.is_staff()))
  with check ((select app_private.is_staff()));

drop policy if exists "staff delete" on public.streak_milestones;
create policy "staff delete" on public.streak_milestones
  for delete to authenticated
  using ((select app_private.is_staff()));

drop trigger if exists streak_milestones_reject_closed on public.streak_milestones;
create trigger streak_milestones_reject_closed
  before insert or update or delete on public.streak_milestones
  for each row
  execute function app_private.reject_closed_season_write();

-- Keep create_season_draft copying streak_milestones alongside scoring_rules
-- and bonus_definitions, or seeding the default ladder for a blank draft.
create or replace function public.create_season_draft(
  source_id uuid,
  season_name text,
  starts_on date,
  length_weeks integer,
  copy_settings boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
  source public.seasons%rowtype;
  copied_mode text;
  team_row record;
  new_team_id uuid;
begin
  if not (select app_private.is_staff()) then
    raise exception 'Only an admin or commissioner can plan a season';
  end if;
  if season_name is null or btrim(season_name) = '' then
    raise exception 'A season needs a name';
  end if;
  if starts_on is null then
    raise exception 'A season needs a start date';
  end if;
  if length_weeks is null or length_weeks < 1 then
    raise exception 'A season needs at least one week';
  end if;

  if copy_settings then
    select * into source from public.seasons where id = source_id;
    if not found then
      raise exception 'Choose a season to copy';
    end if;
    copied_mode := source.scoring_mode;
  else
    copied_mode := 'individual';
  end if;

  insert into public.seasons (name, starts_on, length_weeks, is_open, status, scoring_mode)
  values (btrim(season_name), starts_on, length_weeks, false, 'draft', copied_mode)
  returning id into new_id;

  if copy_settings then
    insert into public.scoring_rules (season_id, points_per_task)
    select new_id, rules.points_per_task
    from public.scoring_rules as rules
    where rules.season_id = source_id;

    insert into public.bonus_definitions (season_id, key, name, points, retired_at)
    select new_id, bonus.key, bonus.name, bonus.points, bonus.retired_at
    from public.bonus_definitions as bonus
    where bonus.season_id = source_id;

    insert into public.streak_milestones (season_id, day, points)
    select new_id, milestone.day, milestone.points
    from public.streak_milestones as milestone
    where milestone.season_id = source_id;

    insert into public.season_members (season_id, profile_id)
    select new_id, member.profile_id
    from public.season_members as member
    where member.season_id = source_id;

    for team_row in
      select id, name from public.teams where season_id = source_id order by name
    loop
      insert into public.teams (season_id, name)
      values (new_id, team_row.name)
      returning id into new_team_id;

      insert into public.team_members (season_id, team_id, profile_id)
      select new_id, new_team_id, assignment.profile_id
      from public.team_members as assignment
      where assignment.season_id = source_id
        and assignment.team_id = team_row.id;
    end loop;
  else
    insert into public.streak_milestones (season_id, day, points)
    values
      (new_id, 3, 5),
      (new_id, 5, 5),
      (new_id, 8, 5),
      (new_id, 10, 10),
      (new_id, 15, 20),
      (new_id, 20, 25),
      (new_id, 25, 25)
    on conflict (season_id, day) do nothing;
  end if;

  insert into public.scoring_rules (season_id, points_per_task)
  values (new_id, 0)
  on conflict (season_id) do nothing;

  insert into public.bonus_definitions (season_id, key, name, points)
  values
    (new_id, 'top5', 'Top 5 complete', 15),
    (new_id, 'exercise', 'Exercise', 5),
    (new_id, 'reading', 'Reading', 5)
  on conflict (season_id, key) do nothing;

  return new_id;
end;
$$;

revoke all on function public.create_season_draft(uuid, text, date, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_season_draft(uuid, text, date, integer, boolean) to authenticated;

notify pgrst, 'reload schema';

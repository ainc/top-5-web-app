-- A commissioner can draft the next season while one season stays live.
-- status is draft, active, or closed. is_open stays the single live flag the
-- board already reads, and the partial unique index still allows only one.

alter table public.seasons
  add column if not exists status text;

update public.seasons
set status = case when is_open then 'active' else 'closed' end
where status is null;

alter table public.seasons
  alter column status set default 'draft';

alter table public.seasons
  alter column status set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seasons_status_check') then
    alter table public.seasons
      add constraint seasons_status_check
      check (
        (status = 'active' and is_open)
        or (status in ('draft', 'closed') and not is_open)
      );
  end if;
end $$;

comment on column public.seasons.status is
  'draft is editable and off the board, active is the one live season, closed keeps its saved days.';

-- Built-in bonuses cannot be removed from a live or closed season. Deleting a
-- draft cascades to those rows, so that delete has to be allowed for a draft.
create or replace function app_private.protect_builtin_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.key in ('top5', 'exercise', 'reading') then
    if current_setting('app.allow_draft_bonus_delete', true) = 'on' then
      return old;
    end if;
    raise exception 'Top 5, Exercise, and Reading cannot be removed';
  end if;
  if tg_op = 'UPDATE' and old.key in ('top5', 'exercise', 'reading') then
    if new.key is distinct from old.key or new.retired_at is not null then
      raise exception 'Top 5, Exercise, and Reading cannot be removed';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_builtin_bonus() from public;
grant execute on function app_private.protect_builtin_bonus() to authenticated;

create or replace function app_private.protect_season_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Only a draft season can be deleted';
  end if;
  -- The cascade delete of Top 5, Exercise, and Reading is limited to this draft.
  perform set_config('app.allow_draft_bonus_delete', 'on', true);
  return old;
end;
$$;

revoke all on function app_private.protect_season_delete() from public;
grant execute on function app_private.protect_season_delete() to authenticated;

drop trigger if exists seasons_protect_delete on public.seasons;
create trigger seasons_protect_delete
  before delete on public.seasons
  for each row
  execute function app_private.protect_season_delete();

-- Copies roster, teams, and scoring into a draft. The caller chooses the
-- length; the screen sends 8, which is the usual new-season length.
-- Days and scores are not copied. security invoker keeps the staff RLS checks.
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

-- Closes the live season first, then opens the draft, so the one-open index holds.
create or replace function public.activate_season(target_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_status text;
begin
  if not (select app_private.is_staff()) then
    raise exception 'Only an admin or commissioner can activate a season';
  end if;

  perform 1
  from public.seasons
  where is_open or id = target_id
  for update;

  select status into draft_status
  from public.seasons
  where id = target_id;
  if not found then
    raise exception 'That season was not found';
  end if;
  if draft_status <> 'draft' then
    raise exception 'Only a draft season can be activated';
  end if;

  update public.seasons
  set is_open = false, status = 'closed'
  where is_open;

  update public.seasons
  set is_open = true, status = 'active'
  where id = target_id;
end;
$$;

revoke all on function public.activate_season(uuid) from public, anon, authenticated;
grant execute on function public.activate_season(uuid) to authenticated;

notify pgrst, 'reload schema';

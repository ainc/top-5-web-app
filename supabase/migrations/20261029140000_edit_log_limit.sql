-- The edit log keeps the latest 1,000 changes. Older lines are removed.
-- Removing a line does not remove the day it described.
-- Each line also stores the season, so the admin screen can filter by it.
-- A closed season can still be read. Writes to its days are refused.

alter table public.edit_log
  add column if not exists season_id uuid references public.seasons (id) on delete set null;

update public.edit_log
set season_id = nullif(coalesce(new_row->>'season_id', old_row->>'season_id'), '')::uuid
where season_id is null
  and coalesce(new_row->>'season_id', old_row->>'season_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create index if not exists edit_log_season_idx on public.edit_log (season_id, changed_at desc);

create or replace function app_private.log_scorecard_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  next jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  recorded_id uuid;
  recorded_profile uuid;
  recorded_day date;
  recorded_season uuid;
  oldest_kept bigint;
begin
  if tg_op = 'UPDATE' and prior = next then
    return new;
  end if;
  if tg_op = 'DELETE' then
    recorded_id := old.id;
    recorded_profile := old.profile_id;
    recorded_day := old.entry_date;
    recorded_season := old.season_id;
  else
    recorded_id := new.id;
    recorded_profile := new.profile_id;
    recorded_day := new.entry_date;
    recorded_season := new.season_id;
  end if;
  insert into public.edit_log (
    actor_id, table_name, row_id, action, old_row, new_row, profile_id, entry_date, season_id
  ) values (
    auth.uid(),
    tg_table_name,
    recorded_id,
    lower(tg_op),
    prior,
    next,
    recorded_profile,
    recorded_day,
    recorded_season
  );
  -- Keep the newest 1,000 ids. Fewer than 1,000 leaves the cutoff empty.
  select keeper.id into oldest_kept
  from public.edit_log as keeper
  order by keeper.id desc
  offset 999
  limit 1;
  if oldest_kept is not null then
    delete from public.edit_log as stale
    where stale.id < oldest_kept;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.log_scorecard_edit() from public;
grant execute on function app_private.log_scorecard_edit() to authenticated;

delete from public.edit_log as stale
where stale.id < coalesce((
  select keeper.id
  from public.edit_log as keeper
  order by keeper.id desc
  offset 999
  limit 1
), 0);

create or replace function app_private.reject_closed_season_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_season uuid := case when tg_op = 'DELETE' then old.season_id else new.season_id end;
  season_status text;
begin
  select status into season_status
  from public.seasons
  where id = target_season;
  if season_status = 'closed' then
    raise exception 'A closed season is kept for reading and cannot be changed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_closed_season_write() from public;
grant execute on function app_private.reject_closed_season_write() to authenticated;

drop trigger if exists tasks_reject_closed on public.tasks;
create trigger tasks_reject_closed
  before insert or update or delete on public.tasks
  for each row
  execute function app_private.reject_closed_season_write();

drop trigger if exists day_entries_reject_closed on public.day_entries;
create trigger day_entries_reject_closed
  before insert or update or delete on public.day_entries
  for each row
  execute function app_private.reject_closed_season_write();

drop trigger if exists bonus_checks_reject_closed on public.bonus_checks;
create trigger bonus_checks_reject_closed
  before insert or update or delete on public.bonus_checks
  for each row
  execute function app_private.reject_closed_season_write();

notify pgrst, 'reload schema';

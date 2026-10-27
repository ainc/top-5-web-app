-- A running log of scorecard edits. The app upserts a task in place, so the
-- row itself cannot show what it used to say. This trigger copies the old and
-- new values before that overwrite is forgotten.
-- The function lives in app_private so the Data API cannot call it. It is
-- security definer so the insert into edit_log succeeds without giving
-- members permission to forge log rows.
-- Restore stays a normal function. Row level security still decides whether
-- the caller may write the task they are putting back.

create table if not exists public.edit_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  table_name text not null check (table_name in ('tasks', 'day_entries', 'bonus_checks')),
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  profile_id uuid references public.profiles (id) on delete set null,
  entry_date date
);

create index if not exists edit_log_changed_at_idx on public.edit_log (changed_at desc);
create index if not exists edit_log_profile_idx on public.edit_log (profile_id, changed_at desc);
create index if not exists edit_log_table_idx on public.edit_log (table_name, changed_at desc);

alter table public.edit_log enable row level security;
revoke all on public.edit_log from anon, authenticated;
grant select on public.edit_log to authenticated;

drop policy if exists "staff read edits" on public.edit_log;
create policy "staff read edits" on public.edit_log
  for select to authenticated
  using ((select app_private.is_staff()));

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
begin
  if tg_op = 'UPDATE' and prior = next then
    return new;
  end if;
  if tg_op = 'DELETE' then
    recorded_id := old.id;
    recorded_profile := old.profile_id;
    recorded_day := old.entry_date;
  else
    recorded_id := new.id;
    recorded_profile := new.profile_id;
    recorded_day := new.entry_date;
  end if;
  insert into public.edit_log (
    actor_id, table_name, row_id, action, old_row, new_row, profile_id, entry_date
  ) values (
    auth.uid(),
    tg_table_name,
    recorded_id,
    lower(tg_op),
    prior,
    next,
    recorded_profile,
    recorded_day
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.log_scorecard_edit() from public;
grant execute on function app_private.log_scorecard_edit() to authenticated;

drop trigger if exists tasks_log_edit on public.tasks;
create trigger tasks_log_edit
  after insert or update or delete on public.tasks
  for each row
  execute function app_private.log_scorecard_edit();

drop trigger if exists day_entries_log_edit on public.day_entries;
create trigger day_entries_log_edit
  after insert or update or delete on public.day_entries
  for each row
  execute function app_private.log_scorecard_edit();

drop trigger if exists bonus_checks_log_edit on public.bonus_checks;
create trigger bonus_checks_log_edit
  after insert or update or delete on public.bonus_checks
  for each row
  execute function app_private.log_scorecard_edit();

-- Puts one logged row back to the values it had before that edit.
-- An insert is undone by deleting the row. A delete is undone by inserting
-- the old row. An update writes the old columns onto the live row.
create or replace function public.restore_edit(target bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry public.edit_log%rowtype;
  task_row public.tasks%rowtype;
  day_row public.day_entries%rowtype;
  check_row public.bonus_checks%rowtype;
begin
  if not app_private.is_staff() then
    raise exception 'Only an admin or commissioner can restore an edit';
  end if;
  select * into entry from public.edit_log where id = target;
  if not found then
    raise exception 'That edit is not in the log';
  end if;

  if entry.action = 'insert' then
    if entry.table_name = 'tasks' then
      delete from public.tasks where id = entry.row_id;
    elsif entry.table_name = 'day_entries' then
      delete from public.day_entries where id = entry.row_id;
    elsif entry.table_name = 'bonus_checks' then
      delete from public.bonus_checks where id = entry.row_id;
    end if;
    return;
  end if;

  if entry.old_row is null then
    raise exception 'That edit has no earlier values to restore';
  end if;

  if entry.table_name = 'tasks' then
    task_row := jsonb_populate_record(null::public.tasks, entry.old_row);
    update public.tasks
    set season_id = task_row.season_id,
        profile_id = task_row.profile_id,
        entry_date = task_row.entry_date,
        slot = task_row.slot,
        title = task_row.title,
        done = task_row.done
    where id = entry.row_id;
    if not found then
      insert into public.tasks (id, season_id, profile_id, entry_date, slot, title, done)
      values (task_row.id, task_row.season_id, task_row.profile_id, task_row.entry_date, task_row.slot, task_row.title, task_row.done)
      on conflict (profile_id, entry_date, slot) do update
      set title = excluded.title,
          done = excluded.done,
          season_id = excluded.season_id;
    end if;
  elsif entry.table_name = 'day_entries' then
    day_row := jsonb_populate_record(null::public.day_entries, entry.old_row);
    update public.day_entries
    set season_id = day_row.season_id,
        profile_id = day_row.profile_id,
        entry_date = day_row.entry_date,
        notes = day_row.notes
    where id = entry.row_id;
    if not found then
      insert into public.day_entries (id, season_id, profile_id, entry_date, notes)
      values (day_row.id, day_row.season_id, day_row.profile_id, day_row.entry_date, day_row.notes)
      on conflict (profile_id, entry_date) do update
      set notes = excluded.notes,
          season_id = excluded.season_id;
    end if;
  elsif entry.table_name = 'bonus_checks' then
    check_row := jsonb_populate_record(null::public.bonus_checks, entry.old_row);
    update public.bonus_checks
    set season_id = check_row.season_id,
        profile_id = check_row.profile_id,
        entry_date = check_row.entry_date,
        bonus_id = check_row.bonus_id,
        checked = check_row.checked,
        points_awarded = check_row.points_awarded
    where id = entry.row_id;
    if not found then
      insert into public.bonus_checks (id, season_id, profile_id, entry_date, bonus_id, checked, points_awarded)
      values (check_row.id, check_row.season_id, check_row.profile_id, check_row.entry_date, check_row.bonus_id, check_row.checked, check_row.points_awarded)
      on conflict (profile_id, entry_date, bonus_id) do update
      set checked = excluded.checked,
          points_awarded = excluded.points_awarded,
          season_id = excluded.season_id;
    end if;
  end if;
end;
$$;

revoke all on function public.restore_edit(bigint) from public;
grant execute on function public.restore_edit(bigint) to authenticated;

notify pgrst, 'reload schema';

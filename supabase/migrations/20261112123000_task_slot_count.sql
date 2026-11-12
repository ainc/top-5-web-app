-- SLOT_COUNT and TASK_COLUMNS in src/taskSlots.ts.
-- A new slot changes that constant, one TASK_SLOTS entry, task_slot_count(),
-- and task_write_columns() when the tasks table gains a column.
-- restore_edit reads the column list from here, so it does not keep its own.

create or replace function app_private.task_slot_count()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 5;
$$;

revoke all on function app_private.task_slot_count() from public;
grant execute on function app_private.task_slot_count() to authenticated;

create or replace function app_private.task_write_columns()
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select array['season_id', 'profile_id', 'entry_date', 'slot', 'title', 'done'];
$$;

revoke all on function app_private.task_write_columns() from public;
grant execute on function app_private.task_write_columns() to authenticated;

do $drop$
declare
  existing text;
begin
  select con.conname into existing
  from pg_constraint as con
  join pg_class as rel on rel.oid = con.conrelid
  join pg_namespace as nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'tasks'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%slot%';
  if existing is not null then
    execute format('alter table public.tasks drop constraint %I', existing);
  end if;
end
$drop$;

alter table public.tasks
  add constraint tasks_slot_check
  check (slot between 1 and app_private.task_slot_count());

do $check$
declare
  unknown_columns text;
begin
  select string_agg(column_name, ', ') into unknown_columns
  from unnest(app_private.task_write_columns()) as column_name
  where column_name not in (
    select attribute.attname
    from pg_attribute as attribute
    join pg_class as rel on rel.oid = attribute.attrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tasks'
      and attribute.attnum > 0
      and not attribute.attisdropped
  );
  if unknown_columns is not null then
    raise exception 'task_write_columns has unknown tasks columns: %', unknown_columns;
  end if;
end
$check$;

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
  assignments text;
  refreshed text;
  updated integer;
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
    select string_agg(format('%I = ($1).%I', column_name, column_name), ', ')
      into assignments
    from unnest(app_private.task_write_columns()) as column_name;
    execute format('update public.tasks set %s where id = $2', assignments)
      using task_row, entry.row_id;
    get diagnostics updated = row_count;
    if updated = 0 then
      select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
        into refreshed
      from unnest(app_private.task_write_columns()) as column_name
      where column_name not in ('profile_id', 'entry_date', 'slot');
      execute format(
        'insert into public.tasks select ($1).* on conflict (profile_id, entry_date, slot) do update set %s',
        refreshed
      )
        using task_row;
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

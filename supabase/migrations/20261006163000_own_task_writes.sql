-- A signed-in person can change their own days, tasks, and bonus checks.
-- Admin and commissioner can change anyone's, plus the season setup.
-- Reading stays open so the dashboard still shows the whole roster.
-- The helpers live outside public so the Data API cannot call them.
-- security definer avoids a policy loop: the staff check reads user_roles,
-- and user_roles' own write policy calls the staff check.

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.user_roles as role
      on role.profile_id = profile.id
    where profile.auth_user_id = (select auth.uid())
      and role.role in ('admin', 'commissioner')
  );
$$;

create or replace function app_private.owns_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = target
      and profile.auth_user_id = (select auth.uid())
  );
$$;

revoke all on function app_private.is_staff() from public;
revoke all on function app_private.owns_profile(uuid) from public;
grant execute on function app_private.is_staff() to authenticated;
grant execute on function app_private.owns_profile(uuid) to authenticated;

-- A member may claim an unsigned roster row, and may not rename anyone.
create or replace function app_private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.is_staff() then
    return new;
  end if;
  if new.display_name is distinct from old.display_name then
    raise exception 'Only an admin or commissioner can rename a person';
  end if;
  if old.auth_user_id is not null and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Only an admin or commissioner can change the signed-in account';
  end if;
  return new;
end;
$$;

revoke all on function app_private.protect_profile() from public;
grant execute on function app_private.protect_profile() to authenticated;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row
  execute function app_private.protect_profile();

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_roles', 'seasons', 'teams', 'team_members', 'season_members',
    'scoring_rules', 'bonus_definitions', 'day_entries', 'tasks',
    'bonus_checks', 'week_meta'
  ]
  loop
    execute format('drop policy if exists "public insert" on public.%I', t);
    execute format('drop policy if exists "public update" on public.%I', t);
    execute format('drop policy if exists "public delete" on public.%I', t);
  end loop;
end $$;

create policy "add own or staff profile" on public.profiles
  for insert to authenticated
  with check (
    (select app_private.is_staff())
    or auth_user_id = (select auth.uid())
  );

create policy "update own or unclaimed profile" on public.profiles
  for update to authenticated
  using (
    (select app_private.is_staff())
    or auth_user_id is null
    or auth_user_id = (select auth.uid())
  )
  with check (
    (select app_private.is_staff())
    or auth_user_id = (select auth.uid())
  );

create policy "delete own profile" on public.profiles
  for delete to authenticated
  using (
    (select app_private.is_staff())
    or auth_user_id = (select auth.uid())
  );

create policy "staff insert roles" on public.user_roles
  for insert to authenticated
  with check ((select app_private.is_staff()));

create policy "staff update roles" on public.user_roles
  for update to authenticated
  using ((select app_private.is_staff()))
  with check ((select app_private.is_staff()));

create policy "staff delete roles" on public.user_roles
  for delete to authenticated
  using ((select app_private.is_staff()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'seasons', 'teams', 'team_members', 'scoring_rules', 'bonus_definitions'
  ]
  loop
    execute format(
      'create policy "staff insert" on public.%I for insert to authenticated with check ((select app_private.is_staff()))',
      t
    );
    execute format(
      'create policy "staff update" on public.%I for update to authenticated using ((select app_private.is_staff())) with check ((select app_private.is_staff()))',
      t
    );
    execute format(
      'create policy "staff delete" on public.%I for delete to authenticated using ((select app_private.is_staff()))',
      t
    );
  end loop;
end $$;

create policy "join own roster" on public.season_members
  for insert to authenticated
  with check (
    (select app_private.is_staff())
    or (select app_private.owns_profile(profile_id))
  );

create policy "staff update roster" on public.season_members
  for update to authenticated
  using ((select app_private.is_staff()))
  with check ((select app_private.is_staff()));

create policy "staff delete roster" on public.season_members
  for delete to authenticated
  using ((select app_private.is_staff()));

do $$
declare
  t text;
begin
  foreach t in array array['day_entries', 'tasks', 'bonus_checks']
  loop
    execute format(
      'create policy "write own tasks" on public.%I for insert to authenticated with check ((select app_private.is_staff()) or (select app_private.owns_profile(profile_id)))',
      t
    );
    execute format(
      'create policy "update own tasks" on public.%I for update to authenticated using ((select app_private.is_staff()) or (select app_private.owns_profile(profile_id))) with check ((select app_private.is_staff()) or (select app_private.owns_profile(profile_id)))',
      t
    );
    execute format(
      'create policy "delete own tasks" on public.%I for delete to authenticated using ((select app_private.is_staff()) or (select app_private.owns_profile(profile_id)))',
      t
    );
  end loop;
end $$;

-- A task save also stores the week label. That label is not someone else's tasks.
create policy "save week label" on public.week_meta
  for insert to authenticated
  with check (true);

create policy "update week label" on public.week_meta
  for update to authenticated
  using (true)
  with check (true);

create policy "staff delete week label" on public.week_meta
  for delete to authenticated
  using ((select app_private.is_staff()));

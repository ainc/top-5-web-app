-- A member edits their own tasks, today or on a past day.
-- A commissioner or an admin edits anyone's tasks, creates teams, moves
-- players between teams, and sets scoring rules and point values.
-- Only an admin assigns roles. is_staff() stays admin or commissioner.

create or replace function app_private.is_admin()
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
      and role.role = 'admin'
  );
$$;

revoke all on function app_private.is_admin() from public;
grant execute on function app_private.is_admin() to authenticated;

drop policy if exists "staff insert roles" on public.user_roles;
drop policy if exists "staff update roles" on public.user_roles;
drop policy if exists "staff delete roles" on public.user_roles;

create policy "admin insert roles" on public.user_roles
  for insert to authenticated
  with check ((select app_private.is_admin()));

create policy "admin update roles" on public.user_roles
  for update to authenticated
  using ((select app_private.is_admin()))
  with check ((select app_private.is_admin()));

create policy "admin delete roles" on public.user_roles
  for delete to authenticated
  using ((select app_private.is_admin()));

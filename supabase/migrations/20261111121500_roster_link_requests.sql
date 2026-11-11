-- A Google first name is not enough to claim a roster row.
-- "Logan Zakeri" used to attach to the only unsigned row named Logan, or,
-- when two Logans existed, sign-in created a second person and said nothing.
-- Exact email and exact display name still claim. A first-name collision
-- records the waiting account, tells that person to wait, and puts one
-- line at the top of the staff inbox. An admin attaches it, or adds a new
-- person, from the roster. The New signups switch does not hide this line.

create table if not exists public.roster_link_requests (
  auth_user_id uuid primary key,
  email text not null,
  google_name text not null,
  match_names text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.roster_link_requests enable row level security;
revoke all on public.roster_link_requests from anon, authenticated;
grant select on public.roster_link_requests to authenticated;

drop policy if exists "staff read roster link requests" on public.roster_link_requests;
create policy "staff read roster link requests" on public.roster_link_requests
  for select to authenticated
  using ((select app_private.is_staff()));

create or replace function app_private.hold_roster_link(google_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  mail text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  first text := split_part(btrim(coalesce(google_name, '')), ' ', 1);
  names text;
  notice_id bigint;
  notice_body text;
begin
  if uid is null then
    raise exception 'Sign in before checking the roster';
  end if;
  -- A one-word Google name is handled by the exact display-name match.
  if char_length(first) < 2 or lower(first) = lower(btrim(coalesce(google_name, ''))) then
    return null;
  end if;

  select string_agg(profile.display_name, ', ' order by profile.display_name)
  into names
  from public.profiles as profile
  where profile.auth_user_id is null
    and lower(btrim(profile.display_name)) = lower(first);

  if names is null then
    return null;
  end if;

  insert into public.roster_link_requests (auth_user_id, email, google_name, match_names, resolved_at)
  values (uid, mail, btrim(google_name), names, null)
  on conflict (auth_user_id) do update
    set email = excluded.email,
        google_name = excluded.google_name,
        match_names = excluded.match_names,
        created_at = now(),
        resolved_at = null;

  notice_body := btrim(google_name)
    || case when mail = '' then '' else ' (' || mail || ')' end
    || ' matches the roster name '
    || names
    || '. Attach this Google account on the roster, or add them as a new person.';

  insert into public.notifications (kind, title, body, href, dedupe_key)
  values (
    'signup',
    'Attach a Google account',
    notice_body,
    '/admin#roster-links',
    'roster-link:' || uid::text
  )
  on conflict (dedupe_key) do update
    set title = excluded.title,
        body = excluded.body,
        href = excluded.href,
        created_at = now()
  returning id into notice_id;

  delete from public.notification_reads
  where notification_id = notice_id;

  return names;
end;
$$;

revoke all on function app_private.hold_roster_link(text) from public;
grant execute on function app_private.hold_roster_link(text) to authenticated;

create or replace function public.hold_roster_link(google_name text)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.hold_roster_link(google_name);
$$;

revoke all on function public.hold_roster_link(text) from public, anon;
grant execute on function public.hold_roster_link(text) to authenticated;

create or replace function app_private.attach_roster_link(target_auth uuid, target_profile uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select app_private.is_admin()) then
    raise exception 'Only an admin can attach a Google account';
  end if;
  if not exists (
    select 1
    from public.roster_link_requests as request
    where request.auth_user_id = target_auth
      and request.resolved_at is null
  ) then
    raise exception 'That Google account is not waiting for a roster name';
  end if;
  if exists (
    select 1 from public.profiles where auth_user_id = target_auth and id <> target_profile
  ) then
    raise exception 'That Google account is already on a roster name';
  end if;

  update public.profiles
  set auth_user_id = target_auth
  where id = target_profile
    and auth_user_id is null;
  if not found then
    raise exception 'Choose an unsigned roster name';
  end if;

  update public.roster_link_requests
  set resolved_at = now()
  where auth_user_id = target_auth;
end;
$$;

revoke all on function app_private.attach_roster_link(uuid, uuid) from public;
grant execute on function app_private.attach_roster_link(uuid, uuid) to authenticated;

create or replace function public.attach_roster_link(target_auth uuid, target_profile uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app_private.attach_roster_link(target_auth, target_profile);
end;
$$;

revoke all on function public.attach_roster_link(uuid, uuid) from public, anon;
grant execute on function public.attach_roster_link(uuid, uuid) to authenticated;

-- The colliding first name was the wrong person. Keep their Google name
-- as a new roster row and clear the waiting request.
create or replace function app_private.open_roster_link(target_auth uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_name text;
begin
  if not (select app_private.is_admin()) then
    raise exception 'Only an admin can add this Google account';
  end if;

  select btrim(google_name) into request_name
  from public.roster_link_requests
  where auth_user_id = target_auth
    and resolved_at is null;
  if request_name is null or request_name = '' then
    raise exception 'That Google account is not waiting for a roster name';
  end if;
  if exists (select 1 from public.profiles where auth_user_id = target_auth) then
    raise exception 'That Google account is already on a roster name';
  end if;

  insert into public.profiles (display_name, auth_user_id)
  values (request_name, target_auth);

  update public.roster_link_requests
  set resolved_at = now()
  where auth_user_id = target_auth;
end;
$$;

revoke all on function app_private.open_roster_link(uuid) from public;
grant execute on function app_private.open_roster_link(uuid) to authenticated;

create or replace function public.open_roster_link(target_auth uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app_private.open_roster_link(target_auth);
end;
$$;

revoke all on function public.open_roster_link(uuid) from public, anon;
grant execute on function public.open_roster_link(uuid) to authenticated;

notify pgrst, 'reload schema';

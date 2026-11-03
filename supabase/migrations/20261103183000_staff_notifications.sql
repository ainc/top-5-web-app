-- Staff inbox. Admins and commissioners share one feed. Members never see it.
--
-- Three kinds, each with an on/off switch:
--   signup      someone signs in for the first time (a new profile, or a
--               roster row that just gained a Google account)
--   team        a team is created on the live season, or someone is placed
--               on a team there. Draft copies stay quiet, so planning the
--               next season does not fill the inbox.
--   season_end  one reminder during the last 7 days of the live season
--
-- A locked switch is the admin override. Commissioners can flip an unlocked
-- switch. Only an admin can lock one, and only an admin can move it after that.
-- Turning a kind off stops new rows. Rows already in the feed stay.
-- Nothing is backfilled. Signups from before this migration are not replayed.

create table if not exists public.notification_settings (
  kind text primary key check (kind in ('signup', 'team', 'season_end')),
  enabled boolean not null default true,
  locked boolean not null default false
);

insert into public.notification_settings (kind, enabled, locked)
values
  ('signup', true, false),
  ('team', true, false),
  ('season_end', true, false)
on conflict (kind) do nothing;

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('signup', 'team', 'season_end')),
  title text not null,
  body text not null,
  href text,
  -- Same key twice is one event. Signups and the season reminder use this.
  -- Team moves do not, so a second assignment is a second line.
  dedupe_key text unique
);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

-- One read mark per staff member. The badge is rows they have not marked.
create table if not exists public.notification_reads (
  notification_id bigint not null references public.notifications (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

create index if not exists notification_reads_profile_idx
  on public.notification_reads (profile_id);

alter table public.notification_settings enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

revoke all on public.notification_settings from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_reads from anon, authenticated;

grant select, update on public.notification_settings to authenticated;
grant select on public.notifications to authenticated;
grant select, insert on public.notification_reads to authenticated;

drop policy if exists "staff read notification settings" on public.notification_settings;
create policy "staff read notification settings" on public.notification_settings
  for select to authenticated
  using ((select app_private.is_staff()));

-- The lock itself is enforced by the trigger below. Row level security only
-- keeps members out. A commissioner update of a locked row is rejected there
-- with a clear error instead of a silent zero-row update.
drop policy if exists "staff update notification settings" on public.notification_settings;
create policy "staff update notification settings" on public.notification_settings
  for update to authenticated
  using ((select app_private.is_staff()))
  with check ((select app_private.is_staff()));

drop policy if exists "staff read notifications" on public.notifications;
create policy "staff read notifications" on public.notifications
  for select to authenticated
  using ((select app_private.is_staff()));

drop policy if exists "staff read own notification marks" on public.notification_reads;
create policy "staff read own notification marks" on public.notification_reads
  for select to authenticated
  using (
    (select app_private.is_staff())
    and (select app_private.owns_profile(profile_id))
  );

drop policy if exists "staff mark own notifications" on public.notification_reads;
create policy "staff mark own notifications" on public.notification_reads
  for insert to authenticated
  with check (
    (select app_private.is_staff())
    and (select app_private.owns_profile(profile_id))
  );

-- Writes the feed. Triggers and the season reminder call this. It is not
-- granted to the browser, so a session cannot insert a fake line.
create or replace function app_private.post_notification(
  notice_kind text,
  notice_title text,
  notice_body text,
  notice_href text,
  notice_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.notification_settings as setting
    where setting.kind = notice_kind
      and setting.enabled
  ) then
    return;
  end if;

  insert into public.notifications (kind, title, body, href, dedupe_key)
  values (notice_kind, notice_title, notice_body, notice_href, notice_key)
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function app_private.post_notification(text, text, text, text, text) from public;

create or replace function app_private.notify_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.auth_user_id is null then
      return new;
    end if;
    perform app_private.post_notification(
      'signup',
      'New signup',
      btrim(new.display_name) || ' joined.',
      null,
      'signup:' || new.id::text
    );
    return new;
  end if;

  -- Claiming a roster row is the same event as a brand-new profile.
  if old.auth_user_id is not null or new.auth_user_id is null then
    return new;
  end if;
  perform app_private.post_notification(
    'signup',
    'New signup',
    btrim(new.display_name) || ' signed in.',
    null,
    'signup:' || new.id::text
  );
  return new;
end;
$$;

revoke all on function app_private.notify_signup() from public;

drop trigger if exists profiles_notify_signup on public.profiles;
create trigger profiles_notify_signup
  after insert or update of auth_user_id on public.profiles
  for each row
  execute function app_private.notify_signup();

create or replace function app_private.notify_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  season_status text;
begin
  select status into season_status
  from public.seasons
  where id = new.season_id;
  if season_status is distinct from 'active' then
    return new;
  end if;
  perform app_private.post_notification(
    'team',
    'New team',
    btrim(new.name) || ' was added.',
    null,
    'team:' || new.id::text
  );
  return new;
end;
$$;

revoke all on function app_private.notify_team() from public;

drop trigger if exists teams_notify on public.teams;
create trigger teams_notify
  after insert on public.teams
  for each row
  execute function app_private.notify_team();

create or replace function app_private.notify_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  season_status text;
  person_name text;
  team_name text;
begin
  if tg_op = 'UPDATE' and old.team_id is not distinct from new.team_id then
    return new;
  end if;
  select status into season_status
  from public.seasons
  where id = new.season_id;
  if season_status is distinct from 'active' then
    return new;
  end if;
  select btrim(display_name) into person_name
  from public.profiles
  where id = new.profile_id;
  select btrim(name) into team_name
  from public.teams
  where id = new.team_id;
  perform app_private.post_notification(
    'team',
    case when tg_op = 'UPDATE' then 'Team change' else 'Team signup' end,
    case
      when tg_op = 'UPDATE' then person_name || ' moved to ' || team_name || '.'
      else person_name || ' joined ' || team_name || '.'
    end,
    null,
    null
  );
  return new;
end;
$$;

revoke all on function app_private.notify_team_member() from public;

drop trigger if exists team_members_notify on public.team_members;
create trigger team_members_notify
  after insert or update of team_id on public.team_members
  for each row
  execute function app_private.notify_team_member();

-- Last Friday of an 8-week season that starts on a Monday is start + 53 days:
-- (weeks - 1) full weeks, then Thursday-to-Friday is 4 more days.
create or replace function app_private.refresh_season_reminder()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_season public.seasons%rowtype;
  last_day date;
  days_left integer;
begin
  if not (select app_private.is_staff()) then
    return;
  end if;

  select * into open_season
  from public.seasons
  where is_open
  limit 1;
  if not found then
    return;
  end if;

  last_day := open_season.starts_on + ((open_season.length_weeks - 1) * 7 + 4);
  days_left := last_day - current_date;
  if days_left < 0 or days_left > 6 then
    return;
  end if;

  perform app_private.post_notification(
    'season_end',
    open_season.name || ' ends ' || to_char(last_day, 'Mon FMDD'),
    case
      when days_left = 0 then 'The live season ends today.'
      when days_left = 1 then '1 day left in the live season.'
      else days_left::text || ' days left in the live season.'
    end,
    '/admin',
    'season-end:' || open_season.id::text
  );
end;
$$;

revoke all on function app_private.refresh_season_reminder() from public;
grant execute on function app_private.refresh_season_reminder() to authenticated;

create or replace function public.refresh_season_reminder()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app_private.refresh_season_reminder();
end;
$$;

revoke all on function public.refresh_season_reminder() from public, anon;
grant execute on function public.refresh_season_reminder() to authenticated;

-- auth.uid() is null for the database owner. The Admin page always has a
-- session, so a commissioner still cannot unlock a row by calling the API.
create or replace function app_private.guard_notification_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.kind is distinct from old.kind then
    raise exception 'Notification types are fixed';
  end if;
  if old.locked is distinct from new.locked and not (select app_private.is_admin()) then
    raise exception 'Only an admin can lock a notification';
  end if;
  if old.locked and not (select app_private.is_admin()) then
    raise exception 'An admin locked this notification';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_notification_setting() from public;

drop trigger if exists notification_settings_guard on public.notification_settings;
create trigger notification_settings_guard
  before update on public.notification_settings
  for each row
  execute function app_private.guard_notification_setting();

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then
    null;
  when others then
    raise notice 'realtime notifications: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';

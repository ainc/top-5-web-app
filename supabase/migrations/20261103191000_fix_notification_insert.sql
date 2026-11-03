-- The first version of post_notification used parameter names that match the
-- column names. Postgres refused the insert as ambiguous, so a team change
-- could not be recorded. Callers pass the arguments by position, so this
-- replacement keeps the same five text arguments.

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

notify pgrst, 'reload schema';

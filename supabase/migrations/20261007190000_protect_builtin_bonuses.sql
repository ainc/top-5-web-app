-- Top 5, Exercise, and Reading are part of every day. Other bonuses can be
-- retired, which hides the checkbox. Checks already saved keep their points.

create or replace function app_private.protect_builtin_bonus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.key in ('top5', 'exercise', 'reading') then
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

drop trigger if exists bonus_definitions_protect on public.bonus_definitions;
create trigger bonus_definitions_protect
  before update or delete on public.bonus_definitions
  for each row
  execute function app_private.protect_builtin_bonus();

-- A short name shown in place of display_name. The roster name stays the
-- identity used for tasks and sign-in matching. Empty means "use the real name".

alter table public.profiles
  add column if not exists nickname text;

alter table public.profiles
  drop constraint if exists profiles_nickname_trimmed;

alter table public.profiles
  add constraint profiles_nickname_trimmed
  check (nickname is null or char_length(btrim(nickname)) between 1 and 40);

notify pgrst, 'reload schema';

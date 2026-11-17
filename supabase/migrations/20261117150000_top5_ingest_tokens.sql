create table if not exists public.top5_ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.top5_ingest_tokens enable row level security;

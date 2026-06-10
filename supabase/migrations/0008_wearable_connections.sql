-- Wearable OAuth connections (Oura first; Whoop/Garmin later share this table).
-- Stores per-user access/refresh tokens so we can auto-sync objective recovery
-- (HRV, resting HR, sleep) into daily_checkins. Owner-only via RLS.

create table if not exists public.wearable_connections (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null, -- 'oura' | 'whoop' | 'garmin' | ...
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists wearable_connections_user_idx
  on public.wearable_connections (user_id);

drop trigger if exists wearable_connections_set_updated_at on public.wearable_connections;
create trigger wearable_connections_set_updated_at
  before update on public.wearable_connections
  for each row execute function public.set_updated_at();

alter table public.wearable_connections enable row level security;

-- drop-if-exists makes this migration safe to re-run.
drop policy if exists "wearables_select_own" on public.wearable_connections;
drop policy if exists "wearables_insert_own" on public.wearable_connections;
drop policy if exists "wearables_update_own" on public.wearable_connections;
drop policy if exists "wearables_delete_own" on public.wearable_connections;

create policy "wearables_select_own" on public.wearable_connections
  for select using (auth.uid() = user_id);
create policy "wearables_insert_own" on public.wearable_connections
  for insert with check (auth.uid() = user_id);
create policy "wearables_update_own" on public.wearable_connections
  for update using (auth.uid() = user_id);
create policy "wearables_delete_own" on public.wearable_connections
  for delete using (auth.uid() = user_id);

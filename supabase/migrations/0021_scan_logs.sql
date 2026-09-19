-- 0021 - Durable scanner diagnostics without storing camera media.
--
-- A scanner failure can happen before upload, during model analysis, while the
-- athlete corrects a reading, or while the confirmed set is saved. PostHog
-- counters cannot reconstruct that sequence. This append-only event trail
-- groups every stage under one attempt_id so a bad read can be diagnosed from
-- capture through confirmation.
--
-- Photos, video, and base64 frames are deliberately never stored here. The
-- reading is the small structured model response, and details is bounded
-- diagnostic metadata such as an HTTP status or which fields were corrected.

create table if not exists public.scan_logs (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  attempt_id    uuid not null,
  event         text not null check (char_length(event) between 1 and 64),
  stage         text not null check (char_length(stage) between 1 and 64),
  status        text not null check (char_length(status) between 1 and 32),
  capture_mode  text check (capture_mode is null or capture_mode in ('photo', 'video', 'unknown')),
  frame_count   smallint check (frame_count is null or frame_count between 0 and 10),
  duration_ms   integer check (duration_ms is null or duration_ms between 0 and 300000),
  provider      text check (provider is null or char_length(provider) <= 32),
  model         text check (model is null or char_length(model) <= 120),
  reading       jsonb check (reading is null or
                             (jsonb_typeof(reading) = 'object'
                              and octet_length(reading::text) <= 16384)),
  details       jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(details) = 'object'
                         and octet_length(details::text) <= 16384),
  created_at    timestamptz not null default now()
);

create index if not exists scan_logs_user_created_idx
  on public.scan_logs (user_id, created_at desc);
create index if not exists scan_logs_attempt_idx
  on public.scan_logs (attempt_id, created_at asc);
create index if not exists scan_logs_failures_idx
  on public.scan_logs (created_at desc)
  where status = 'failed';

alter table public.scan_logs enable row level security;

drop policy if exists "scan_logs_select_own" on public.scan_logs;
create policy "scan_logs_select_own" on public.scan_logs
  for select using (auth.uid() = user_id);

drop policy if exists "scan_logs_insert_own" on public.scan_logs;
create policy "scan_logs_insert_own" on public.scan_logs
  for insert with check (auth.uid() = user_id);

comment on table public.scan_logs is
  'Append-only scanner diagnostics. Never stores photos, frames, or video.';

notify pgrst, 'reload schema';

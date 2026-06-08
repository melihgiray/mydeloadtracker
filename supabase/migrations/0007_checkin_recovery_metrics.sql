-- Add objective recovery metrics to daily check-ins: resting heart rate and HRV.
-- These feed two new readiness factors (RHR elevation, HRV depression vs the
-- athlete's own baseline) and are the first wearable-sourced inputs — manual for
-- now, auto-synced from Oura/Whoop/Apple Health later. Idempotent.

alter table public.daily_checkins
  add column if not exists resting_hr smallint
    check (resting_hr is null or (resting_hr between 25 and 220));

alter table public.daily_checkins
  add column if not exists hrv smallint
    check (hrv is null or (hrv between 0 and 400));

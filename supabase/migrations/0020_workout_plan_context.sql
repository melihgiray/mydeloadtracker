-- 0020 - Link a completed workout to the exact plan prescription it followed.
--
-- Existing weekly reviews infer adherence from exercise names and dates. That
-- cannot distinguish an unrelated session, a today-only substitution, or a
-- plan that changed after the workout. These nullable additions leave every
-- existing row untouched while new planned workouts can record their context.

alter table public.workout_sessions
  add column if not exists plan_id uuid
    references public.training_plans (id) on delete set null;

alter table public.workout_sessions
  add column if not exists plan_day_id uuid
    references public.plan_days (id) on delete set null;

alter table public.workout_sessions
  add column if not exists plan_snapshot jsonb;

create index if not exists workout_sessions_plan_idx
  on public.workout_sessions (plan_id, performed_at desc)
  where plan_id is not null;

comment on column public.workout_sessions.plan_snapshot is
  'Versioned plan day prescription and today-only substitutions at workout save time.';

-- Kept separate from save_workout_session so production workout saves remain
-- compatible before this migration is applied. A context failure can never
-- roll back or duplicate a workout that was already saved atomically.
create or replace function public.record_workout_plan_context(
  p_session_id uuid,
  p_plan_id uuid,
  p_plan_day_id uuid,
  p_plan_snapshot jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_plan_snapshot is null
     or jsonb_typeof(p_plan_snapshot) <> 'object'
     or p_plan_snapshot ->> 'version' <> '1'
     or jsonb_typeof(p_plan_snapshot -> 'planned') <> 'array'
     or octet_length(p_plan_snapshot::text) > 65536 then
    raise exception 'Plan context is invalid.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.training_plans p
    join public.plan_days d on d.plan_id = p.id
    where p.id = p_plan_id
      and d.id = p_plan_day_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'Plan day not found.' using errcode = '42501';
  end if;

  update public.workout_sessions
  set plan_id = p_plan_id,
      plan_day_id = p_plan_day_id,
      plan_snapshot = p_plan_snapshot
  where id = p_session_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Workout session not found.' using errcode = '42501';
  end if;

  return true;
end;
$$;

revoke all on function public.record_workout_plan_context(uuid, uuid, uuid, jsonb)
  from public;
grant execute on function public.record_workout_plan_context(uuid, uuid, uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

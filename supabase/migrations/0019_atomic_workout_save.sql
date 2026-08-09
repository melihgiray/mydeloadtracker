-- 0019 - Save a workout session and all of its performed sets atomically.
--
-- Log previously made separate client requests for the session and its sets.
-- A failed set insert could leave a new empty session behind. Editing was more
-- dangerous: it deleted the old sets before inserting their replacements, so
-- a rejected replacement could erase the recorded workout.
--
-- A PostgreSQL function is one transaction. Any validation, RLS, foreign-key,
-- or connectivity error rolls the session and set changes back together.

create or replace function public.save_workout_session(
  p_session_id uuid,
  p_performed_at timestamptz,
  p_notes text,
  p_sets jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_sets is null
     or jsonb_typeof(p_sets) <> 'array'
     or jsonb_array_length(p_sets) = 0 then
    raise exception 'At least one performed set is required.' using errcode = '22023';
  end if;

  -- Reject a malformed direct RPC call before changing either table. The table
  -- constraints repeat the important checks, but set_number has no legacy
  -- range constraint and the function is a public application boundary of its
  -- own. Duplicate exercise and set numbers remain allowed for compatibility
  -- with workouts that intentionally contain two blocks of the same movement.
  if exists (
    select 1
    from jsonb_to_recordset(p_sets) as workout_set(
      exercise_id uuid,
      set_number integer,
      reps integer,
      weight numeric,
      rpe numeric
    )
    where exercise_id is null
       or set_number is null or set_number < 1
       or reps is null or reps < 0
       or weight is null or weight < 0
       or (rpe is not null and (rpe < 1 or rpe > 10))
  ) then
    raise exception 'A performed set is invalid.' using errcode = '22023';
  end if;

  if p_session_id is null then
    insert into public.workout_sessions (user_id, performed_at, notes)
    values (auth.uid(), p_performed_at, p_notes)
    returning id into v_session_id;
  else
    update public.workout_sessions
    set performed_at = p_performed_at,
        notes = p_notes
    where id = p_session_id
      and user_id = auth.uid()
    returning id into v_session_id;

    if v_session_id is null then
      raise exception 'Workout session not found.' using errcode = '42501';
    end if;

    delete from public.workout_sets
    where session_id = v_session_id
      and user_id = auth.uid();
  end if;

  insert into public.workout_sets (
    session_id,
    exercise_id,
    user_id,
    set_number,
    reps,
    weight,
    rpe
  )
  select
    v_session_id,
    workout_set.exercise_id,
    auth.uid(),
    workout_set.set_number,
    workout_set.reps,
    workout_set.weight,
    workout_set.rpe
  from jsonb_to_recordset(p_sets) as workout_set(
    exercise_id uuid,
    set_number integer,
    reps integer,
    weight numeric,
    rpe numeric
  );

  return v_session_id;
end;
$$;

revoke all on function public.save_workout_session(uuid, timestamptz, text, jsonb)
  from public;
grant execute on function public.save_workout_session(uuid, timestamptz, text, jsonb)
  to authenticated;

comment on function public.save_workout_session(uuid, timestamptz, text, jsonb) is
  'Atomically creates or edits one owned workout session and its performed sets.';

-- Make the new RPC visible to PostgREST without waiting for its periodic schema
-- refresh. Safe when run from the Supabase SQL editor.
notify pgrst, 'reload schema';

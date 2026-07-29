-- Throwaway Step 2 seed for the account used to test plan rendering.
--
-- Before running this file, replace REPLACE_WITH_TEST_ACCOUNT_EMAIL below.
-- The block fails before changing data when the account or any named global
-- exercise cannot be resolved. It intentionally deactivates the account's
-- current plan because migration 0016 permits only one active plan per user.

do $$
declare
  target_email constant text := 'REPLACE_WITH_TEST_ACCOUNT_EMAIL';
  target_user_id uuid;
  seeded_plan_id uuid;
  missing_exercises text[];
  inserted_exercise_count integer;
begin
  if target_email = 'REPLACE_WITH_TEST_ACCOUNT_EMAIL' then
    raise exception 'Set target_email before running the Step 2 plan seed';
  end if;

  select id
    into target_user_id
    from auth.users
   where lower(email) = lower(target_email);

  if target_user_id is null then
    raise exception 'No auth user found for %', target_email;
  end if;

  select array_agg(required.name order by required.name)
    into missing_exercises
    from (
      values
        ('Bench Press'),
        ('Bent Over Row'),
        ('Shoulder Press'),
        ('Lat Pulldown'),
        ('Squat'),
        ('Romanian Deadlift'),
        ('Leg Extension'),
        ('Seated Leg Curl'),
        ('Incline Dumbbell Bench Press'),
        ('Seated Cable Row'),
        ('Dumbbell Lateral Raise'),
        ('Deadlift'),
        ('Dumbbell Bulgarian Split Squat'),
        ('Standing Calf Raise')
    ) as required(name)
   where not exists (
     select 1
       from public.exercises exercise
      where exercise.user_id is null
        and exercise.name = required.name
        and not exercise.hidden
   );

  if missing_exercises is not null then
    raise exception 'Missing visible global exercises: %', missing_exercises;
  end if;

  delete from public.training_plans
   where user_id = target_user_id
     and name = 'Step 2 Seed: Four-Day Upper/Lower';

  update public.training_plans
     set active = false
   where user_id = target_user_id
     and active;

  insert into public.training_plans (
    user_id,
    name,
    goal,
    split,
    days_per_week,
    session_minutes,
    equipment,
    avoid,
    mesocycle_weeks,
    deload_week,
    notes,
    active
  ) values (
    target_user_id,
    'Step 2 Seed: Four-Day Upper/Lower',
    'both',
    'upper_lower',
    4,
    60,
    array['barbell', 'dumbbell', 'cable', 'machine'],
    '{}',
    5,
    5,
    'Throwaway hand-authored plan for Step 3 log-form development.',
    true
  ) returning id into seeded_plan_id;

  insert into public.plan_days (plan_id, day_index, name, focus)
  values
    (seeded_plan_id, 0, 'Upper A', 'Horizontal push and pull'),
    (seeded_plan_id, 1, 'Lower A', 'Squat and hamstrings'),
    (seeded_plan_id, 2, 'Upper B', 'Incline push and vertical pull'),
    (seeded_plan_id, 3, 'Lower B', 'Hinge and unilateral legs');

  insert into public.plan_exercises (
    plan_day_id,
    exercise_id,
    position,
    sets,
    rep_low,
    rep_high,
    rpe_target,
    rest_seconds,
    role,
    note
  )
  select
    day.id,
    exercise.id,
    prescription.position,
    prescription.sets,
    prescription.rep_low,
    prescription.rep_high,
    prescription.rpe_target,
    prescription.rest_seconds,
    prescription.role,
    prescription.note
  from (
    values
      (0, 0, 'Bench Press',                     3, 5, 8, 8.0, 180, 'primary',   null),
      (0, 1, 'Bent Over Row',                   3, 6, 10, 8.0, 150, 'primary',   null),
      (0, 2, 'Shoulder Press',                  3, 6, 10, 8.0, 150, 'secondary', null),
      (0, 3, 'Lat Pulldown',                    3, 8, 12, 8.0, 120, 'secondary', null),
      (1, 0, 'Squat',                           3, 5, 8, 8.0, 180, 'primary',   null),
      (1, 1, 'Romanian Deadlift',               3, 6, 10, 8.0, 180, 'primary',   null),
      (1, 2, 'Leg Extension',                   3, 10, 15, 8.0, 90, 'isolation', null),
      (1, 3, 'Seated Leg Curl',                 3, 10, 15, 8.0, 90, 'isolation', null),
      (2, 0, 'Incline Dumbbell Bench Press',    3, 8, 12, 8.0, 150, 'primary',   null),
      (2, 1, 'Lat Pulldown',                    3, 8, 12, 8.0, 120, 'primary',   null),
      (2, 2, 'Seated Cable Row',                3, 8, 12, 8.0, 120, 'secondary', null),
      (2, 3, 'Dumbbell Lateral Raise',          3, 12, 20, 8.0, 75, 'isolation', null),
      (3, 0, 'Deadlift',                        3, 3, 6, 8.0, 210, 'primary',   null),
      (3, 1, 'Dumbbell Bulgarian Split Squat',  3, 8, 12, 8.0, 120, 'secondary', 'Reps are per leg.'),
      (3, 2, 'Leg Extension',                   3, 10, 15, 8.0, 90, 'isolation', null),
      (3, 3, 'Standing Calf Raise',             3, 10, 15, 8.0, 90, 'isolation', null)
  ) as prescription(
    day_index,
    position,
    exercise_name,
    sets,
    rep_low,
    rep_high,
    rpe_target,
    rest_seconds,
    role,
    note
  )
  join public.plan_days day
    on day.plan_id = seeded_plan_id
   and day.day_index = prescription.day_index
  join public.exercises exercise
    on exercise.user_id is null
   and exercise.name = prescription.exercise_name
   and not exercise.hidden;

  get diagnostics inserted_exercise_count = row_count;
  if inserted_exercise_count <> 16 then
    raise exception 'Expected 16 plan exercises, inserted %', inserted_exercise_count;
  end if;
end
$$;

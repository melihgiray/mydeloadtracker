-- Throwaway seed: one 4-day upper/lower plan, so the Log integration has
-- something real to render before the AI generator exists.
--
-- This is NOT a migration. It is disposable test data and it targets a single
-- account by email. Delete it once /api/plan can generate a plan.
--
-- Re-runnable: it removes its own previous copy first, matched by plan name.
-- Exercises are resolved BY NAME against the global library rather than by
-- hardcoded uuid, so this survives a library re-seed. Every name below was
-- verified present and not hidden via a REST query before this file was
-- written; a name that stops resolving raises rather than inserting a
-- half-built plan.

do $$
declare
  -- Change this to seed a different account.
  v_email text := 'uitester2026@gmail.com';
  v_name  text := 'Upper / Lower 4-Day (seed)';
  v_user  uuid;
  v_plan  uuid;
  v_want  int;
  v_got   int;
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'No account for %. Sign in once, then re-run.', v_email;
  end if;

  delete from public.training_plans where user_id = v_user and name = v_name;

  insert into public.training_plans
    (user_id, name, goal, split, days_per_week, session_minutes,
     equipment, avoid, mesocycle_weeks, deload_week, notes, active)
  values
    (v_user, v_name, 'both', 'upper_lower', 4, 75,
     array['barbell','dumbbell','machine','cable','bodyweight'], array[]::text[],
     5, 5, 'Seeded by hand to build the Log integration against.', true)
  returning id into v_plan;

  insert into public.plan_days (plan_id, day_index, name, focus) values
    (v_plan, 0, 'Upper A', 'chest, shoulders, back, arms'),
    (v_plan, 1, 'Lower A', 'quads, hamstrings, calves, core'),
    (v_plan, 2, 'Upper B', 'back, chest, shoulders, arms'),
    (v_plan, 3, 'Lower B', 'posterior chain, quads, calves, core');

  -- day_index, exercise name, position, sets, rep_low, rep_high, rpe, rest, role
  with spec (day_index, ex_name, position, sets, rep_low, rep_high, rpe, rest, role) as (
    values
      -- Upper A, press emphasis
      (0, 'Bench Press',                 0, 4,  5,  8, 8.0, 180, 'primary'),
      (0, 'Shoulder Press',              1, 3,  6, 10, 8.0, 150, 'secondary'),
      (0, 'Chest-Supported Row',         2, 4,  8, 12, 8.0, 120, 'secondary'),
      (0, 'Dumbbell Lateral Raise',      3, 3, 12, 20, 9.0,  60, 'isolation'),
      (0, 'Tricep Pushdown',             4, 3, 10, 15, 9.0,  60, 'isolation'),
      (0, 'Dumbbell Curl',               5, 4, 10, 15, 9.0,  60, 'isolation'),
      -- Lower A, squat emphasis
      (1, 'Squat',                       0, 4,  5,  8, 8.0, 210, 'primary'),
      (1, 'Romanian Deadlift',           1, 3,  8, 12, 8.0, 150, 'secondary'),
      (1, 'Lying Leg Curl',              2, 3, 10, 15, 9.0,  90, 'isolation'),
      (1, 'Leg Extension',               3, 3, 12, 15, 9.0,  90, 'isolation'),
      (1, 'Standing Calf Raise',         4, 4, 10, 15, 9.0,  60, 'isolation'),
      (1, 'Hanging Leg Raise',           5, 3, 10, 15, 8.0,  60, 'isolation'),
      -- Upper B, pull emphasis
      (2, 'Pull Ups',                    0, 4,  5, 10, 8.0, 180, 'primary'),
      (2, 'Incline Bench Press',         1, 4,  6, 10, 8.0, 180, 'secondary'),
      (2, 'Bent Over Row',               2, 3,  8, 12, 8.0, 150, 'secondary'),
      (2, 'Cable Lateral Raise',         3, 3, 12, 20, 9.0,  60, 'isolation'),
      (2, 'Face Pull',                   4, 3, 15, 20, 9.0,  60, 'isolation'),
      (2, 'Overhead Triceps Extension',  5, 3, 10, 15, 9.0,  60, 'isolation'),
      (2, 'Barbell Curl',                6, 4,  8, 12, 9.0,  60, 'isolation'),
      -- Lower B, hinge emphasis
      (3, 'Deadlift',                    0, 3,  3,  6, 8.0, 240, 'primary'),
      (3, 'Sled Leg Press',              1, 3, 10, 15, 8.0, 150, 'secondary'),
      (3, 'Seated Leg Curl',             2, 3, 10, 15, 9.0,  90, 'isolation'),
      (3, 'Seated Calf Raise',           3, 4, 10, 15, 9.0,  60, 'isolation'),
      (3, 'Cable Crunch',                4, 3, 12, 15, 8.0,  60, 'isolation')
  )
  insert into public.plan_exercises
    (plan_day_id, exercise_id, position, sets, rep_low, rep_high,
     rpe_target, rest_seconds, role)
  select d.id, e.id, s.position, s.sets, s.rep_low, s.rep_high,
         s.rpe, s.rest, s.role
  from spec s
  join public.plan_days d
    on d.plan_id = v_plan and d.day_index = s.day_index
  join public.exercises e
    on e.name = s.ex_name
   and e.user_id is null
   and coalesce(e.hidden, false) = false;

  -- Fail loudly if any name failed to resolve, rather than leaving a plan with
  -- silently missing exercises. This is landmine 2 applied to seed data.
  select count(*) into v_got from public.plan_exercises pe
    join public.plan_days d on d.id = pe.plan_day_id
   where d.plan_id = v_plan;
  v_want := 24;
  if v_got <> v_want then
    raise exception 'Seed inserted % of % exercises. A name did not resolve.', v_got, v_want;
  end if;

  raise notice 'Seeded plan % with % exercises across 4 days.', v_plan, v_got;
end $$;

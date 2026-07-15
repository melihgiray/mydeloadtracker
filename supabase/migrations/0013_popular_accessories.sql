-- 0013 - Restore the popular accessory lifts for PPL / Upper-Lower programs.
--
-- Migration 0011 narrowed the picker to the 64 strengthlevel.com lifts, which
-- cut staples like Cable Fly, Face Pull, and Plank. This unhides a curated set
-- of 38 accessories, fixes two missing equipment tags, and inserts the one
-- staple that never existed (Hip Abduction). Idempotent.
--
-- CORRECTION (post-audit): the original header claimed no population standards
-- exist for these accessories. That was wrong; strengthlevel.com publishes
-- full Beginner-Elite tables for most of them. They stay unbanded only until
-- those tables are scraped into strength-standards.json. See
-- docs/EXERCISE_DATA_NOTES.md.

update public.exercises set hidden = false
  where user_id is null and name in (
    -- Push day
    'Cable Fly',
    'Arnold Press',
    'Front Raise',
    'Cable Lateral Raise',
    'Overhead Triceps Extension',
    'Triceps Kickback',
    'Dumbbell Pullover',
    -- Pull day
    'Face Pull',
    'Rear Delt Fly',
    'Reverse Pec Deck',
    'Chest-Supported Row',
    'Machine Row',
    'Pendlay Row',
    'Straight-Arm Pulldown',
    'Upright Row',
    'Inverted Row',
    'Rack Pull',
    'Cable Curl',
    'Incline Dumbbell Curl',
    'Concentration Curl',
    -- Leg day
    'Walking Lunge',
    'Reverse Lunge',
    'Step-Up',
    'Good Morning',
    'Glute Bridge',
    'Cable Kickback',
    'Seated Calf Raise',
    'Nordic Curl',
    'Kettlebell Swing',
    'Smith Machine Squat',
    -- Core
    'Plank',
    'Side Plank',
    'Hanging Leg Raise',
    'Cable Crunch',
    'Russian Twist',
    'Ab Wheel Rollout',
    'Bicycle Crunch',
    'Back Extension'
  );

-- Two early-seed rows never got an equipment tag.
update public.exercises set equipment = 'cable'
  where user_id is null and name = 'Face Pull' and (equipment is null or equipment = '');
update public.exercises set equipment = 'dumbbell'
  where user_id is null and name = 'Walking Lunge' and (equipment is null or equipment = '');

-- The one genuinely missing staple: the abduction machine (we only had adduction).
insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
  select null, 'Hip Abduction', 'Glutes', 'Abduction', 'machine', false
  where not exists (
    select 1 from public.exercises where user_id is null and name = 'Hip Abduction'
  );

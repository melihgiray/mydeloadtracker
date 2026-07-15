-- 0015 - Library additions and corrections verified against strengthlevel.com.
--
-- Based on a full audit of the site's exercise list (1,318 entries) with
-- logged-lift counts. Unhides 20 existing rows that rank high on the site,
-- inserts 11 staples that never existed, and retags Walking Lunge to barbell
-- (the site's Walking Lunge entity is barbell; the dumbbell version is the
-- separate Dumbbell Lunge inserted below). Idempotent.

-- Popular variants that already exist, hidden since 0011.
update public.exercises set hidden = false
  where user_id is null and name in (
    'Pistol Squat',            -- 310k lifts on the site
    'Box Squat',               -- 264k
    'Machine Preacher Curl',   -- the site's Machine Bicep Curl, 236k
    'Stiff-Leg Deadlift',      -- 228k
    'Floor Press',             -- 202k
    'Overhead Squat',          -- 168k
    'Lying Leg Raise',         -- 163k
    'Power Snatch',            -- 162k
    'Decline Dumbbell Press',  -- 142k
    'Leg Press Calf Raise',    -- the site's Sled Press Calf Raise, 139k
    'Belt Squat',              -- 136k, lower-back-friendly (on brand for deloads)
    'Cable Pull-Through',      -- 127k
    'Pause Squat',             -- programming staple
    'Deficit Deadlift',        -- 121k
    'Wrist Curl',              -- 175k combined with reverse; forearms gap
    'Reverse Wrist Curl',
    'Seal Row',                -- the site's Bench Pull, 110k
    'Hanging Knee Raise',      -- 86k, regression of Hanging Leg Raise
    'Single-Leg Calf Raise',   -- free-weight calf option
    'Machine Lateral Raise'    -- 99k
  );

-- Genuinely missing staples (site name, muscle, movement, equipment).
insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
select null, v.name, v.muscle_group, v.movement_pattern, v.equipment, false
from (values
  ('Dumbbell Lunge',                 'Quads',      'Lunge',           'dumbbell'),
  ('Dumbbell Romanian Deadlift',     'Hamstrings', 'Hinge',           'dumbbell'),
  ('Barbell Bulgarian Split Squat',  'Quads',      'Lunge',           'barbell'),
  ('Close Grip Lat Pulldown',        'Back',       'Vertical Pull',   'cable'),
  ('Incline Dumbbell Fly',           'Chest',      'Horizontal Push', 'dumbbell'),
  ('Incline Push-Up',                'Chest',      'Horizontal Push', 'bodyweight'),
  ('Decline Push-Up',                'Chest',      'Horizontal Push', 'bodyweight'),
  ('Seated Dip Machine',             'Triceps',    'Elbow Extension', 'machine'),
  ('Lying Dumbbell Tricep Extension','Triceps',    'Elbow Extension', 'dumbbell'),
  ('Cable Overhead Tricep Extension','Triceps',    'Elbow Extension', 'cable'),
  ('Cable Reverse Fly',              'Shoulders',  'Horizontal Pull', 'cable')
) as v(name, muscle_group, movement_pattern, equipment)
where not exists (
  select 1 from public.exercises e where e.user_id is null and e.name = v.name
);

-- The site's Walking Lunge entity is barbell (icon: bar on the back); the
-- dumbbell version is the separate Dumbbell Lunge above.
update public.exercises set equipment = 'barbell'
  where user_id is null and name = 'Walking Lunge';

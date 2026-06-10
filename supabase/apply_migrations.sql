-- MyDeloadTracker: apply migrations 0004–0008 in one go.
-- Assumes initial setup (0001–0003) is already applied. Idempotent; run once.
begin;

-- ===== 0004_expand_exercise_library =====
-- Expand the exercise library and add an `equipment` dimension for more detail.
-- Adds ~70 movements across 13 muscle groups (Quads, Hamstrings, Glutes,
-- Calves, Chest, Back, Shoulders, Traps, Triceps, Biceps, Forearms, Core,
-- Adductors). All new rows are global (user_id = null) and non-major.

-- 1) Add the equipment column.
alter table public.exercises
  add column if not exists equipment text;

-- 2) Backfill equipment for the originally-seeded exercises.
update public.exercises set equipment = 'barbell' where equipment is null and name in
  ('Barbell Back Squat','Barbell Bench Press','Conventional Deadlift','Overhead Press',
   'Front Squat','Romanian Deadlift','Incline Bench Press','Barbell Row','Barbell Curl');
update public.exercises set equipment = 'machine' where equipment is null and name in
  ('Leg Press','Leg Curl','Leg Extension','Standing Calf Raise');
update public.exercises set equipment = 'dumbbell' where equipment is null and name in
  ('Walking Lunge','Dumbbell Bench Press','Lateral Raise','Hammer Curl');
update public.exercises set equipment = 'cable' where equipment is null and name in
  ('Triceps Pushdown','Lat Pulldown','Seated Cable Row','Face Pull');
update public.exercises set equipment = 'bodyweight' where equipment is null and name in
  ('Dip','Pull-Up');

-- 3) Insert the expanded library.
insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
values
  -- Quads
  (null, 'Hack Squat',              'Quads',      'Squat',           'machine',    false),
  (null, 'Goblet Squat',            'Quads',      'Squat',           'kettlebell', false),
  (null, 'Bulgarian Split Squat',   'Quads',      'Lunge',           'dumbbell',   false),
  (null, 'Smith Machine Squat',     'Quads',      'Squat',           'machine',    false),
  (null, 'Step-Up',                 'Quads',      'Lunge',           'dumbbell',   false),
  (null, 'Sissy Squat',             'Quads',      'Knee Extension',  'bodyweight', false),
  (null, 'Pause Squat',             'Quads',      'Squat',           'barbell',    false),
  (null, 'Box Squat',               'Quads',      'Squat',           'barbell',    false),

  -- Hamstrings
  (null, 'Seated Leg Curl',         'Hamstrings', 'Knee Flexion',    'machine',    false),
  (null, 'Lying Leg Curl',          'Hamstrings', 'Knee Flexion',    'machine',    false),
  (null, 'Stiff-Leg Deadlift',      'Hamstrings', 'Hinge',           'barbell',    false),
  (null, 'Good Morning',            'Hamstrings', 'Hinge',           'barbell',    false),
  (null, 'Nordic Curl',             'Hamstrings', 'Knee Flexion',    'bodyweight', false),
  (null, 'Glute-Ham Raise',         'Hamstrings', 'Knee Flexion',    'bodyweight', false),

  -- Glutes
  (null, 'Barbell Hip Thrust',      'Glutes',     'Hinge',           'barbell',    false),
  (null, 'Glute Bridge',            'Glutes',     'Hinge',           'barbell',    false),
  (null, 'Cable Pull-Through',      'Glutes',     'Hinge',           'cable',      false),
  (null, 'Cable Kickback',          'Glutes',     'Hip Extension',   'cable',      false),
  (null, 'Reverse Hyperextension',  'Glutes',     'Hinge',           'machine',    false),

  -- Calves
  (null, 'Seated Calf Raise',       'Calves',     'Ankle Extension', 'machine',    false),
  (null, 'Leg Press Calf Raise',    'Calves',     'Ankle Extension', 'machine',    false),
  (null, 'Donkey Calf Raise',       'Calves',     'Ankle Extension', 'machine',    false),

  -- Chest
  (null, 'Decline Bench Press',     'Chest',      'Horizontal Push', 'barbell',    false),
  (null, 'Incline Dumbbell Press',  'Chest',      'Horizontal Push', 'dumbbell',   false),
  (null, 'Cable Fly',               'Chest',      'Horizontal Push', 'cable',      false),
  (null, 'Pec Deck',                'Chest',      'Horizontal Push', 'machine',    false),
  (null, 'Push-Up',                 'Chest',      'Horizontal Push', 'bodyweight', false),
  (null, 'Machine Chest Press',     'Chest',      'Horizontal Push', 'machine',    false),
  (null, 'Dumbbell Fly',            'Chest',      'Horizontal Push', 'dumbbell',   false),

  -- Back
  (null, 'Pendlay Row',             'Back',       'Horizontal Pull', 'barbell',    false),
  (null, 'T-Bar Row',               'Back',       'Horizontal Pull', 'machine',    false),
  (null, 'Chest-Supported Row',     'Back',       'Horizontal Pull', 'machine',    false),
  (null, 'Single-Arm Dumbbell Row', 'Back',       'Horizontal Pull', 'dumbbell',   false),
  (null, 'Chin-Up',                 'Back',       'Vertical Pull',   'bodyweight', false),
  (null, 'Straight-Arm Pulldown',   'Back',       'Vertical Pull',   'cable',      false),
  (null, 'Rack Pull',               'Back',       'Hinge',           'barbell',    false),
  (null, 'Inverted Row',            'Back',       'Horizontal Pull', 'bodyweight', false),

  -- Shoulders
  (null, 'Seated Dumbbell Press',   'Shoulders',  'Vertical Push',   'dumbbell',   false),
  (null, 'Arnold Press',            'Shoulders',  'Vertical Push',   'dumbbell',   false),
  (null, 'Cable Lateral Raise',     'Shoulders',  'Abduction',       'cable',      false),
  (null, 'Rear Delt Fly',           'Shoulders',  'Horizontal Pull', 'dumbbell',   false),
  (null, 'Reverse Pec Deck',        'Shoulders',  'Horizontal Pull', 'machine',    false),
  (null, 'Upright Row',             'Shoulders',  'Vertical Pull',   'barbell',    false),
  (null, 'Landmine Press',          'Shoulders',  'Vertical Push',   'barbell',    false),
  (null, 'Machine Shoulder Press',  'Shoulders',  'Vertical Push',   'machine',    false),

  -- Traps
  (null, 'Barbell Shrug',           'Traps',      'Shrug',           'barbell',    false),
  (null, 'Dumbbell Shrug',          'Traps',      'Shrug',           'dumbbell',   false),
  (null, 'Farmer''s Carry',         'Traps',      'Carry',           'dumbbell',   false),

  -- Triceps
  (null, 'Skull Crusher',           'Triceps',    'Elbow Extension', 'barbell',    false),
  (null, 'Overhead Triceps Extension','Triceps',  'Elbow Extension', 'dumbbell',   false),
  (null, 'Close-Grip Bench Press',  'Triceps',    'Horizontal Push', 'barbell',    false),
  (null, 'Rope Pushdown',           'Triceps',    'Elbow Extension', 'cable',      false),
  (null, 'Diamond Push-Up',         'Triceps',    'Horizontal Push', 'bodyweight', false),

  -- Biceps
  (null, 'Preacher Curl',           'Biceps',     'Elbow Flexion',   'barbell',    false),
  (null, 'Incline Dumbbell Curl',   'Biceps',     'Elbow Flexion',   'dumbbell',   false),
  (null, 'Cable Curl',              'Biceps',     'Elbow Flexion',   'cable',      false),
  (null, 'Concentration Curl',      'Biceps',     'Elbow Flexion',   'dumbbell',   false),
  (null, 'EZ-Bar Curl',             'Biceps',     'Elbow Flexion',   'barbell',    false),
  (null, 'Spider Curl',             'Biceps',     'Elbow Flexion',   'dumbbell',   false),

  -- Forearms
  (null, 'Wrist Curl',              'Forearms',   'Wrist Flexion',   'barbell',    false),
  (null, 'Reverse Wrist Curl',      'Forearms',   'Wrist Extension', 'barbell',    false),
  (null, 'Reverse Curl',            'Forearms',   'Elbow Flexion',   'barbell',    false),

  -- Core
  (null, 'Hanging Leg Raise',       'Core',       'Hip Flexion',     'bodyweight', false),
  (null, 'Cable Crunch',            'Core',       'Trunk Flexion',   'cable',      false),
  (null, 'Plank',                   'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Ab Wheel Rollout',        'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Russian Twist',           'Core',       'Rotation',        'bodyweight', false),
  (null, 'Decline Sit-Up',          'Core',       'Trunk Flexion',   'bodyweight', false),
  (null, 'Pallof Press',            'Core',       'Anti-Rotation',   'cable',      false),

  -- Adductors
  (null, 'Hip Adduction Machine',   'Adductors',  'Adduction',       'machine',    false)
on conflict do nothing;

-- ===== 0005_standards_and_more_exercises =====
-- Strength-standards support + a larger exercise library.
--
-- 1) Adds bodyweight + sex to profiles so we can band lifts against
--    StrengthLevel-style population standards (see src/lib/analytics/standards.ts)
--    and right-size deload cadence to the athlete's experience level.
-- 2) Makes the global exercise seeds idempotent: there was NO unique constraint
--    on exercise name, so re-running a seed (0002/0004) silently duplicated every
--    global row. A partial unique index fixes that and powers `on conflict`.
-- 3) Adds ~45 more movements (Olympic lifts, more rows/presses, core, carries).
--
-- Safe to run after 0001-0004 in order. Idempotent.

-- ---------------------------------------------------------------------------
-- 1) Profile: bodyweight (in the athlete's logging unit) + sex
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists bodyweight numeric(6, 2) check (bodyweight is null or bodyweight > 0);
alter table public.profiles
  add column if not exists sex text check (sex is null or sex in ('male', 'female'));

-- ---------------------------------------------------------------------------
-- 2) Make the global exercise library de-duplicated + future seeds idempotent.
--    (Defensively ensure the equipment column from 0004 exists, so this file
--    works even if 0004 has not been applied yet.)
-- ---------------------------------------------------------------------------
alter table public.exercises
  add column if not exists equipment text;

create unique index if not exists exercises_global_name_uidx
  on public.exercises (name)
  where user_id is null;

-- ---------------------------------------------------------------------------
-- 3) Expanded library. All global (user_id = null), non-major.
-- ---------------------------------------------------------------------------
insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
values
  -- Olympic / power
  (null, 'Power Clean',             'Back',       'Olympic',         'barbell',    false),
  (null, 'Hang Clean',              'Back',       'Olympic',         'barbell',    false),
  (null, 'Clean and Jerk',          'Back',       'Olympic',         'barbell',    false),
  (null, 'Snatch',                  'Back',       'Olympic',         'barbell',    false),
  (null, 'Push Press',              'Shoulders',  'Vertical Push',   'barbell',    false),
  (null, 'Push Jerk',               'Shoulders',  'Vertical Push',   'barbell',    false),
  (null, 'Clean Pull',              'Back',       'Hinge',           'barbell',    false),

  -- Quads
  (null, 'Trap Bar Deadlift',       'Quads',      'Hinge',           'barbell',    false),
  (null, 'Zercher Squat',           'Quads',      'Squat',           'barbell',    false),
  (null, 'Belt Squat',              'Quads',      'Squat',           'machine',    false),
  (null, 'Pendulum Squat',          'Quads',      'Squat',           'machine',    false),

  -- Hamstrings / glutes
  (null, 'Snatch-Grip Deadlift',    'Hamstrings', 'Hinge',           'barbell',    false),
  (null, 'Deficit Deadlift',        'Hamstrings', 'Hinge',           'barbell',    false),
  (null, 'Single-Leg Romanian Deadlift', 'Hamstrings', 'Hinge',      'dumbbell',   false),
  (null, 'Kettlebell Swing',        'Glutes',     'Hinge',           'kettlebell', false),
  (null, 'Single-Leg Hip Thrust',   'Glutes',     'Hinge',           'bodyweight', false),
  (null, 'Curtsy Lunge',            'Glutes',     'Lunge',           'dumbbell',   false),

  -- Calves
  (null, 'Single-Leg Calf Raise',   'Calves',     'Ankle Extension', 'dumbbell',   false),

  -- Chest
  (null, 'Floor Press',             'Chest',      'Horizontal Push', 'barbell',    false),
  (null, 'Smith Machine Bench Press','Chest',     'Horizontal Push', 'machine',    false),
  (null, 'Incline Cable Fly',       'Chest',      'Horizontal Push', 'cable',      false),

  -- Back
  (null, 'Seal Row',                'Back',       'Horizontal Pull', 'barbell',    false),
  (null, 'Meadows Row',             'Back',       'Horizontal Pull', 'barbell',    false),
  (null, 'Kroc Row',                'Back',       'Horizontal Pull', 'dumbbell',   false),
  (null, 'Behind-the-Neck Pulldown','Back',       'Vertical Pull',   'cable',      false),

  -- Shoulders
  (null, 'Z Press',                 'Shoulders',  'Vertical Push',   'barbell',    false),
  (null, 'Cable Rear Delt Row',     'Shoulders',  'Horizontal Pull', 'cable',      false),
  (null, 'Bradford Press',          'Shoulders',  'Vertical Push',   'barbell',    false),

  -- Traps
  (null, 'Power Shrug',             'Traps',      'Shrug',           'barbell',    false),
  (null, 'Snatch-Grip Shrug',       'Traps',      'Shrug',           'barbell',    false),

  -- Triceps
  (null, 'JM Press',                'Triceps',    'Elbow Extension', 'barbell',    false),
  (null, 'Tate Press',              'Triceps',    'Elbow Extension', 'dumbbell',   false),
  (null, 'Bench Dip',               'Triceps',    'Elbow Extension', 'bodyweight', false),
  (null, 'Triceps Kickback',        'Triceps',    'Elbow Extension', 'dumbbell',   false),

  -- Biceps
  (null, 'Zottman Curl',            'Biceps',     'Elbow Flexion',   'dumbbell',   false),
  (null, 'Drag Curl',               'Biceps',     'Elbow Flexion',   'barbell',    false),
  (null, 'Bayesian Cable Curl',     'Biceps',     'Elbow Flexion',   'cable',      false),

  -- Forearms
  (null, 'Wrist Roller',            'Forearms',   'Wrist Flexion',   'other',      false),
  (null, 'Plate Pinch',             'Forearms',   'Grip',            'other',      false),

  -- Core
  (null, 'Crunch',                  'Core',       'Trunk Flexion',   'bodyweight', false),
  (null, 'Bicycle Crunch',          'Core',       'Rotation',        'bodyweight', false),
  (null, 'Side Plank',              'Core',       'Anti-Lateral Flexion', 'bodyweight', false),
  (null, 'Dragon Flag',             'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Toes-to-Bar',             'Core',       'Hip Flexion',     'bodyweight', false),
  (null, 'Cable Woodchopper',       'Core',       'Rotation',        'cable',      false),
  (null, 'Dead Bug',                'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Hanging Knee Raise',      'Core',       'Hip Flexion',     'bodyweight', false),

  -- Adductors / carries / conditioning
  (null, 'Sumo Squat',              'Adductors',  'Squat',           'dumbbell',   false),
  (null, 'Copenhagen Plank',        'Adductors',  'Anti-Lateral Flexion', 'bodyweight', false),
  (null, 'Suitcase Carry',          'Core',       'Carry',           'dumbbell',   false),
  (null, 'Sled Push',               'Quads',      'Carry',           'machine',    false)
on conflict do nothing;

-- ===== 0006_more_exercises =====
-- Round out the exercise library toward StrengthLevel's catalog (~65 more
-- movements across all muscle groups: more presses/rows/curls, Olympic lifts,
-- unilateral work, core, and strongman). All global (user_id = null), non-major.
--
-- Self-sufficient + idempotent: ensures the equipment column and the partial
-- unique index exist first, so it can run after 0001-0003 even if 0004/0005
-- haven't been applied, and is safe to re-run.

alter table public.exercises
  add column if not exists equipment text;

create unique index if not exists exercises_global_name_uidx
  on public.exercises (name)
  where user_id is null;

insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
values
  -- Chest
  (null, 'Cable Crossover',            'Chest',      'Horizontal Push', 'cable',      false),
  (null, 'Incline Machine Press',      'Chest',      'Horizontal Push', 'machine',    false),
  (null, 'Decline Dumbbell Press',     'Chest',      'Horizontal Push', 'dumbbell',   false),
  (null, 'Spoto Press',                'Chest',      'Horizontal Push', 'barbell',    false),
  (null, 'Dumbbell Pullover',          'Chest',      'Horizontal Push', 'dumbbell',   false),
  (null, 'Plyo Push-Up',               'Chest',      'Horizontal Push', 'bodyweight', false),

  -- Back
  (null, 'Yates Row',                  'Back',       'Horizontal Pull', 'barbell',    false),
  (null, 'Machine Row',                'Back',       'Horizontal Pull', 'machine',    false),
  (null, 'Wide-Grip Pulldown',         'Back',       'Vertical Pull',   'cable',      false),
  (null, 'Neutral-Grip Pulldown',      'Back',       'Vertical Pull',   'cable',      false),
  (null, 'One-Arm Lat Pulldown',       'Back',       'Vertical Pull',   'cable',      false),
  (null, 'Trap Bar Row',               'Back',       'Horizontal Pull', 'barbell',    false),
  (null, 'Back Extension',             'Back',       'Hinge',           'bodyweight', false),
  (null, '45-Degree Hyperextension',   'Back',       'Hinge',           'machine',    false),
  (null, 'Sumo Deadlift',              'Back',       'Hinge',           'barbell',    false),
  (null, 'Jefferson Deadlift',         'Back',       'Hinge',           'barbell',    false),
  (null, 'Atlas Stone',                'Back',       'Hinge',           'other',      false),

  -- Shoulders
  (null, 'Front Raise',                'Shoulders',  'Flexion',         'dumbbell',   false),
  (null, 'Cable Front Raise',          'Shoulders',  'Flexion',         'cable',      false),
  (null, 'Plate Front Raise',          'Shoulders',  'Flexion',         'other',      false),
  (null, 'Machine Lateral Raise',      'Shoulders',  'Abduction',       'machine',    false),
  (null, 'Behind-the-Neck Press',      'Shoulders',  'Vertical Push',   'barbell',    false),
  (null, 'Viking Press',               'Shoulders',  'Vertical Push',   'machine',    false),
  (null, 'Log Press',                  'Shoulders',  'Vertical Push',   'other',      false),
  (null, 'Battle Ropes',               'Shoulders',  'Conditioning',    'other',      false),

  -- Quads
  (null, 'Safety Bar Squat',           'Quads',      'Squat',           'barbell',    false),
  (null, 'Reverse Lunge',              'Quads',      'Lunge',           'dumbbell',   false),
  (null, 'Lateral Lunge',              'Quads',      'Lunge',           'dumbbell',   false),
  (null, 'Pistol Squat',               'Quads',      'Squat',           'bodyweight', false),
  (null, 'Heels-Elevated Goblet Squat','Quads',      'Squat',           'dumbbell',   false),
  (null, 'Vertical Leg Press',         'Quads',      'Squat',           'machine',    false),
  (null, 'Thruster',                   'Quads',      'Squat',           'barbell',    false),
  (null, 'Overhead Squat',             'Quads',      'Squat',           'barbell',    false),
  (null, 'Box Jump',                   'Quads',      'Jump',            'bodyweight', false),

  -- Hamstrings / glutes
  (null, 'Cable Romanian Deadlift',    'Hamstrings', 'Hinge',           'cable',      false),
  (null, 'Kettlebell Deadlift',        'Hamstrings', 'Hinge',           'kettlebell', false),
  (null, 'B-Stance Hip Thrust',        'Glutes',     'Hinge',           'barbell',    false),
  (null, 'Hip Thrust Machine',         'Glutes',     'Hinge',           'machine',    false),
  (null, 'Frog Pump',                  'Glutes',     'Hinge',           'bodyweight', false),

  -- Calves
  (null, 'Smith Machine Calf Raise',   'Calves',     'Ankle Extension', 'machine',    false),
  (null, 'Tibialis Raise',             'Calves',     'Ankle Flexion',   'bodyweight', false),

  -- Triceps
  (null, 'California Press',            'Triceps',    'Elbow Extension', 'barbell',    false),
  (null, 'Board Press',                'Triceps',    'Horizontal Push', 'barbell',    false),
  (null, 'Reverse-Grip Pushdown',      'Triceps',    'Elbow Extension', 'cable',      false),
  (null, 'Single-Arm Pushdown',        'Triceps',    'Elbow Extension', 'cable',      false),

  -- Biceps
  (null, 'Dumbbell Curl',              'Biceps',     'Elbow Flexion',   'dumbbell',   false),
  (null, 'Cross-Body Hammer Curl',     'Biceps',     'Elbow Flexion',   'dumbbell',   false),
  (null, 'Machine Preacher Curl',      'Biceps',     'Elbow Flexion',   'machine',    false),
  (null, 'Cable Hammer Curl',          'Biceps',     'Elbow Flexion',   'cable',      false),

  -- Forearms
  (null, 'Behind-the-Back Wrist Curl', 'Forearms',   'Wrist Flexion',   'barbell',    false),
  (null, 'Hand Gripper',               'Forearms',   'Grip',            'other',      false),

  -- Traps
  (null, 'Trap Bar Shrug',             'Traps',      'Shrug',           'barbell',    false),
  (null, 'Cable Shrug',                'Traps',      'Shrug',           'cable',      false),
  (null, 'Yoke Carry',                 'Traps',      'Carry',           'other',      false),

  -- Core
  (null, 'Sit-Up',                     'Core',       'Trunk Flexion',   'bodyweight', false),
  (null, 'V-Up',                       'Core',       'Trunk Flexion',   'bodyweight', false),
  (null, 'Lying Leg Raise',            'Core',       'Hip Flexion',     'bodyweight', false),
  (null, 'Flutter Kicks',              'Core',       'Hip Flexion',     'bodyweight', false),
  (null, 'Mountain Climber',           'Core',       'Hip Flexion',     'bodyweight', false),
  (null, 'Hollow Hold',                'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Bird Dog',                   'Core',       'Anti-Extension',  'bodyweight', false),
  (null, 'Cable Side Bend',            'Core',       'Lateral Flexion', 'cable',      false),
  (null, 'Windshield Wiper',           'Core',       'Rotation',        'bodyweight', false),
  (null, 'Burpee',                     'Core',       'Conditioning',    'bodyweight', false),

  -- Olympic / power
  (null, 'Power Snatch',               'Back',       'Olympic',         'barbell',    false),
  (null, 'Hang Snatch',                'Back',       'Olympic',         'barbell',    false),
  (null, 'Snatch Pull',                'Back',       'Hinge',           'barbell',    false),
  (null, 'Split Jerk',                 'Shoulders',  'Olympic',         'barbell',    false),
  (null, 'Clean and Press',            'Shoulders',  'Olympic',         'barbell',    false),

  -- Adductors
  (null, 'Cossack Squat',              'Adductors',  'Squat',           'dumbbell',   false)
on conflict do nothing;

-- ===== 0007_checkin_recovery_metrics =====
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

-- ===== 0008_wearable_connections =====
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

commit;

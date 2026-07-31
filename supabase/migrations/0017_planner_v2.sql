-- 0017 - Planner v2 foundations: self-reported bests, training style, and a
-- revision history so a plan can be edited rather than only replaced.
--
-- See docs/PLANNER_V2_DESIGN.md. Three independent additions:
--
--   athlete_lifts    what the athlete says they can lift, for cold start
--   plan_revisions   every change to a plan, so edits are undoable
--   training_plans   two new columns: training style, and last review date
--
-- Idempotent, and RLS-owned like every other user table.

-- ---------------------------------------------------------------------------
-- Self-reported bests
-- ---------------------------------------------------------------------------
--
-- A first-time athlete has no logged history, so the weak-point assessment has
-- nothing to compare and hands them a generic plan. Asking for a few bests
-- fixes that on day one.
--
-- These are DELIBERATELY NOT rows in workout_sets. Writing them there would
-- fabricate training sessions that never happened, and those fake sessions
-- would then flow into weekly volume, readiness, deload detection and the
-- history screen as though the athlete had trained. Golden rule 4.
--
-- Weight and reps rather than a 1RM: nobody knows their true 1RM, and asking
-- for one invites a made-up number. estimate1RM converts at read time.

create table if not exists public.athlete_lifts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  exercise_id  uuid not null references public.exercises (id),
  weight       numeric(6, 2) not null check (weight >= 0),
  reps         smallint not null check (reps between 1 and 100),
  -- 'self_reported' now; 'logged' is reserved for a future promotion path when
  -- an athlete beats a claimed best in a real session.
  source       text not null default 'self_reported'
                 check (source in ('self_reported', 'logged')),
  recorded_on  date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One claimed best per lift per athlete. Re-entering updates rather than
  -- accumulating a pile of stale claims.
  unique (user_id, exercise_id)
);

create index if not exists athlete_lifts_user_idx on public.athlete_lifts (user_id);

drop trigger if exists athlete_lifts_set_updated_at on public.athlete_lifts;
create trigger athlete_lifts_set_updated_at
  before update on public.athlete_lifts
  for each row execute function public.set_updated_at();

alter table public.athlete_lifts enable row level security;

drop policy if exists "athlete_lifts_own" on public.athlete_lifts;
create policy "athlete_lifts_own" on public.athlete_lifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Plan revisions
-- ---------------------------------------------------------------------------
--
-- Every change to a plan, whether from a tap, a sentence, or the weekly review,
-- is recorded as a revision. This is what makes editing undoable and the weekly
-- review non-destructive by construction, and it gives the athlete a readable
-- history of how their plan got here.
--
-- `ops` is the patch that produced this revision, `snapshot` is the whole plan
-- after applying it. Storing both means undo is a restore rather than an
-- inverse-operation replay, which is far harder to get right.

create table if not exists public.plan_revisions (
  id         uuid primary key default uuid_generate_v4(),
  plan_id    uuid not null references public.training_plans (id) on delete cascade,
  revision   integer not null,
  -- athlete_direct: a tap in the UI. athlete_chat: asked the coach.
  -- weekly_review: the coach proposed it and the athlete accepted.
  -- generated: the original plan, revision 0.
  source     text not null
               check (source in ('generated', 'athlete_direct', 'athlete_chat', 'weekly_review')),
  ops        jsonb not null default '[]'::jsonb,
  snapshot   jsonb not null,
  summary    text,
  created_at timestamptz not null default now(),
  unique (plan_id, revision)
);

create index if not exists plan_revisions_plan_idx on public.plan_revisions (plan_id, revision desc);

alter table public.plan_revisions enable row level security;

-- Revisions inherit ownership through their plan, the same pattern plan_days
-- and plan_exercises already use.
drop policy if exists "plan_revisions_own" on public.plan_revisions;
create policy "plan_revisions_own" on public.plan_revisions
  for all using (
    exists (select 1 from public.training_plans p
            where p.id = plan_revisions.plan_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.training_plans p
            where p.id = plan_revisions.plan_id and p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Training style and weekly review
-- ---------------------------------------------------------------------------
--
-- The app used to pick set counts and effort for the athlete. No trial supports
-- a specific number (docs/PLANNER_EVIDENCE.md, Q4 returned no_source), so
-- asking is both more honest and better supported than prescribing.
--
--   few_hard   about 2 working sets, taken to or very near failure
--   balanced   about 3 sets, stopping a rep or two short
--   more_volume  4 or more sets, stopping two to three reps short
--
-- Null means not asked yet, which is different from 'balanced' and must stay
-- distinguishable so the intake knows whether to ask.

alter table public.training_plans
  add column if not exists training_style text
    check (training_style in ('few_hard', 'balanced', 'more_volume'));

-- Drives the weekly review prompt. Null means never reviewed, so the first
-- review offer is keyed off started_on instead.
alter table public.training_plans
  add column if not exists last_reviewed_on date;

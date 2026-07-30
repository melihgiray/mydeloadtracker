# Planner handoff: what to build, and who builds it

Written 2026-07-29 by Claude (Fable) as the planning and audit pass. Read
`CLAUDE.md`, `ARCHITECTURE.md`, and `docs/PLANNER_DESIGN.md` first. This
document supersedes the build order in PLANNER_DESIGN.md, for the reason in
the next section.

## Status, updated 2026-07-30

| Step | State | Owner |
|------|-------|-------|
| 1. Migration 0016 | DONE, applied and verified by REST | founder |
| 2. Plan data layer plus seed | DONE, on main | Claude |
| 3. Log integration | DONE, on main, verified at 393x852 | Claude |
| 4. Intake plus /api/plan | DONE, merged as `c3f3902` | Terra |
| 5. plan-validation.ts | DONE, merged, F5 fixed at `9ce98a4` | Terra, F5 by Claude |
| 6. Deload adaptation | DONE, audited at `dfe0d6d`, verified at 393x852 | Terra |

## Step 6 closure

The planner now adapts today's Log prescription from either of two signals:
the plan's explicit `deload_week`, or an earlier recommendation from the
existing deload analytics. A plan week is anchored to `started_on` and repeats
with the mesocycle. During an active deload, planned sets are cut roughly in
half, loaded exercises with history use progression's existing 15 percent load
reduction, and prescribed effort is capped at RPE 6. The Log screen states the
reason and the changes rather than quietly swapping numbers.

Verified on 2026-07-30 with 182 passing tests, clean typecheck, and a successful
production build. The active-deload code path was simulated locally at 393 by
852 against the seeded test plan. It rendered 2 sets at RPE 6 instead of 4 at
RPE 8, had no browser errors or framework overlay, and measured 378 pixels of
document width inside the 393 pixel viewport.

**Read this table before dispatching anyone.** Steps 2 and 3 were both built
twice, once by Claude on main and once by Terra in PR #2, because the Step 2
brief stayed live after Claude took the work. Two implementations of one file
is the shared-state failure this document warns about, produced by this
document. The table is the fix: it is the single owner-of-record, and it gets
updated the moment a step is claimed.

PR #3 (step 4) is audited in `docs/AUDIT_2026-07-29_pr3.md`. Strong work with
one blocking defect: local plan generation cannot finish inside the coach's 25s
timeout, because that number was written for a streaming call. The planner now
has its own opt-in-only surface in `ai-provider.ts`, added on main at `9bdbc7e`
so the remaining fix lives entirely inside Terra's own route.

PR #2 is closed rather than merged. Not because it was worse: it caught a real
missing rollback in `createPlan`, which is now on main at `e848bda` with the
compensation approach and test harness credited to it. It is closed because
step 3 depends on four API decisions main makes differently, so merging would
break the working Log screen.

## Why the order changed

PLANNER_DESIGN.md builds AI generation first and Log integration sixth. That
is backwards for this product.

The founder's actual goal is a logging app with so little friction that a
gymrat uses it every session: open the app, today's session is already there,
tap to log. That is the sixth item. Everything before it is plumbing for a
screen nobody has felt yet.

So the plan is seeded by hand first, the Log integration is built against it,
and the AI generator arrives once the screen is proven worth feeding. If
prefilled logging does not feel frictionless, the generator would have been
built for nothing.

**Revised order:**

1. Migration 0016 applied and verified. Founder's hands, blocks everything.
2. Plan data layer plus one hand-seeded plan.
3. **Log integration.** The whole point. Prove the friction claim here.
4. Intake UI plus `/api/plan` generation.
5. `plan-validation.ts`, the honesty layer. Ships with step 4, not before.
6. Deload adaptation.

Steps 1 and 2 unblock everything. Step 3 is the one that decides whether the
rest is worth building.

## Division of work

Two agents on one repo fail at shared state, not at code. So ownership is by
file, and no file has two owners in the same window.

| Owner | Scope | Why |
|-------|-------|-----|
| Terra | Steps 2 and 4. New files: plan data layer, `/api/plan`, intake UI | Self-contained, mostly new files, no conflict surface |
| Claude | Steps 3, 5, 6. `log-form.tsx` integration, `plan-validation.ts` | `log-form.tsx` is large and shared; validation is where "never invent data" is enforced, which is easier to write right than to audit |
| Founder | Migration 0016, merges | SQL is pasted by hand here, and only the founder merges |

Rules that make this work:

- **Every handoff is a PR with tests.** Not a description of a PR.
- **`npm test` green before every commit.** Golden rule 1, no exceptions.
- **One canonical instruction doc.** `CLAUDE.md` is it. If `AGENTS.md` exists
  it must contain a pointer to `CLAUDE.md` and nothing else. Two copies drift,
  and the next agent follows the stale one. This already happened once.
- **Claim nothing you did not run.** Report the command and its output. An
  audit of this project has already been wrong in both directions from
  skipping that.

## Step 1, founder: apply migration 0016

Paste `supabase/migrations/0016_training_plans.sql` into the Supabase SQL
editor and run it. Then say so, and it gets VERIFIED with a REST count before
anything is built on it. Landmine 2: "I ran the SQL" has not meant the SQL ran.

## Step 2, Terra: plan data layer plus a seeded plan

New file `src/lib/plans.ts`. Follow the conventions in `src/lib/data.ts`
exactly, especially the unit seam: **weights are canonical kilograms in the
database.** A plan stores no weights at all, only sets and rep ranges, so
this should not come up, and if it does the design is wrong.

Functions needed:

- `getActivePlan(supabase)`: the athlete's active plan with days and exercises
  joined and ordered, or null. One query with nested selects, not N+1.
- `getPlanDayForToday(supabase)`: which day of the rotation is next. Base it
  on the last logged session date and the plan's `day_index` order, not on the
  calendar weekday, because a gymrat who misses Tuesday still wants Push A
  next, not Legs.
- `createPlan(supabase, plan)`: insert plan, days, exercises in one
  transaction-ish sequence. The partial unique index in 0016 enforces one
  active plan per athlete, so deactivate any existing active plan first.
- `deactivatePlan(supabase, planId)`.

Types go in `src/lib/types.ts` alongside the existing row types, named
`TrainingPlan`, `PlanDay`, `PlanExercise` to match the tables.

Then seed ONE plan for the test account by hand, a simple 4-day upper/lower,
using real `exercise_id` values from the library. A SQL file under
`supabase/seeds/` is fine. This exists so step 3 has something to render, and
it is throwaway.

**Do not** build the intake UI or the generation route in the same PR. Data
layer plus seed, tests, done.

## Step 4, Terra: intake and generation

Only after step 3 proves the screen. Read PLANNER_DESIGN.md sections 1 and 2,
they are still accurate. Two things to get right:

**Ask only what the app cannot answer.** It already knows units, bodyweight,
sex, training frequency, per-muscle volume, standards level, and full history.
Asking for any of that is a bug. The genuine gaps are days per week, session
length, equipment, goal, things to avoid, and split preference.

**Use a forced tool call**, not prose parsing. The route already has the
pattern in `src/app/api/scan/route.ts`: `tool_choice: { type: "tool", name: ... }`.
Model selection goes through `src/lib/ai-model.ts`, and if a local model is
wired the fallback pattern is in `src/app/api/coach/route.ts`. Do not add a
new model env var, the two that exist are enough.

The prompt carries a compact snapshot: current sets per muscle per week from
`setVolume.ts`, standards level per main lift from `standards.ts`, readiness
and deload state, the library filtered to their equipment, and the intake
answers. Per-muscle set targets come from `src/lib/analytics/volume-landmarks.ts`.

**Read that module's header before using it.** Every per-muscle number in it
is a coach estimate, not a trial result. It exposes `EVIDENCE_CAVEAT` for
exactly this reason, and any screen showing a set target has to display it.
`canValidate()` says which muscles are safe to check at all. Do not paper over
a null landmark with a plausible number, that is golden rule 4.

## What Claude keeps

- **Step 3, Log integration.** Touches `log-form.tsx`, which is large and
  shared. Spec: Log opens on "Today: Push A" with planned exercises already
  rendered as rows carrying target sets, rep range and RPE. Each set prefills
  the last session's weight with `progression.ts` supplying the increment. One
  tap logs a set. Typing happens only when something changed.
- **Step 5, `plan-validation.ts`.** Pure and tested. Checks every exercise id
  exists and is visible, no equipment the athlete does not have, nothing from
  the avoid list, weekly sets per muscle against the landmarks, session length
  plausible, mesocycle contains a deload.

  Severity policy, and the reasoning matters: constraint violations are hard
  errors, because the athlete stated them. Volume and session length are
  warnings, because the landmarks are low-confidence coach estimates and the
  session-length formula is derived arithmetic with its own honest statement in
  the research file. Blocking a plan on a low-confidence number would be
  claiming more certainty than the data has.
- **Step 6, deload adaptation.** Depends on 3 and 5.
- **Auditing every PR.** Against commands, not summaries.

## Still open, deliberately

- The coach's token usage is not instrumented. It streams, so usage arrives in
  the final event. Separate change, not urgent.
- The scanner stays on Claude in production until the gym benchmark in
  `docs/AI_COST.md` passes. Local inference in production is not planned:
  it would make every user's request depend on one laptop being awake.
- `AGENTS.md` is untracked and still a full duplicate of `CLAUDE.md`. Reducing
  it to a pointer is the founder's call, and it should happen before another
  agent reads it.

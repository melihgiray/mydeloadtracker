# The program planner

Design for the AI coach feature that builds and maintains a training plan.
Written 2026-07-29. Read CLAUDE.md and ARCHITECTURE.md first.

## What makes this different from a generic program generator

Every fitness app can emit a PPL split. The reason to build this one is that
the app already knows things a generator normally cannot:

- what the athlete actually trained, per muscle, per week (`setVolume.ts`)
- where each lift sits Beginner to Elite (`standards.ts`)
- whether they are recovered or accumulating fatigue (`readiness.ts`)
- whether a deload is due right now (`deload.ts`)
- what they can realistically add next session (`progression.ts`)

So the plan is not a static template. It is generated from measured training
history and then **adapts to readiness**: when the deload engine fires, the
week's prescription drops instead of the athlete grinding through it. That
adaptation is the moat, and it is also the thing to film.

## Scope

In scope: intake, generation, validation, storage, and driving the Log screen.
Out of scope for the first pass: swapping individual exercises from the plan
UI, multi-mesocycle periodisation, and any change to `setVolume.ts` grading
(golden rule 2 forbids touching analytics math without the founder asking; the
planner gets its own landmarks module instead).

## Flow

### 1. Intake, asking only what the data cannot answer

The app already knows units, bodyweight, sex, training frequency, per-muscle
volume, standards level, and full exercise history. It must not ask for any of
that. It asks only the genuine gaps:

- days per week available, and roughly how long a session can run
- equipment access (full gym, home rack, dumbbells only, and so on)
- goal (hypertrophy, strength, or both)
- anything to avoid: injuries, lifts they hate, movements that flare something
- split preference, or "you pick"
- optional freeform note

Rendered as a short form rather than a chat, because a gymrat wants a program
in under a minute and a conversation is slower and harder to film. The
questions are still generated from what is missing, so an athlete with a rich
history is asked less than a new one.

### 2. Generation

One Anthropic call with a forced tool, so the output is structured rather than
prose. The prompt carries a compact snapshot: current sets per muscle per week,
standards level per main lift, readiness and deload state, the available
exercise library filtered to their equipment, and the intake answers.

The tool returns: split type, mesocycle length, and for each day a list of
exercises with sets, a rep range, an RPE target, rest, and a role (primary,
secondary, isolation).

### 3. Validation, the honesty layer

A pure, testable function checks the generated plan BEFORE it is ever shown:

- every exercise id exists in the library and is visible
- no exercise uses equipment the athlete said they do not have
- nothing from the avoid list appears
- weekly sets per muscle fall inside the researched landmarks
- session length is plausible for the set count
- the mesocycle contains a deload

A plan that fails validation is regenerated once, then surfaced with the
specific problem named. Never show a plan that violates the athlete's stated
constraints, and never quietly "fix" it either.

### 4. Storage and integration

Tables in migration 0016. The active plan drives:

- Log: "Today: Push A" with the planned exercises prefilled, sets and rep
  range shown as targets, so logging is confirming rather than typing
- Home: the next session card names the planned day
- Deload weeks: the prescription scales down automatically

## Data the planner needs and must not invent

The app currently grades every muscle against one 10 to 20 set range. That is
fine as a summary but too coarse to prescribe from: the tolerable weekly volume
for side delts is not the tolerable volume for lower back. The planner needs
per-muscle landmarks, and those are empirical numbers, so they get researched
and cited, never guessed. See the Cowork brief below.

Our 13 muscle groups, with library depth in brackets: Back (26), Quads (21),
Chest (19), Shoulders (17), Core (11), Biceps (10), Triceps (10), Hamstrings
(8), Glutes (6), Calves (4), Forearms (2), Traps (2), Adductors (1).

Equipment tags: barbell, dumbbell, machine, bodyweight, cable, kettlebell.

## Build order

1. Migration 0016: plans, plan_days, plan_exercises, all RLS-owned.
2. `src/lib/analytics/volume-landmarks.ts`: the researched numbers as data,
   pure, with the citation in comments. Does not touch setVolume.ts.
3. `src/lib/plan-validation.ts`: pure validation + its tests.
4. `/api/plan` route: snapshot, forced tool, validate, persist.
5. Intake UI, then the generated-plan view.
6. Log integration: today's planned session.
7. Deload adaptation.

Steps 2 through 4 are the ones that need the research first. Everything else
can be built in parallel.

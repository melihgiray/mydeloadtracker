# Planner v2: conversational, editable, personal

Date: 2026-07-30. Design only, no code. Written so Sol or Terra can implement
from it without re-deriving the reasoning.

Read first: `PLANNER_EVIDENCE.md` for what the research actually supports,
`HANDOFF_PLANNER.md` for how ownership works, `CLAUDE.md` for the golden rules.

## What the founder said, and what it maps to in code

Four complaints from using the shipped feature. Each one is a real gap, and
three of them are gaps I introduced.

| Complaint | Cause in code |
|-----------|---------------|
| "I cannot edit it" | `plan-builder.tsx` has one affordance, "Replace plan". There is no edit path at all, only regenerate-from-scratch. |
| "It still doesn't ask for my PRs, I could be a first time user" | `assessWeakPoints` reads logged history. A new user has none, so `insufficientData` is true and the plan is generic. I built the assessment and never handled cold start. |
| "Deadlifts and bench for a hypertrophy goal", "dumbbell bench is redundant next to incline" | `exercises` carries only `muscle_group`, `movement_pattern`, `equipment`. Nothing encodes systemic cost or that two lifts are the same stimulus, so the model cannot avoid either. |
| "Most people misestimate RPE", "there is no single approach" | Intake asks goal, days, equipment, split. It never asks how the athlete likes to train, so the planner picks set counts and RPE for them. |

Underneath all four is one thing: **the plan is something the app hands the
athlete, not something they build with it.**

## The shape of the fix

One idea does most of the work: **the plan is a living document the athlete
talks to, and every change is a diff.**

- Generation makes a first draft fast.
- Everything after that is a patch: from a tap, or from a sentence.
- Weekly review is the same patch mechanism, triggered by a week elapsing.

This resolves the tension that made the original a form. A conversation up
front is slow and a bad first impression; a conversation *about something that
already exists* is fast, because the athlete reacts instead of specifying.
They get a plan in one tap, then shape it.

It is also the cheap option. A full generation measured 35s and about 3000
output tokens (`E2E_2026-07-30_planner.md`). A patch of one or two exercises is
a few hundred tokens and a few seconds, and it preserves everything the athlete
already accepted.

## 1. Editing

Two paths to the same operations, because they have different costs.

**Direct manipulation, no AI call, instant.** On each exercise row: swap,
remove, reorder, change sets, change rep range. Swap opens the library filtered
to the same muscle group and stimulus, best matches first. This handles most
edits and must never wait on a model.

**Conversation, for judgement.** A chat on the plan screen. "Swap the deadlift
for something less taxing", "give me more chest on Tuesday", "I only have 45
minutes on Fridays". The model returns a patch, not a plan.

### The patch contract

The model returns a list of operations, never a whole plan:

```
{ op: "replace_exercise", dayIndex, position, exerciseRef, reason }
{ op: "remove_exercise",  dayIndex, position, reason }
{ op: "insert_exercise",  dayIndex, position, exerciseRef, sets, repLow, repHigh, reason }
{ op: "set_prescription", dayIndex, position, sets?, repLow?, repHigh?, rpeTarget?, reason }
{ op: "reorder",          dayIndex, fromPosition, toPosition, reason }
{ op: "rename_day",       dayIndex, name?, focus?, reason }
```

Rules:

- Every op carries a `reason`, shown in the UI. A coach that changes something
  without saying why is not a coach.
- The result of applying the patch goes through the **existing**
  `validateGeneratedPlan`. Same errors, same warnings. Editing must not be a
  hole in the validation.
- If applying the patch produces a hard error, the patch is rejected and the
  athlete is told which op failed and why. Never silently drop an op.
- Patches are applied to a copy, shown as a before/after diff, and confirmed.
  Undo restores the previous revision.

### Revisions

`plan_revisions`: plan id, revision number, the ops applied, the source
(`athlete_direct`, `athlete_chat`, `weekly_review`), a snapshot, timestamp.

This gives undo, a visible history of how the plan evolved, and the raw
material for a later "what has your coach changed this block" screen. It also
makes the weekly review non-destructive by construction.

## 2. Cold start, and asking for PRs

A first-time user must get a plan that is about *them* on day one.

### The lift questions

Ask for a small number of bests. Chosen to cover the most scoreable muscle
groups per question, from the 64 lifts that have published standards:

| Ask | Covers |
|-----|--------|
| Squat | Quads |
| Bench Press | Chest |
| Deadlift | Back |
| Shoulder Press | Shoulders |
| Barbell Curl | Biceps |
| Tricep Pushdown | Triceps |

Six questions reach 6 of the 11 scoreable groups, which is enough for
`assessWeakPoints` to produce a real median and a real lag ranking.

Design constraints:

- **Every one is skippable**, individually and as a set. "I don't know" is a
  first-class answer and must not degrade the plan into an error state.
- Accept **weight and reps**, not a 1RM. Nobody knows their true 1RM and asking
  for one invites a made-up number. `estimate1RM` already converts.
- If the athlete has logged history for a lift, **prefill it and do not ask**.
  The rule from the original design still holds: never ask what the app knows.
- Offer a "just give me something sensible" escape that skips the whole block.

### Storage

New table `athlete_lifts`: user_id, exercise_id, weight, reps, recorded_on,
source (`self_reported` | `logged`).

**Do not write these into `workout_sets`.** That would fabricate training
history, which would then flow into volume, readiness, deload detection and the
history screen as if the athlete had done the session. Golden rule 4.

`buildRecords` gains a merge: logged history wins where both exist, and a
`PersonalRecord` carries `source` so the UI can say "you told us this" versus
"you logged this". The weak-point assessment treats them the same, because for
classification purposes a best is a best.

## 3. Exercise selection

Two new pieces of exercise metadata, and a goal branch.

### Where the metadata lives

**A versioned file in the repo, not database columns.** Precedent:
`weight-semantics.ts`, `exercise-aliases.ts`, `scan-mapping.ts`. It is
reviewable in a PR, needs no migration, and can be corrected without touching
production data. Call it `src/lib/exercise-profile.ts`.

### Systemic cost

`systemicCost: "low" | "moderate" | "high"`.

**Derived from a written rule, not invented per exercise.** Golden rule 4 means
I cannot assign 137 CNS ratings from nowhere. The rule:

- **high**: axial-loaded barbell squat or hinge patterns, and Olympic lifts.
  Deadlift, Squat, Front Squat, Power Clean, Good Morning.
- **moderate**: multi-joint free-weight work that is not axially loaded through
  a braced spine, or is supported. Bench Press, Row, Pull Up, Lunge, Leg Press.
- **low**: single-joint work, machines, cables, and supported isolation.

The rule goes in the file's header so anyone can check the classification
against it. Where the rule is genuinely ambiguous, the entry is `null` and the
planner treats it as moderate, rather than a guess dressed as data.

This is a heuristic and the file must say so. It is not a measured quantity and
no research pass has produced one.

### Stimulus grouping

`stimulusKey: string | null`. Two exercises with the same key train the same
thing and should not both appear in a plan.

Examples: flat barbell bench and flat dumbbell bench share
`chest/horizontal-press/flat`. Incline dumbbell press is
`chest/horizontal-press/incline`, a different key, so a plan may carry one of
each but not two flats.

Curated for the roughly 40 exercises where redundancy actually bites, `null`
everywhere else. A null key means "no opinion", not "unique".

The founder's specific example, that incline dumbbell press beats flat, becomes
two separate things:

1. **A hard rule**: never two exercises with the same `stimulusKey` in one
   plan. Defensible, no preference claim.
2. **A soft preference**: for a hypertrophy goal, prefer the incline variant
   when choosing within a group. Stated as a preference in the prompt, and
   overridable by the athlete. Not presented as evidence.

### The goal branch

The current prompt treats `hypertrophy`, `strength` and `both` almost
identically. It should not.

**Hypertrophy**: cap high-systemic-cost lifts at roughly one per session and
two per week. Prefer moderate and low cost for accumulating volume. Bias rep
ranges up. Isolation is not filler, it is the point.

**Strength**: high-cost compounds are the plan. They open sessions, they get
the low rep ranges, isolation supports them.

**Both**: compounds early in the week, hypertrophy work late.

Note this is a *fatigue-management* argument, not a claim that deadlifts fail
to build muscle. The reasoning is that a high-cost lift spends recovery that
could have gone to more total productive volume, and volume is the growth lever
(`PLANNER_EVIDENCE.md`, Nunes 2021 and Pelland 2025). Say that plainly rather
than implying deadlifts are bad.

## 4. Training style, and RPE

The founder is right that the app currently tells people what their volume and
intensity should be. The evidence does not support that confidence: there is no
trial behind any specific set count for a lagging muscle
(`PLANNER_EVIDENCE.md`, Q4 returned `no_source`).

### One intake question

> **How do you like to train?**
> - **Few hard sets.** Around 2 working sets per exercise, taken to or very near
>   failure.
> - **Balanced.** Around 3 sets, stopping a rep or two short.
> - **More volume.** Four or more sets, stopping two to three reps short.
> - **Not sure, pick for me.**

This sets default set counts and RPE targets. It is a preference, not a
prescription, and the copy should say so. "Not sure" falls back to balanced.

### RPE

The founder's read is that most people misestimate RPE and a flat 9 is fine.
The design that respects this without pretending:

- **Prescribe effort in the athlete's own terms**, derived from their style
  answer, not a per-exercise RPE the model invented. "Few hard sets" means the
  target is failure, and the prescription can say so in words.
- **Keep RPE optional at logging.** It already is. Do not make plan quality
  depend on it.
- **Do not silently trust a logged RPE that contradicts the numbers.** If reps
  at a given load are climbing while reported RPE stays at 9, the weekly review
  should say the load looks like it has room, and let the athlete decide.

A flat RPE 9 as the global default is a reasonable v2 starting point for the
"few hard sets" and "balanced" styles. It should be a named constant with the
reasoning attached, not scattered through the prompt.

## 5. The weekly review

This is what makes it a coach rather than a generator.

**Trigger.** On opening Plan or Log, if seven days have passed since
`last_reviewed_on`, offer it. One tap. Never automatic: a plan that changes
under the athlete without asking is worse than one that does not change.

**What it reads.** Sets logged against the plan in the last week: which
exercises were done, sets completed versus prescribed, load and rep changes per
lift, reported RPE where present, and sessions missed.

**What it produces.** A patch, in the same format as an edit, with reasons:

- A lift progressed well: add load next week, or add a set if it is a priority
  muscle and the weekly total allows.
- A lift stalled two weeks running: change the rep range, or swap the variant.
- Sessions consistently missed: propose fewer days rather than pretending.
- A day consistently ran long: cut the lowest-value exercise, and say which.
- The deload week arrives: the existing scheduled-deload path already handles
  the prescription, so the review just confirms it.

**What it must not do.** Rebuild the plan. The founder said it: not necessarily
new exercises, just re-analysed. Continuity is the point. A patch that touches
more than about a third of the plan should be presented as "this is a big
change" and require explicit confirmation.

## Data model changes

| Change | Why |
|--------|-----|
| `athlete_lifts` table | Self-reported bests, kept out of `workout_sets` so history stays honest |
| `training_plans.training_style` | The style answer, drives set and effort defaults |
| `training_plans.last_reviewed_on` | Weekly review trigger |
| `plan_revisions` table | Undo, visible change history, non-destructive review |
| `src/lib/exercise-profile.ts` | `systemicCost` and `stimulusKey`, versioned in the repo not the database |

Migration 0017 covers the three database items. Same rules as always: numbered,
idempotent, pasted by the founder, and **verified by REST before anything is
built on it**.

## Build order

Each step is shippable and independently useful. This matters because the
founder should be able to stop after any of them.

1. **Migration 0017 plus `exercise-profile.ts`.** Data foundation. Nothing
   user-visible.
2. **Direct editing.** Swap, remove, reorder, change sets and reps, with undo
   through `plan_revisions`. No AI. This alone answers the loudest complaint
   and it is the cheapest thing here.
3. **PR intake and cold start.** The six questions, `athlete_lifts`, the
   `buildRecords` merge. A first-time user gets a personal plan.
4. **Training style.** The one question, and set and effort defaults derived
   from it rather than prescribed.
5. **Selection rules.** `stimulusKey` deduplication as a hard validation rule,
   `systemicCost` caps per goal, the goal branch in the prompt.
6. **Conversational editing.** The chat and the patch endpoint.
7. **Weekly review.** Reuses the patch mechanism from 6 and the revisions from
   2.

Steps 2 and 3 deliver most of the felt improvement. Steps 6 and 7 are what make
it feel like a coach.

## Ownership

Proposed, for the founder to confirm before anyone starts, given how the last
three rounds went:

| Step | Owner | Reason |
|------|-------|--------|
| 1 | Claude | Touches analytics adjacent files and needs the golden rule 4 judgement on derived metadata |
| 2 | Sol or Terra | Self-contained UI plus a data layer, no model involved |
| 3 | Claude | Merges into `buildRecords`, which feeds the analytics brain |
| 4 | Sol or Terra | Intake UI plus prompt defaults |
| 5 | Claude | Validation rules, and the honesty line between rule and preference |
| 6 | Sol or Terra | New route and new UI, largest self-contained chunk |
| 7 | Claude | Reads logged history and reasons about progression |

**Nobody starts a step until the table in `HANDOFF_PLANNER.md` says it is
theirs.** Two agents built step 2 twice already.

## What needs the founder

1. **Confirm the ownership split above**, or change it.
2. **Migration 0017**, once written, pasted by hand.
3. **A product call on the goal branch.** Excluding deadlifts and bench from a
   hypertrophy plan is defensible on fatigue grounds and will surprise people
   who expect them. Cap them, or exclude them, or make it a toggle. My
   recommendation is cap rather than exclude, with the reasoning shown.
4. **The incline versus flat preference.** I will encode "never both" as a
   rule. Whether the app *prefers* incline is a preference call, and it is
   yours to make, not the evidence's.

## What this design deliberately does not do

- **No claim that reordering grows muscle.** `PLANNER_EVIDENCE.md` closed that:
  order moves strength in the exercise, not hypertrophy.
- **No invented CNS numbers.** A written derivation rule, with `null` where it
  is ambiguous.
- **No prescribed "optimal" volume.** The athlete's style sets the default,
  because no trial supports a specific number.
- **No automatic plan changes.** Every patch is proposed and confirmed.
- **Fractional set counting is still not addressed.** It remains the highest
  value item in `PLANNER_EVIDENCE.md`, it still needs the founder to ask, and
  it would improve every volume number this design depends on.

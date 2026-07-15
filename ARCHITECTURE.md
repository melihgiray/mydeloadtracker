# Architecture

A quick map for anyone reading this codebase, including future me.

## The one-sentence design

Everything analytical is a pure function over one flat shape, `TrainingSet[]`,
so the coaching brain is testable without a database, a browser, or a network.

## Layers

```
UI (src/app routes + src/components)
  reads via ->  src/lib/data.ts        (server-side Supabase reads, unit conversion OUT)
  writes via -> Supabase client        (forms convert units IN via src/lib/units.ts)
        |
Analytics (src/lib/analytics)          pure functions, no I/O, fully unit tested
        |
Data (Supabase Postgres, RLS)          migrations in supabase/migrations, applied by hand
```

## The analytics layer (the product's brain)

All in `src/lib/analytics`, all pure:

- `epley.ts`: estimated 1RM. Brzycki formula (weight x 36 / (37 - reps)), the
  formula strengthlevel.com uses, so our numbers line up with its standards.
- `standards.ts` + `strength-standards.json`: Beginner to Elite classification.
  The JSON is scraped from strengthlevel.com and is the single source of truth;
  no approximated values. Weight lifts classify by e1RM in pounds, bodyweight
  lifts (pull ups etc.) classify by single-set reps. Tables are interpolated to
  the athlete's exact bodyweight; an alias map resolves old exercise names.
- `deload.ts`: the 3-signal deload trigger (stalled e1RM, RPE creep, falling
  frequency).
- `readiness.ts`: 0 to 100 readiness, a noisy-OR over 9 fatigue factors
  (e1RM regression, stalls, RPE creep, wellness check-ins, HRV, resting HR,
  frequency, workload spike, weeks under load). Experience level from
  standards.ts scales how fast time-under-load fatigue accrues.
- `progression.ts`: next-session targets via RPE double progression;
  bodyweight movements progress by reps, never by load.
- `volume.ts` / `setVolume.ts`: tonnage and hard-sets-per-muscle-per-week.
- `records.ts`, `progress.ts`, `trend.ts`: PRs, weekly e1RM series, and the
  honest as-of readiness trend (recomputed per week using only data that
  existed then).
- `context.ts`: serializes all of the above into the AI coach's prompt context
  (cached via Anthropic prompt caching).
- `sample.ts`: the deliberately-overreached sample athlete that powers /demo.

## Conventions that matter

- **Canonical kilograms.** The database stores every weight in kg. `data.ts`
  converts to the athlete's display unit on read; forms convert back on write
  (`src/lib/units.ts`). Nothing between the DB and the screen thinks about
  units.
- **Weight semantics.** What "weight" means is equipment-driven
  (`src/lib/weight-semantics.ts`): one dumbbell, total bar weight, stack
  weight, or added weight for bodyweight moves. Stated on the input because
  strengthlevel's dumbbell standards are per dumbbell.
- **The exercise library is curated.** The 64 standards lifts from
  strength-standards.json plus a curated set of popular PPL / Upper-Lower
  accessories (migrations 0013-0015, selected by strengthlevel.com
  logged-lift counts). Accessories log and trend normally; they are not
  banded yet because their standards tables have not been scraped into
  strength-standards.json, though the site publishes them (see
  docs/EXERCISE_DATA_NOTES.md). Retired exercises are hidden, not deleted,
  so history resolves.
- **RLS everywhere.** Every table is row-level-secured to the owner. The one
  deliberate exception is `ingest_health_metrics` (migration 0012), a
  SECURITY DEFINER function that validates a per-user token so an
  unauthenticated iOS Shortcut can write that user's daily check-in.
- **Migrations are plain SQL,** numbered, idempotent, pasted into the Supabase
  SQL editor by hand.

## Integrations

- **Anthropic Claude**: streaming coach (`/api/coach`) with the athlete's
  8-week context; vision with a forced tool for the bar scanner (`/api/scan`).
- **Oura**: OAuth, pulls HRV / resting HR / sleep into check-ins.
- **Apple Health**: no vendor API. A morning iOS Shortcut posts HealthKit
  HRV + resting HR to `/api/wearables/apple` with a token from Settings.
  Covers Apple Watch, and Whoop/Garmin/Fitbit via their Apple Health sync.
- **PostHog**: env-gated product analytics (`src/lib/track.ts`).

## Testing

`npm test` runs Vitest over the analytics layer. The tests assert against the
scraped standards file's actual numbers, the Brzycki formula, unit round-trips,
and the readiness model's behavior, not implementation details.

# CLAUDE.md

Instructions for any Claude model working on MyDeloadTracker. Read
ARCHITECTURE.md before touching code. Session-specific state, credentials
pointers, and the roadmap live in CLAUDE.local.md (gitignored, same folder).

## What this project is

An AI strength coach that tells lifters when to push and when to deload,
live at mydeloadtracker.vercel.app. The long-term vision is an ambient
personal trainer in smart glasses; the bar scanner (camera to logged set,
Claude vision) is the phone-sized proof of that vision and gets filmed for
demos, so its quality bar is the highest in the app.

## Golden rules

1. `npm test` stays green. Run it before every commit. The suite asserts
   real values from the scraped standards file, so do not "fix" a failing
   test by changing expected numbers without understanding why.
2. Never modify `src/lib/analytics/` math without the founder asking.
   It is the product's brain and every function is pure and tested.
3. Weights are canonical kilograms in the database, converted at exactly
   two seams: `src/lib/data.ts` on read, form components (via
   `src/lib/units.ts`) on write. Nothing in between thinks about units.
4. Never invent data. No approximated standards values, no fabricated
   traction numbers, no synthesized confidence scores. If the model or the
   data did not provide it, say so or leave it blank.
5. Report honestly. If a test fails, show the output. If a step was
   skipped or could not be verified, say that plainly. Every deliverable
   report includes a "found but left alone" list.
6. Migrations are numbered idempotent SQL in `supabase/migrations/`,
   pasted into the Supabase SQL editor BY THE FOUNDER by hand. After they
   say it ran, VERIFY it actually applied with a REST count query before
   building on it. This has burned us: three migrations sat unapplied for
   days while the founder believed they were live.
7. When you ship a feature, tell the founder exactly where it lives on a
   phone. A feature with no mobile entry point does not exist. This also
   burned us: Settings was unreachable on mobile for weeks.

## Writing style, both app copy and chat

- Write like a human. Never use em dashes, en dashes, or any dash as
  punctuation. Use commas and periods.
- No exclamation points in app copy. Calm, short sentences.
- Copy states conventions explicitly where data is entered, for example
  "Enter the weight of a single dumbbell" (see
  `src/lib/weight-semantics.ts` for why this is a correctness issue).

## Verification workflow, not optional

Claiming something works without seeing it work is the main failure mode
to avoid. The bar: empirical proof, then the claim.

- UI changes: run the dev server (`.claude/launch.json`, name "dev"),
  verify at 393x852 (iPhone 15 viewport), and screenshot the result.
  Check `document.documentElement.scrollWidth` against the viewport;
  horizontal overflow on a phone is a recurring bug class here.
- To fill React inputs programmatically, use the native value setter and
  dispatch an `input` event; plain `.value =` does not trigger state.
- Database claims: verify with a Supabase REST query (anon key + a
  signed-in session), never from memory.
- Latency or performance claims: measure against production, report
  p50/p95 with sample sizes and the caveats of your method.
- After deploying, verify the deployed build actually contains the change
  (check for a copy string that only exists in the new build).

## Dev commands

- `npm test` runs Vitest (analytics + mapping suites).
- `npx tsc --noEmit` typechecks; `npm run build` must compile clean.
- Dev server through the preview tooling with launch config "dev", never
  a raw `npm run dev` in a background shell you cannot see.

## Deploys

There is NO GitHub auto-deploy integration. Pushing to main deploys
nothing. Deploys go through the Vercel CLI with an access token, or the
founder clicks Deploy in the dashboard on a NEW commit (the Redeploy
button re-runs the same commit it already had, another thing that burned
us). Until the founder connects the Git integration in Vercel project
settings, always confirm after a deploy that production serves the new
code.

## Where the knowledge lives

- `ARCHITECTURE.md`: layers, conventions, the analytics brain.
- `docs/EXERCISE_DATA_NOTES.md`: strengthlevel.com data conventions
  (per-dumbbell weights, reps-based bodyweight standards, entity
  disambiguations). Read before touching exercise data or standards.
- `docs/SCANNER_FLOW.md`: every state of the bar scanner flow plus
  measured production latency. Read before touching the scanner.
- `docs/DELOAD_SCIENCE.md`: the public science write-up.
- `src/lib/analytics/standards.ts`: Beginner to Elite classification,
  including the alias map to strengthlevel canonical names.
- `src/lib/exercise-aliases.ts`: search slang ("skull crusher", "rdl").
- `src/lib/scan-mapping.ts`: pure scan-to-set mapping, fully tested.
- `src/lib/weight-semantics.ts`: what "weight" means per equipment.

## Commit rhythm

Commit small and often, and push after every commit. One commit per
coherent step: a fix, a doc, a test, a migration each stand alone. Every
commit must build and pass tests on its own, since any commit can become
a deploy. Never pad the history with empty or artificially split
commits; frequency comes from working in small real steps.

## Cost consciousness

The founder pays per token now. Batch independent tool calls, read file
sections instead of whole files when you know the target, do not re-read
files you just edited, and do not re-derive facts that are written in the
docs above. Prefer one decisive verification over five exploratory ones.

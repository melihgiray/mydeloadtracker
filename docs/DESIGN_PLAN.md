# Design plan: the Sleek redesign

Written 2026-07-24 by Fable. This is the execution plan for redesigning the
app's visuals with sleek.design while keeping every functional and
correctness guarantee we have built. Any model can execute this plan
step by step. Read CLAUDE.md and CLAUDE.local.md first as always.

## Why a plan before any Sleek run

Sleek costs its own money, separate from AI credits: one free trial run,
then Pro at 49.99 a month (or 30 a month billed yearly). The founder has
not decided to subscribe. So the whole app must be designed in ONE
well-aimed run, a single message that describes every screen, not a
conversation that burns runs on revisions. This document is that aim.

## Non-negotiables the redesign must not break

These are correctness and strategy features wearing design clothes. Sleek
output REPLACES visual style; it must never replace these behaviors.

1. Weight semantics hints on every weight input ("Enter the weight of a
   single dumbbell", "total bar weight"). Users get misgraded a full
   strength band if these vanish. See src/lib/weight-semantics.ts.
2. The scanner's phase machine and honest uncertainty: every state in
   docs/SCANNER_FLOW.md still renders something deliberate; unread
   fields show dashes and get marked, never invented values.
3. The 4-tab bottom nav (Home, Log, Progress, Coach) with Settings in
   the top bar gear. No screen may lose its mobile entry point.
4. Calm copy: no exclamation points, no dashes as punctuation, short
   sentences. Sleek's generated copy must be rewritten to match.
5. Readiness color is semantic (good, caution, bad), not decorative.
   Whatever palette Sleek proposes, those three states stay
   distinguishable and consistent everywhere they appear.
6. Dark theme stays the default. It films well and the demo is the
   point. A light theme is optional and only if free.
7. Tap targets at least 44px, inputs do not zoom the viewport on iOS
   (16px font minimum on inputs), no horizontal overflow at 393px.
8. The workout draft, check-in modal, rest timer, and searchable
   typeahead keep their exact behaviors.

## Screen inventory for the single Sleek message

Nine screens, in the order a new user meets them. The Sleek message
below describes all of them at once so the style is coherent.

1. Login (email, password, sign in, sign up, brand mark)
2. Onboarding (bodyweight, sex, units, pick main lifts with working sets)
3. Home (readiness hero with score and trend sparkline, today's call
   verdict, activity strip, four category tiles)
4. Insights (readiness breakdown, deload alert with reasons, next
   session plan)
5. Log (exercise search with typeahead results, workout draft with sets
   grid of reps, weight, RPE, rest timer, check-in card)
6. Scan, three key states: live camera with framing hint, processing
   with named stages, result card with big weight and reps readouts
7. Progress (strength standards card with Beginner to Elite bands and
   progress bars, lift lookup with chart, records)
8. History (session cards with per-exercise summaries)
9. Coach (chat with streamed markdown answers)

## The Sleek run, exactly

Prerequisite: SLEEK_API_KEY. Not set as of writing. Get it either by
the device flow in the skill (POST /api/v1/device/start, show the user
the code, poll) or have the founder paste one from
sleek.design/dashboard/api-keys. The founder has trial credits for
roughly one run; do not send a second message without asking.

Step 1. GET /api/v1/references, show the founder 3 to 5 fitness-adjacent
reference previews, let them pick one. This seeds the style and is the
single highest-leverage choice in the whole redesign. If the founder is
unavailable, pick the darkest, most instrument-like reference, never a
pastel or cream one.

Step 2. POST one project ("MyDeloadTracker"), then ONE chat message
containing: the app in one paragraph (an AI strength coach that tells
lifters when to push and when to back off, dark, confident, calm,
designed to be filmed on a phone), then the nine screens above each in
one or two sentences, with the readiness hero and the scanner result
card called out as the money screens. Pass source: claude-code and the
chosen referenceId. Do not decompose into multiple messages.

Step 3. Poll, then screenshot every screen (POST /api/v1/screenshots,
transparent background) into docs/design/ and show the founder.

Step 4. STOP. The founder approves or rejects the direction before any
code is written. Rejection means we stop spending here, not iterate
blind.

## Implementation, only after approval

Order matters: tokens first, then screens by demo importance. One
commit per step per the commit rhythm rule, tests green at each.

1. Extract the design system from Sleek's HTML: colors, radii, spacing,
   fonts (Google Fonts links in the head), shadows. Map them onto our
   existing CSS variables in src/app/globals.css. Do not rename the
   semantic variables (success, warning, danger, brand); reassign their
   values. This single commit restyles most of the app because
   components already consume tokens.
2. Fonts via next/font with the families Sleek chose.
3. Icons: we use lucide-react. Sleek uses Iconify names. Map to the
   closest lucide equivalent and keep our custom exercise glyphs
   (exercise-glyphs.tsx) exactly as they are; they are load-bearing
   (screenshot-verified legibility) and brand, not decoration.
4. Screens in this order: Home, Scan result card, Log, Progress,
   Insights, History, Coach, Onboarding, Login. Home and Scan first
   because they get filmed.
5. Rewrite any Sleek-generated copy to our copy rules.
6. Navigation and headers restyled to match, structure unchanged.

## Verification per screen (the usual bar)

- 393x852 viewport screenshot, compared against the Sleek screenshot.
- document.documentElement.scrollWidth equals 393.
- npm test green, npx tsc --noEmit clean, npm run build clean.
- grep the diff for em dashes, en dashes, and exclamation points in
  user-facing strings.
- The non-negotiables list above walked once at the end.

## Budget reality

- Sleek: one run covers the design. Screenshots are cheap. The 49.99
  subscription is only needed if the founder wants ongoing iterations;
  for a one-shot restyle the trial may suffice.
- AI credits: token extraction and per-screen restyling is mostly
  mechanical editing, medium effort work. The expensive mistake would
  be regenerating screens in conversation with Sleek; the plan avoids
  that by design.
- If credits run low mid-implementation, stop after any complete
  commit. The app must never sit in a half-restyled state; tokens-first
  ordering means even stopping after step 1 leaves a coherent app.

## What was deliberately left out

- No light theme work.
- No landing page or demo page redesign in this pass; they share tokens
  so they inherit most of the improvement free.
- No component library swap. We restyle what exists; we do not adopt a
  new framework for this.

## Run 1 outcome (2026-07-24)

Reference chosen by the founder: Neon Strength (hHQlYGPkhJf), over the
recommended Cobalt Dashboard. Sleek named the result "Neon Brutalist":
near-black #1A1A1A, electric lime accent, heavy industrial condensed
capitals, hard-offset shadows.

Project eZRqNRacT8U. Run EPrw5GpApNm produced 4 of the 9 screens plus the
theme: Home, Login, Onboarding, Insights. Sleek establishes identity and
primary screens first, so Log, Scan, Progress, History, and Coach still
need a second run. Scan and Log are the two screens that get filmed, so
that second run matters more than the first.

Kept from the brief, verified in the Home screenshot: the four-tab bottom
bar, the Settings gear in the top bar, the readiness score as hero, the
verdict line, the activity strip, the four category tiles.

Fix during implementation, do not copy blindly:
1. The activity strip overflows the right edge. That is our recurring
   393px overflow bug; it must wrap or scroll inside its own container.
2. The category tile icons use blue, orange, and purple decoratively.
   That breaks the rule that colour means something. Restrict decorative
   colour, keep lime for push, amber for hold, warm red for back off.
3. The bottom tiles are clipped by the tab bar. Home must fit one screen.
4. Copy is shouting ("SYSTEMIC RECOVERY IS OPTIMAL. SLEEP VOLUME EXCEEDS
   7-DAY ROLLING BASELINE."). Rewrite everything to our voice: calm,
   short, sentence case where it is a sentence, no exclamation points.

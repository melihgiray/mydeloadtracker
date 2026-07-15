# Exercise data notes (strengthlevel.com audit)

Findings from a full audit of strengthlevel.com's exercise list (1,318
entries), run July 2026. These are the conventions and gotchas the code
depends on. Source of truth for standards remains
`src/lib/analytics/strength-standards.json`.

## Weight conventions (verified per page on the site)

- **Barbell lifts**: total bar weight, bar included (bar normally 20 kg / 44 lb).
- **Hex bar**: bar included, normally 30 kg / 66 lb.
- **Dumbbell lifts**: the weight of ONE dumbbell, handle included (normally
  2 kg / 4.4 lb), even for two-dumbbell movements.
- **Machine / cable**: the stack or loaded weight as entered; the site states
  no sled-inclusion convention for leg press and hack squat machines.
- **Bodyweight movements**: standards are REPS at bodyweight. Exactly the 11
  lifts in `REPS_LIFTS` (standards.ts) are rep-based, verified. Their pages
  also carry an unused weighted-1RM tab.

The app states these conventions on the weight input
(`src/lib/weight-semantics.ts`) because mislogging a dumbbell lift as combined
weight would inflate the athlete's band by roughly one full level.

## Entity disambiguations (easy to get backwards)

- **Machine Calf Raise** on the site is the STANDING shoulder-pad machine. Our
  row is named Standing Calf Raise and resolves to the site table via alias.
  **Seated Calf Raise** is the separate plate-loaded bench.
- The generic **"leg press"** in most gyms is the site's **Sled Leg Press**
  (45 degree, ~2.6M lifts logged), not **Horizontal Leg Press** (seated
  selectorized, ~0.9M). The generic name aliases to Sled.
- **Bulgarian Split Squat** exists twice on the site: barbell (total bar
  weight) and dumbbell (one dumbbell). Never alias the bare name to either
  table; the app carries both as separate exercises.
- **Overhead triceps extensions** are three site entities with three
  conventions: Dumbbell Tricep Extension (one dumbbell), Cable Overhead Tricep
  Extension (stack), barbell Tricep Extension (total bar). The app's
  "Overhead Triceps Extension" row is the dumbbell one.
- **Walking Lunge** on the site is barbell; the dumbbell version is the
  separate Dumbbell Lunge.

## Accessory standards are available (future work)

strengthlevel.com publishes full Beginner-Elite tables for most of our
accessory lifts (Cable Fly, Face Pull, Machine Reverse Fly, Tricep Rope
Pushdown, and dozens more, many with 100k+ logged lifts). Scraping those
tables into strength-standards.json, using the site's canonical names, will
light up banding automatically: the ALIAS map in standards.ts already maps our
row names to the site's canonical names. Only Plank, Side Plank, Step-Up, and
Assisted Pull-Up lack usable site standards.

## Known non-entities

- **Assisted Pull-Up** has no strengthlevel entry; it stays unbanded by design.

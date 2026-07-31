// Two properties the planner needs that the exercise table does not carry:
// how systemically costly a lift is, and whether two lifts train the same
// thing. Step 1 of docs/PLANNER_V2_DESIGN.md.
//
// WHY THIS IS DERIVED AND NOT A HAND-WRITTEN TABLE
//
// The obvious implementation is 137 rows of judgement. That would be 137
// invented numbers, which golden rule 4 exists to prevent, and nobody could
// check it. Instead both properties are computed from data the library already
// has, by rules written out below. A rule can be argued with. A table of
// opinions cannot.
//
// Where a rule genuinely cannot decide, the answer is null, and the caller
// treats null as "no opinion" rather than as a value.
//
// This file is versioned in the repo rather than added as database columns, on
// the same reasoning as weight-semantics.ts and exercise-aliases.ts: it is
// reviewable in a pull request, needs no migration, and can be corrected
// without touching production data.

import type { Exercise } from "@/lib/types";

// ---------------------------------------------------------------------------
// Systemic cost
// ---------------------------------------------------------------------------

/**
 * Roughly how much of an athlete's total recovery a lift spends, beyond the
 * muscle it trains.
 *
 * This is a heuristic, not a measurement. No research pass has produced
 * per-exercise systemic cost values and this file does not pretend otherwise.
 * What it encodes is mechanical: a heavy load supported by a braced spine and
 * moved by the whole body costs more to recover from than the same muscle
 * trained lying on a bench or sitting in a machine.
 *
 * The planner uses it for fatigue budgeting, not to rank exercises by quality.
 * A deadlift is not a worse lift than a leg curl, it is a more expensive one.
 */
export type SystemicCost = "low" | "moderate" | "high";

/**
 * HIGH: the bar is loaded through a braced spine, or the lift is explosive and
 * whole-body. These are the lifts that eat a session's and often a week's
 * recovery.
 */
const HIGH_COST_PATTERNS = new Set(["Olympic"]);

/**
 * Squat and Hinge patterns are high ONLY when the load runs through the spine.
 * A leg press is the same knee-extension pattern with the spine supported, and
 * a leg curl is a hinge-adjacent pattern with no axial load at all, so neither
 * belongs here. Matched on the name because the library has no "axial" flag.
 */
const AXIAL_LOADED = /\b(squat|deadlift|good morning|clean|snatch|jerk|rack pull|atlas stone|thruster|carry)\b/i;

/**
 * Names that contain an axial-sounding word but are not axially loaded. A sissy
 * squat is bodyweight quad isolation, a snatch-grip shrug is a shrug, and a
 * goblet or kettlebell variant is loaded in front at a fraction of the weight.
 * Without this the name match alone calls all of them high.
 */
const NOT_AXIAL = /\b(sissy|shrug|goblet|kettlebell|single-leg|cable|landmine|belt)\b/i;

/** Supported or machine-guided, so the axial pattern above does not apply. */
const SUPPORTED = /\b(machine|smith|sled|pendulum|hack|belt|leg press|chest[- ]supported|seated|lying|bench|cable|assisted)\b/i;

/**
 * MODERATE: multi-joint free-weight work that is not axially loaded, plus the
 * supported versions of the heavy patterns.
 */
const MULTI_JOINT_PATTERNS = new Set([
  "Horizontal Push",
  "Vertical Push",
  "Horizontal Pull",
  "Vertical Pull",
  "Squat",
  "Hinge",
  "Lunge",
]);

/**
 * Classify a lift's systemic cost, or null when the library row lacks the
 * movement pattern needed to decide.
 *
 * Order matters: the supported check runs before the axial check, so a Sled
 * Leg Press and a Smith Machine Squat come out moderate rather than high even
 * though their names contain squat-family words.
 */
export function systemicCost(exercise: Pick<Exercise, "name" | "movement_pattern" | "equipment">): SystemicCost | null {
  const pattern = exercise.movement_pattern;
  if (!pattern) return null;

  if (HIGH_COST_PATTERNS.has(pattern)) return "high";

  const supported = SUPPORTED.test(exercise.name) || NOT_AXIAL.test(exercise.name);
  if (!supported && AXIAL_LOADED.test(exercise.name)) return "high";

  if (MULTI_JOINT_PATTERNS.has(pattern)) return "moderate";

  // Everything left is single-joint, machine, or cable isolation.
  return "low";
}

// ---------------------------------------------------------------------------
// Stimulus grouping
// ---------------------------------------------------------------------------

/**
 * Two lifts with the same key train the same thing, so a plan should not carry
 * both. This is what makes the founder's complaint enforceable: the first
 * generated plan contained Bench Press AND Dumbbell Bench Press, which are the
 * same flat press with a different implement.
 *
 * `movement_pattern` alone is far too coarse. The library has 24 exercises
 * under Chest / Horizontal Push, spanning flat presses, incline presses, flyes
 * and dips, which are plainly not interchangeable. Two more axes fix it:
 *
 *   ACTION  press or fly, row or pulldown, curl or hammer. Whether the elbow
 *           and shoulder both move, and in what relationship.
 *   ANGLE   flat, incline or decline, where the name says so.
 *
 * The implement is deliberately NOT part of the key. A barbell bench and a
 * dumbbell bench are the same stimulus, which is exactly the redundancy worth
 * catching.
 */
const ACTION_RULES: { test: RegExp; action: string }[] = [
  // ORDER MATTERS. Every rule below is more specific than the ones after it.
  // Probing against the real library caught three false splits caused by a
  // generic rule firing first: "Rear Delt Fly" matched fly before rear-delt,
  // "Neutral Grip Pull Ups" matched a hammer-curl rule before vertical-pull,
  // and every leg curl matched the biceps curl rule before knee-flexion.

  // Legs, before the arm rules that share vocabulary.
  { test: /\b(leg curl|nordic|glute[- ]?ham)\b/i, action: "knee-flexion" },
  { test: /\b(leg extension|sissy squat)\b/i, action: "knee-extension" },
  { test: /\b(calf raise|tibialis)\b/i, action: "calf-raise" },
  { test: /\b(hip thrust|glute bridge|frog pump|pull[- ]?through)\b/i, action: "hip-thrust" },
  { test: /\b(lunge|split squat|step[- ]?ups?)\b/i, action: "lunge" },
  { test: /\b(leg press)\b/i, action: "leg-press" },

  // Back, before the neutral-grip rule that arm work also uses.
  { test: /\b(shrug)\b/i, action: "shrug" },
  { test: /\b(pulldown|pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?)\b/i, action: "vertical-pull" },

  // Rear delts, before BOTH the row and fly rules. A "Cable Rear Delt Row" is
  // rear delt work that happens to be named a row, and a "Rear Delt Fly" would
  // otherwise be filed with chest flyes.
  { test: /\b(rear delt|reverse fly|face pull)\b/i, action: "rear-delt" },

  { test: /\b(row)\b/i, action: "row" },

  // Chest and shoulders.
  { test: /\b(fly|flye|crossover|pec deck)\b/i, action: "fly" },
  { test: /\bpullover\b/i, action: "pullover" },
  { test: /\b(lateral raise)\b/i, action: "lateral-raise" },
  { test: /\b(front raise)\b/i, action: "front-raise" },

  // Arms. Grip and lever length change the stimulus, so these split.
  { test: /\b(hammer|cross[- ]?body|zottman)\b/i, action: "curl-neutral" },
  { test: /\b(preacher|spider|concentration|drag)\b/i, action: "curl-short" },
  { test: /\b(wrist|reverse curl)\b/i, action: "wrist" },
  { test: /\b(curl)\b/i, action: "curl" },
  { test: /\b(pushdown|kickback)\b/i, action: "triceps-pushdown" },
  { test: /\b(overhead (tricep|triceps)|skull|tricep(s)? extension)\b/i, action: "triceps-overhead" },

  // Hinge and squat, before the catch-all press rule.
  { test: /\b(deadlift|good morning|hyperextension|back extension)\b/i, action: "hinge" },
  { test: /\b(squat)\b/i, action: "squat" },

  // Presses last, so the specific rules above get first refusal.
  { test: /\b(press|dip|push[- ]?ups?)\b/i, action: "press" },
];

const ANGLE_RULES: { test: RegExp; angle: string }[] = [
  { test: /\bincline\b/i, angle: "incline" },
  { test: /\bdecline\b/i, angle: "decline" },
  { test: /\b(overhead|shoulder press|military|arnold|z press|viking|log press|push press|push jerk|bradford|behind-the-neck press)\b/i, angle: "overhead" },
];

/**
 * A stable key for "trains the same thing", or null when no action rule
 * matches and the library row gives nothing to go on.
 *
 * Null means no opinion. It must not be read as "unique", or two unmatched
 * lifts would look distinct when nothing checked.
 */
export function stimulusKey(
  exercise: Pick<Exercise, "name" | "muscle_group" | "movement_pattern">,
): string | null {
  const action = ACTION_RULES.find((r) => r.test.test(exercise.name))?.action;
  if (!action) return null;

  const angle = ANGLE_RULES.find((r) => r.test.test(exercise.name))?.angle ?? "flat";

  // Angle only distinguishes pressing and chest flyes. An incline curl is a
  // different stimulus and is already separated by its own action rule, and
  // there is no such thing as a decline row.
  const angleMatters = action === "press" || action === "fly";
  return angleMatters
    ? `${exercise.muscle_group}/${action}/${angle}`
    : `${exercise.muscle_group}/${action}`;
}

/** True when two lifts train the same thing, so a plan should carry only one. */
export function sameStimulus(
  a: Pick<Exercise, "name" | "muscle_group" | "movement_pattern">,
  b: Pick<Exercise, "name" | "muscle_group" | "movement_pattern">,
): boolean {
  const ka = stimulusKey(a);
  const kb = stimulusKey(b);
  // Null is "no opinion", never a match. Two unclassifiable lifts are not
  // evidence of redundancy.
  return ka != null && ka === kb;
}

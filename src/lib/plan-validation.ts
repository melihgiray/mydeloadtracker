// Pure validation for AI-generated training plans.
//
// Constraint violations are errors because they contradict facts the athlete
// supplied or the exercise library owns. Volume and duration are warnings:
// per-muscle landmarks are low-confidence coach estimates, and session length
// is derived arithmetic rather than a measured fact. See HANDOFF_PLANNER.md.

import {
  MUSCLE_GROUPS,
  canValidate,
  prescriptionRange,
} from "@/lib/analytics/volume-landmarks";
import type {
  GeneratedPlan,
  GeneratedPlanExercise,
  PlanIntake,
} from "@/lib/plan-generation";
import type { Exercise } from "@/lib/types";

export type PlanValidationSeverity = "error" | "warning";

export type PlanValidationCode =
  | "exercise_unavailable"
  | "equipment_unavailable"
  | "avoid_conflict"
  | "deload_missing"
  | "volume_below_target"
  | "volume_above_target"
  | "session_too_long";

export interface PlanValidationIssue {
  severity: PlanValidationSeverity;
  code: PlanValidationCode;
  message: string;
  dayIndex?: number;
  exerciseId?: string;
  muscle?: string;
}

export interface SessionEstimate {
  dayIndex: number;
  dayName: string;
  minutes: number;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationIssue[];
  warnings: PlanValidationIssue[];
  weeklySetsByMuscle: Record<string, number>;
  sessionEstimates: SessionEstimate[];
}

/**
 * These are the research file's low-confidence arithmetic assumptions, not
 * trial results. Keeping them named makes the warning calculation auditable.
 */
export const SESSION_LENGTH_ASSUMPTIONS = {
  warmupMinutes: 10,
  setDurationSeconds: 45,
  restSeconds: {
    primary: 180,
    secondary: 120,
    isolation: 90,
  },
  transitionMinutesPerExercise: 2,
} as const;

export const SESSION_LENGTH_CAVEAT =
  "Session length is a rough arithmetic estimate, not a measured result.";

const AVOID_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "avoid",
  "avoiding",
  "because",
  "caused",
  "cause",
  "causes",
  "do",
  "dont",
  "exercise",
  "exercises",
  "flare",
  "flares",
  "flaring",
  "from",
  "hate",
  "hurts",
  "injured",
  "injury",
  "movement",
  "movements",
  "my",
  "no",
  "not",
  "pain",
  "please",
  "the",
  "with",
]);

function stem(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("sses") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function tokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => !AVOID_STOP_WORDS.has(token))
    .map(stem)
    .filter((token) => !AVOID_STOP_WORDS.has(token));
}

function exerciseTokens(exercise: Exercise): Set<string> {
  const values = [
    exercise.name,
    exercise.muscle_group,
    exercise.movement_pattern ?? "",
    exercise.equipment ?? "",
  ];
  const result = new Set(values.flatMap(tokens));

  // The library calls some overhead presses "Shoulder Press" or classifies
  // them as a vertical push. Add the mechanical term so the common athlete
  // restriction "no overhead pressing" is enforceable without fuzzy AI.
  if (
    result.has("press") &&
    (result.has("shoulder") || (result.has("vertical") && result.has("push")))
  ) {
    result.add("overhead");
  }

  return result;
}

/**
 * Match explicit exercise, movement, muscle, and equipment restrictions.
 * This is deliberately deterministic. It does not claim to diagnose whether
 * an arbitrary movement is safe for an injury.
 */
export function exerciseConflictsWithAvoid(
  exercise: Exercise,
  avoid: string[],
): string | null {
  const metadata = exerciseTokens(exercise);
  const name = new Set(tokens(exercise.name));
  const movement = new Set(tokens(exercise.movement_pattern ?? ""));

  for (const restriction of avoid) {
    const restricted = tokens(restriction);
    if (restricted.length === 0) continue;
    const restrictedSet = new Set(restricted);

    const allRestrictionTermsMatch = restricted.every((token) => metadata.has(token));
    const namesTheExercise =
      name.size > 0 && [...name].every((token) => restrictedSet.has(token));
    const namesTheMovement =
      movement.size > 0 && [...movement].every((token) => restrictedSet.has(token));

    if (allRestrictionTermsMatch || namesTheExercise || namesTheMovement) {
      return restriction;
    }
  }

  return null;
}

function restSeconds(exercise: GeneratedPlanExercise): number {
  if (exercise.rest_seconds != null) return exercise.rest_seconds;
  return SESSION_LENGTH_ASSUMPTIONS.restSeconds[exercise.role];
}

export function estimateSessionMinutes(exercises: GeneratedPlanExercise[]): number {
  const workSeconds = exercises.reduce(
    (total, exercise) =>
      total +
      exercise.sets *
        (SESSION_LENGTH_ASSUMPTIONS.setDurationSeconds + restSeconds(exercise)),
    0,
  );
  const transitionMinutes =
    exercises.length * SESSION_LENGTH_ASSUMPTIONS.transitionMinutesPerExercise;
  return Math.round(
    SESSION_LENGTH_ASSUMPTIONS.warmupMinutes + workSeconds / 60 + transitionMinutes,
  );
}

export function validateGeneratedPlan(
  plan: GeneratedPlan,
  intake: PlanIntake,
  library: Exercise[],
): PlanValidationResult {
  const errors: PlanValidationIssue[] = [];
  const warnings: PlanValidationIssue[] = [];
  const libraryById = new Map(library.map((exercise) => [exercise.id, exercise]));
  const equipment = new Set<string>(intake.equipment);
  const weeklySets = new Map<string, number>();

  const sessionEstimates = plan.days.map((day, dayIndex): SessionEstimate => {
    for (const planned of day.exercises) {
      const exercise = libraryById.get(planned.exercise_id);
      if (!exercise || exercise.hidden === true) {
        errors.push({
          severity: "error",
          code: "exercise_unavailable",
          message: `${day.name} uses an exercise that is not visible in the available library.`,
          dayIndex,
          exerciseId: planned.exercise_id,
        });
        continue;
      }

      if (!exercise.equipment || !equipment.has(exercise.equipment)) {
        errors.push({
          severity: "error",
          code: "equipment_unavailable",
          message: `${day.name} uses ${exercise.name}, which is not available with the selected equipment.`,
          dayIndex,
          exerciseId: exercise.id,
        });
      }

      const restriction = exerciseConflictsWithAvoid(exercise, intake.avoid);
      if (restriction) {
        errors.push({
          severity: "error",
          code: "avoid_conflict",
          message: `${day.name} uses ${exercise.name}, which conflicts with “${restriction}”.`,
          dayIndex,
          exerciseId: exercise.id,
        });
      }

      weeklySets.set(
        exercise.muscle_group,
        (weeklySets.get(exercise.muscle_group) ?? 0) + planned.sets,
      );
    }

    const minutes = estimateSessionMinutes(day.exercises);
    if (minutes > intake.sessionMinutes) {
      warnings.push({
        severity: "warning",
        code: "session_too_long",
        message: `${day.name} is estimated at ${minutes} minutes, above the requested ${intake.sessionMinutes}. ${SESSION_LENGTH_CAVEAT}`,
        dayIndex,
      });
    }
    return { dayIndex, dayName: day.name, minutes };
  });

  if (
    !Number.isInteger(plan.deload_week) ||
    plan.deload_week < 1 ||
    plan.deload_week > plan.mesocycle_weeks
  ) {
    errors.push({
      severity: "error",
      code: "deload_missing",
      message: "The generated mesocycle does not contain a valid deload week.",
    });
  }

  for (const muscle of MUSCLE_GROUPS) {
    if (!canValidate(muscle)) continue;
    const target = prescriptionRange(muscle);
    if (!target) continue;
    const sets = weeklySets.get(muscle) ?? 0;

    if (sets < target.min) {
      warnings.push({
        severity: "warning",
        code: "volume_below_target",
        message: `${muscle} has ${sets} weekly sets; the coach-estimate target starts at ${target.min}.`,
        muscle,
      });
    } else if (sets > target.max) {
      warnings.push({
        severity: "warning",
        code: "volume_above_target",
        message: `${muscle} has ${sets} weekly sets; the coach-estimate target ends at ${target.max}.`,
        muscle,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    weeklySetsByMuscle: Object.fromEntries(
      MUSCLE_GROUPS.map((muscle) => [muscle, weeklySets.get(muscle) ?? 0]),
    ),
    sessionEstimates,
  };
}

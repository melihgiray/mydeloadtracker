// Turn today's planned day into a prefilled log form.
//
// This is the friction claim made concrete: the athlete opens Log, today's
// session is already there, and every field that CAN be answered from their own
// history already is. What is left is confirming, not typing.
//
// Two rules govern what gets prefilled, and they matter:
//
//   1. The PLAN owns the prescription. Set count, rep range, RPE target and
//      rest all come from the plan.
//   2. HISTORY owns the weight. It comes from progression.ts, which is the
//      app's existing rule-based coach. A lift with no history gets a BLANK
//      weight, never a guessed one (golden rule 4).
//
// Pure and testable. No database, no React.

import type { NextSession } from "@/lib/analytics/progression";
import type { PlanDayWithExercises, Units } from "@/lib/types";

/** Where a prefilled weight came from, so the UI can be honest about it. */
export type WeightBasis = "progression" | "no_history";

/**
 * Whether the plan's rep range overrode what progression suggested.
 *
 * Both directions are real and neither should be silent. Raising to the floor
 * is the dangerous one: progression says hold because the lift is near
 * maximal, and the plan asks for MORE reps at that weight. The athlete needs
 * to see that rather than grind into it.
 */
export type RepsAdjustment = "none" | "raised_to_floor" | "lowered_to_ceiling";

export interface PlannedSet {
  reps: string;
  weight: string;
  rpe: string;
}

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  /** The plan's prescription, shown as the target to hit. */
  target: {
    sets: number;
    repLow: number;
    repHigh: number;
    rpe: number | null;
    restSeconds: number | null;
    role: string | null;
  };
  /** One prefilled row per prescribed set. */
  sets: PlannedSet[];
  weightBasis: WeightBasis;
  /** progression.ts's own explanation, passed through unchanged. */
  note: string | null;
  repsAdjusted: RepsAdjustment;
  /**
   * Set when the plan and the athlete's measured performance disagree. Never
   * resolved silently: the plan is followed, and the conflict is stated so the
   * athlete can decide. This is the honest-uncertainty rule applied to a
   * prescription.
   */
  conflict: string | null;
}

export interface PlanSessionOptions {
  /** Reduce the plan's work prescription for a scheduled or readiness deload. */
  deload?: boolean;
}

/**
 * Clamp progression's suggested reps into the plan's prescribed range.
 *
 * These two can disagree. Double progression may say "10 reps at the same
 * weight" while the plan caps the lift at 8. The plan wins, because a rep
 * ceiling is a deliberate choice about the stimulus, and the load will rise on
 * a later session instead.
 *
 * The weight is deliberately NOT adjusted to compensate. Deciding how load
 * responds to a rep cap is progression logic, and that lives in
 * src/lib/analytics/, which this module does not touch.
 */
export function repsWithinRange(suggested: number, low: number, high: number): number {
  if (!Number.isFinite(suggested) || suggested <= 0) return low;
  if (suggested < low) return low;
  if (suggested > high) return high;
  return Math.round(suggested);
}

/**
 * Build the prefilled session for one planned day.
 *
 * `nextSessions` is progression.ts's output, already computed with the deload
 * flag applied, so a deload week arrives here as reduced target weights without
 * this module knowing anything about readiness.
 */
export function buildPlannedSession(
  day: PlanDayWithExercises,
  nextSessions: NextSession[],
  units: Units = "kg",
  options: PlanSessionOptions = {},
): PlannedExercise[] {
  const byExercise = new Map(nextSessions.map((n) => [n.exerciseId, n]));

  return day.exercises.map((pe) => {
    const next = byExercise.get(pe.exercise_id);
    const targetWeight = next?.target.weight;
    const hasHistory =
      next != null &&
      Number.isFinite(targetWeight) &&
      (targetWeight! > 0 || (pe.equipment === "bodyweight" && targetWeight === 0));

    // The plan owns the normal prescription. A deload is the one explicit
    // adaptation: roughly half the planned sets and an RPE ceiling of 6. The
    // existing progression rule owns the corresponding 15% load reduction.
    const prescribedSets = options.deload
      ? Math.max(1, Math.ceil(pe.sets / 2))
      : Math.max(1, pe.sets);
    const prescribedRpe = options.deload
      ? Math.min(pe.rpe_target ?? 6, 6)
      : pe.rpe_target;

    const reps = hasHistory
      ? repsWithinRange(next!.target.reps, pe.rep_low, pe.rep_high)
      : pe.rep_low;

    let repsAdjusted: RepsAdjustment = "none";
    let conflict: string | null = null;
    if (hasHistory) {
      const suggested = next!.target.reps;
      if (suggested < pe.rep_low) {
        repsAdjusted = "raised_to_floor";
        const last = next!.last;
        const atRpe = last.rpe != null ? `, RPE ${last.rpe}` : "";
        conflict =
          `Last time you got ${last.reps} at ${last.weight} ${units}${atRpe}. ` +
          `This plan asks for ${pe.rep_low}, so consider dropping the load to hit the range.`;
      } else if (suggested > pe.rep_high) {
        repsAdjusted = "lowered_to_ceiling";
        conflict =
          `You could do more than ${pe.rep_high} reps here. ` +
          `The plan caps the range, so add load once ${pe.rep_high} feels comfortable.`;
      }
    }

    // Blank rather than zero when there is no history. An empty field reads as
    // "tell me", a zero reads as an answer the app does not have.
    const weight = hasHistory ? String(next!.target.weight) : "";
    const rpe = prescribedRpe != null ? String(prescribedRpe) : "";
    const note = options.deload
      ? (next?.note ?? "Deload week, half the sets and keep every set at RPE 6 or below.")
      : (next?.note ?? null);

    return {
      exerciseId: pe.exercise_id,
      name: pe.name,
      muscleGroup: pe.muscle_group,
      target: {
        sets: prescribedSets,
        repLow: pe.rep_low,
        repHigh: pe.rep_high,
        rpe: prescribedRpe,
        restSeconds: pe.rest_seconds,
        role: pe.role,
      },
      // One row per prescribed set, all identical. The athlete edits the ones
      // that differ, which on a normal session is none of them.
      sets: Array.from({ length: prescribedSets }, () => ({
        reps: String(reps),
        weight,
        rpe,
      })),
      weightBasis: hasHistory ? "progression" : "no_history",
      note,
      repsAdjusted,
      conflict,
    };
  });
}

/** "4 x 5-8 @ RPE 8" — the target line shown under each exercise. */
export function targetLabel(t: PlannedExercise["target"]): string {
  const reps = t.repLow === t.repHigh ? `${t.repLow}` : `${t.repLow}-${t.repHigh}`;
  const base = `${t.sets} x ${reps}`;
  return t.rpe != null ? `${base} @ RPE ${t.rpe}` : base;
}

/** How many of the prescribed sets are fully filled in. */
export function completedSetCount(sets: PlannedSet[]): number {
  return sets.filter((s) => s.reps !== "" && s.weight !== "").length;
}

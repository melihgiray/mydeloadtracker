import { round1 } from "@/lib/analytics/epley";
import type { Units } from "@/lib/types";

export interface CompletedSetForAdjustment {
  reps: number;
  weight: number;
  rpe: number | null;
}

export interface LiveSetTarget {
  repLow: number;
  repHigh: number;
  rpe: number | null;
}

export interface LiveSetAdjustment {
  direction: "progress" | "back_off";
  reps: number;
  weight: number;
  reason: string;
}

function lighterWeight(weight: number, units: Units): number {
  const step = units === "kg" ? 2.5 : 5;
  if (weight <= step) return round1(weight * 0.9);
  const fivePercentLighter = Math.round((weight * 0.95) / step) * step;
  return round1(Math.min(weight - step, fivePercentLighter));
}

/**
 * Adjust only the next set, using the completed set and today's plan target.
 * It is deliberately conservative and returns null when the evidence does not
 * justify changing the prescription.
 */
export function buildLiveSetAdjustment(
  completed: CompletedSetForAdjustment,
  target: LiveSetTarget,
  units: Units,
): LiveSetAdjustment | null {
  if (
    !Number.isFinite(completed.reps) ||
    completed.reps <= 0 ||
    !Number.isFinite(completed.weight) ||
    completed.weight < 0 ||
    (completed.rpe != null && (!Number.isFinite(completed.rpe) || completed.rpe < 1 || completed.rpe > 10))
  ) {
    return null;
  }

  const missedRepFloor = completed.reps < target.repLow;
  const tooHard =
    completed.rpe != null &&
    (completed.rpe >= 9.5 || (target.rpe != null && completed.rpe >= target.rpe + 1));

  if (missedRepFloor || tooHard) {
    if (completed.weight === 0) {
      const reps = tooHard ? Math.max(1, completed.reps - 1) : completed.reps;
      return {
        direction: "back_off",
        weight: 0,
        reps,
        reason: tooHard
          ? `That set reached RPE ${completed.rpe}. Take one rep off the next set.`
          : `That set missed the rep floor. Keep the next set at ${reps} clean reps.`,
      };
    }

    const reps = Math.max(target.repLow, Math.min(completed.reps, target.repHigh));
    return {
      direction: "back_off",
      weight: lighterWeight(completed.weight, units),
      reps,
      reason: missedRepFloor
        ? `That set missed the ${target.repLow} rep floor. Reduce the load for the next set.`
        : `That set reached RPE ${completed.rpe}. Reduce the load for the next set.`,
    };
  }

  const feltEasy =
    completed.rpe != null && target.rpe != null && completed.rpe <= target.rpe - 1;
  if (!feltEasy) return null;

  if (completed.reps < target.repHigh) {
    return {
      direction: "progress",
      weight: completed.weight,
      reps: completed.reps + 1,
      reason: `That set was below the RPE ${target.rpe} target. Add one rep next set.`,
    };
  }

  if (completed.weight === 0) return null;
  const step = units === "kg" ? 2.5 : 5;
  return {
    direction: "progress",
    weight: round1(completed.weight + step),
    reps: target.repLow,
    reason: `You reached the top of the range below RPE ${target.rpe}. Add a small amount of load.`,
  };
}

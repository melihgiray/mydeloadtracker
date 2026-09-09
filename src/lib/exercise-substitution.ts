import { sameStimulus } from "@/lib/exercise-profile";
import { exerciseConflictsWithAvoid } from "@/lib/plan-validation";
import type { PlannedExercise, PlannedSet } from "@/lib/plan-session";
import type { Exercise } from "@/lib/types";

export interface ExerciseSubstitutionCandidate {
  exercise: Exercise;
  match: "same_stimulus" | "same_movement" | "same_muscle";
}

function normalized(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Rank safe, available alternatives without changing the underlying plan. */
export function buildExerciseSubstitutions(
  current: Exercise,
  library: Exercise[],
  usedExerciseIds: ReadonlySet<string>,
  options: { equipment?: string[]; avoid?: string[] } = {},
): ExerciseSubstitutionCandidate[] {
  const allowedEquipment = new Set((options.equipment ?? []).map(normalized));
  const hasEquipmentLimit = allowedEquipment.size > 0;
  const currentMuscle = normalized(current.muscle_group);
  const currentMovement = normalized(current.movement_pattern);

  return library
    .filter((exercise) => {
      if (exercise.id === current.id || usedExerciseIds.has(exercise.id)) return false;
      if (normalized(exercise.muscle_group) !== currentMuscle) return false;
      if (
        hasEquipmentLimit &&
        (exercise.equipment == null || !allowedEquipment.has(normalized(exercise.equipment)))
      ) {
        return false;
      }
      return exerciseConflictsWithAvoid(exercise, options.avoid ?? []) == null;
    })
    .map((exercise) => {
      let match: ExerciseSubstitutionCandidate["match"] = "same_muscle";
      if (sameStimulus(current, exercise)) match = "same_stimulus";
      else if (
        currentMovement !== "" &&
        normalized(exercise.movement_pattern) === currentMovement
      ) {
        match = "same_movement";
      }
      return { exercise, match };
    })
    .sort((a, b) => {
      const matchScore = { same_stimulus: 0, same_movement: 1, same_muscle: 2 };
      const matchDifference = matchScore[a.match] - matchScore[b.match];
      if (matchDifference !== 0) return matchDifference;
      const aEquipment = normalized(a.exercise.equipment) === normalized(current.equipment) ? 0 : 1;
      const bEquipment = normalized(b.exercise.equipment) === normalized(current.equipment) ? 0 : 1;
      if (aEquipment !== bEquipment) return aEquipment - bEquipment;
      return a.exercise.name.localeCompare(b.exercise.name);
    });
}

/** Reset exercise-specific performance while preserving the intended set count. */
export function resetSetsForSubstitution(
  sets: PlannedSet[],
  target?: PlannedExercise["target"],
): PlannedSet[] {
  return sets.map((set) => ({
    ...set,
    reps: target ? String(target.repLow) : set.reps,
    weight: "",
    rpe: target?.rpe != null ? String(target.rpe) : "",
    origin: "manual",
    completed: false,
  }));
}

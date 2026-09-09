import type { SessionWithSets } from "@/lib/data";
import type { Units } from "@/lib/types";
import { round1 } from "@/lib/analytics/epley";

/** Exact, human-readable session data added when Coach is opened from a workout. */
export function buildWorkoutCoachContext(session: SessionWithSets, units: Units): string {
  const byExercise = new Map<string, SessionWithSets["sets"]>();
  for (const set of session.sets) {
    const sets = byExercise.get(set.exerciseId) ?? [];
    sets.push(set);
    byExercise.set(set.exerciseId, sets);
  }

  const exercises = [...byExercise.values()].map((sets) => {
    const name = sets[0].exerciseName;
    const details = sets.map((set, index) => {
      const load = set.weight > 0 ? `${round1(set.weight)} ${units}` : "bodyweight";
      const effort = set.rpe != null ? `, RPE ${round1(set.rpe)}` : ", RPE not logged";
      return `set ${index + 1}: ${load} x ${set.reps}${effort}`;
    });
    return `${name}: ${details.join("; ")}`;
  });

  return [
    "=== SELECTED WORKOUT ===",
    `Date: ${session.performed_at.slice(0, 10)}`,
    `Notes: ${session.notes?.trim() || "None"}`,
    ...exercises,
    "The athlete opened Coach from this workout. Review this exact session when they refer to this workout.",
  ].join("\n");
}

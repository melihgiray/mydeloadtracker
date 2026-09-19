import type { SessionWithSets } from "@/lib/data";
import type { StoredPlanSessionContext } from "@/lib/plan-adherence";
import type { Units } from "@/lib/types";
import { round1 } from "@/lib/analytics/epley";

/** Exact, human-readable session data added when Coach is opened from a workout. */
export function buildWorkoutCoachContext(
  session: SessionWithSets,
  units: Units,
  planContext: StoredPlanSessionContext | null = null,
): string {
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

  const lines = [
    "=== SELECTED WORKOUT ===",
    `Date: ${session.performed_at.slice(0, 10)}`,
    `Notes: ${session.notes?.trim() || "None"}`,
    ...exercises,
    "The athlete opened Coach from this workout. Review this exact session when they refer to this workout.",
  ];

  if (planContext?.sessionId === session.id) {
    const plannedActualIds = new Set<string>();
    const comparisons = planContext.snapshot.planned.map((planned) => {
      const actualId =
        planContext.snapshot.substitutions.find(
          (substitution) => substitution.plannedExerciseId === planned.exerciseId,
        )?.performedExerciseId ?? planned.exerciseId;
      plannedActualIds.add(actualId);
      const actualSets = session.sets.filter((set) => set.exerciseId === actualId);
      const target = [
        `${planned.sets} sets of ${planned.repLow} to ${planned.repHigh} reps`,
        planned.rpeTarget != null ? `RPE ${planned.rpeTarget}` : null,
      ].filter(Boolean).join(", ");
      if (actualSets.length === 0) return `${planned.name}: planned ${target}. Not logged.`;

      const actualName = actualSets[0].exerciseName;
      const substitution = actualId !== planned.exerciseId ? ` as ${actualName}` : "";
      const reps = actualSets.map((set) => set.reps).join(", ");
      const rpes = actualSets
        .map((set) => (set.rpe != null ? String(round1(set.rpe)) : "not logged"))
        .join(", ");
      const setLabel = actualSets.length === 1 ? "set" : "sets";
      return `${planned.name}: planned ${target}. Performed${substitution}: ${actualSets.length} ${setLabel}, reps ${reps}, RPE ${rpes}.`;
    });

    const additional = [...new Map(
      session.sets
        .filter((set) => !plannedActualIds.has(set.exerciseId))
        .map((set) => [set.exerciseId, set.exerciseName]),
    ).values()];

    lines.push(
      "",
      "=== PLAN PRESCRIPTION FOR THIS WORKOUT ===",
      `Plan day: ${planContext.snapshot.dayName}`,
      ...comparisons,
      ...(additional.length > 0
        ? [`Additional work not in the saved plan: ${additional.join(", ")}.`]
        : []),
    );
  }

  return lines.join("\n");
}

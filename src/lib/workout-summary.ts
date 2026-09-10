import { estimate1RM, round1 } from "@/lib/analytics/epley";
import { buildNextSessions, type NextSession } from "@/lib/analytics/progression";
import type { SessionWithSets } from "@/lib/data";
import type { TrainingSet, Units } from "@/lib/types";

export interface WorkoutExerciseSummary {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  movementPattern: string | null;
  setCount: number;
  topSet: {
    weight: number;
    reps: number;
    rpe: number | null;
    estimated1RM: number;
  };
  isPr: boolean;
  next: NextSession | null;
}

export interface WorkoutSummary {
  exerciseCount: number;
  setCount: number;
  averageRpe: number | null;
  prNames: string[];
  exercises: WorkoutExerciseSummary[];
}

function asTrainingSet(
  session: SessionWithSets,
  set: SessionWithSets["sets"][number],
): TrainingSet {
  return {
    date: session.performed_at,
    sessionId: session.id,
    exerciseId: set.exerciseId,
    exerciseName: set.exerciseName,
    muscleGroup: set.muscleGroup,
    isMajor: set.isMajor,
    reps: set.reps,
    weight: set.weight,
    rpe: set.rpe,
  };
}

function topSet(sets: TrainingSet[]): TrainingSet {
  const hasLoad = sets.some((set) => set.weight > 0);
  return sets.reduce((best, set) => {
    if (!hasLoad) return set.reps > best.reps ? set : best;
    return estimate1RM(set.weight, set.reps) > estimate1RM(best.weight, best.reps) ? set : best;
  });
}

function beatsPriorBest(current: TrainingSet, prior: TrainingSet[]): boolean {
  if (prior.length === 0) return false;
  if (current.weight <= 0 && prior.every((set) => set.weight <= 0)) {
    return current.reps > Math.max(...prior.map((set) => set.reps));
  }
  const previousBest = Math.max(...prior.map((set) => estimate1RM(set.weight, set.reps)));
  return estimate1RM(current.weight, current.reps) > previousBest + 0.01;
}

export function buildWorkoutSummary(
  session: SessionWithSets,
  history: TrainingSet[],
  units: Units,
): WorkoutSummary {
  const currentSets = session.sets.map((set) => asTrainingSet(session, set));
  const byExercise = new Map<string, TrainingSet[]>();
  for (const set of currentSets) {
    const exerciseSets = byExercise.get(set.exerciseId) ?? [];
    exerciseSets.push(set);
    byExercise.set(set.exerciseId, exerciseSets);
  }

  const nextByExercise = new Map(
    buildNextSessions(history, { units }).map((next) => [next.exerciseId, next]),
  );

  const exercises = [...byExercise.entries()].map(([exerciseId, sets]) => {
    const top = topSet(sets);
    const prior = history.filter(
      (set) =>
        set.exerciseId === exerciseId &&
        set.sessionId !== session.id &&
        set.date < session.performed_at,
    );
    const latestDate = history
      .filter((set) => set.exerciseId === exerciseId)
      .reduce((latest, set) => (set.date > latest ? set.date : latest), "");
    const first = session.sets.find((set) => set.exerciseId === exerciseId)!;

    return {
      exerciseId,
      name: first.exerciseName,
      muscleGroup: first.muscleGroup,
      movementPattern: first.movementPattern,
      setCount: sets.length,
      topSet: {
        weight: top.weight,
        reps: top.reps,
        rpe: top.rpe,
        estimated1RM: round1(estimate1RM(top.weight, top.reps)),
      },
      isPr: beatsPriorBest(top, prior),
      next: latestDate === session.performed_at ? (nextByExercise.get(exerciseId) ?? null) : null,
    } satisfies WorkoutExerciseSummary;
  });

  const rpes = currentSets.map((set) => set.rpe).filter((rpe): rpe is number => rpe != null);
  const prNames = exercises.filter((exercise) => exercise.isPr).map((exercise) => exercise.name);

  return {
    exerciseCount: exercises.length,
    setCount: currentSets.length,
    averageRpe: rpes.length ? round1(rpes.reduce((sum, rpe) => sum + rpe, 0) / rpes.length) : null,
    prNames,
    exercises,
  };
}

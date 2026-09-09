import type { PlannedExercise } from "@/lib/plan-session";
import type { TrainingSet } from "@/lib/types";

export interface PlanExerciseSnapshot {
  exerciseId: string;
  name: string;
  position: number;
  sets: number;
  repLow: number;
  repHigh: number;
  rpeTarget: number | null;
}

export interface PlanSubstitutionSnapshot {
  plannedExerciseId: string;
  performedExerciseId: string;
}

export interface PlanSessionSnapshot {
  version: 1;
  dayIndex: number;
  dayName: string;
  planned: PlanExerciseSnapshot[];
  substitutions: PlanSubstitutionSnapshot[];
}

export interface PlanSessionContextInput {
  planId: string;
  planDayId: string;
  dayIndex: number;
  dayName: string;
}

export interface PlanSessionEntry {
  exerciseId: string;
  plannedExerciseId?: string;
}

export interface StoredPlanSessionContext {
  sessionId: string;
  performedAt: string;
  planId: string;
  planDayId: string;
  snapshot: PlanSessionSnapshot;
}

export function buildPlanSessionSnapshot(
  context: Pick<PlanSessionContextInput, "dayIndex" | "dayName">,
  planned: PlannedExercise[],
  entries: PlanSessionEntry[],
): PlanSessionSnapshot {
  const plannedIds = new Set(planned.map((exercise) => exercise.exerciseId));
  const substitutions = entries.flatMap((entry): PlanSubstitutionSnapshot[] => {
    const original = entry.plannedExerciseId ??
      (plannedIds.has(entry.exerciseId) ? entry.exerciseId : null);
    if (!original || original === entry.exerciseId) return [];
    return [{ plannedExerciseId: original, performedExerciseId: entry.exerciseId }];
  });

  return {
    version: 1,
    dayIndex: context.dayIndex,
    dayName: context.dayName,
    planned: planned.map((exercise, position) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      position,
      sets: exercise.target.sets,
      repLow: exercise.target.repLow,
      repHigh: exercise.target.repHigh,
      rpeTarget: exercise.target.rpe,
    })),
    substitutions,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isPlanSessionSnapshot(value: unknown): value is PlanSessionSnapshot {
  const snapshot = record(value);
  if (!snapshot || snapshot.version !== 1) return false;
  if (!Number.isInteger(snapshot.dayIndex) || (snapshot.dayIndex as number) < 0) return false;
  if (typeof snapshot.dayName !== "string" || !Array.isArray(snapshot.planned)) return false;
  if (!Array.isArray(snapshot.substitutions)) return false;

  const validPlanned = snapshot.planned.every((item) => {
    const exercise = record(item);
    return (
      exercise != null &&
      typeof exercise.exerciseId === "string" &&
      typeof exercise.name === "string" &&
      Number.isInteger(exercise.position) &&
      Number.isInteger(exercise.sets) &&
      Number.isInteger(exercise.repLow) &&
      Number.isInteger(exercise.repHigh) &&
      (exercise.rpeTarget === null || typeof exercise.rpeTarget === "number")
    );
  });
  const validSubstitutions = snapshot.substitutions.every((item) => {
    const substitution = record(item);
    return (
      substitution != null &&
      typeof substitution.plannedExerciseId === "string" &&
      typeof substitution.performedExerciseId === "string"
    );
  });
  return validPlanned && validSubstitutions;
}

function actualExerciseId(context: StoredPlanSessionContext, plannedExerciseId: string): string {
  return (
    context.snapshot.substitutions.find(
      (substitution) => substitution.plannedExerciseId === plannedExerciseId,
    )?.performedExerciseId ?? plannedExerciseId
  );
}

/** Compact durable memory for the general Coach prompt. */
export function summarisePlanAdherenceMemory(
  contexts: StoredPlanSessionContext[],
  sets: TrainingSet[],
): string | null {
  if (contexts.length === 0) return null;
  const setsBySession = new Map<string, TrainingSet[]>();
  for (const set of sets) {
    const sessionSets = setsBySession.get(set.sessionId) ?? [];
    sessionSets.push(set);
    setsBySession.set(set.sessionId, sessionSets);
  }

  const recent = contexts
    .slice()
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))
    .slice(0, 12);
  const lines = recent.map((context) => {
    const sessionSets = setsBySession.get(context.sessionId) ?? [];
    let plannedSets = 0;
    let loggedSets = 0;
    const missed: string[] = [];
    const swaps: string[] = [];

    for (const planned of context.snapshot.planned) {
      plannedSets += planned.sets;
      const actualId = actualExerciseId(context, planned.exerciseId);
      const completed = sessionSets.filter((set) => set.exerciseId === actualId).length;
      loggedSets += completed;
      if (completed === 0) missed.push(planned.name);
      if (actualId !== planned.exerciseId) {
        const actualName = sessionSets.find((set) => set.exerciseId === actualId)?.exerciseName;
        swaps.push(`${planned.name} to ${actualName ?? "another exercise"}`);
      }
    }

    const details = [`logged ${loggedSets} of ${plannedSets} planned sets`];
    if (missed.length > 0) details.push(`missed ${missed.join(", ")}`);
    if (swaps.length > 0) details.push(`swapped ${swaps.join(", ")}`);
    return `${context.performedAt.slice(0, 10)} ${context.snapshot.dayName}: ${details.join(". ")}.`;
  });

  return ["=== PLAN ADHERENCE MEMORY ===", ...lines].join("\n");
}

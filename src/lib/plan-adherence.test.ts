import { describe, expect, it } from "vitest";
import {
  buildPlanSessionSnapshot,
  isPlanSessionSnapshot,
  summarisePlanAdherenceMemory,
  type StoredPlanSessionContext,
} from "@/lib/plan-adherence";
import type { PlannedExercise } from "@/lib/plan-session";
import type { TrainingSet } from "@/lib/types";

const planned: PlannedExercise = {
  exerciseId: "bench",
  name: "Bench Press",
  muscleGroup: "Chest",
  target: { sets: 3, repLow: 5, repHigh: 8, rpe: 8, restSeconds: 180, role: "primary" },
  sets: [],
  weightBasis: "no_history",
  note: null,
  repsAdjusted: "none",
  conflict: null,
};

describe("plan session snapshots", () => {
  it("captures the prescription and today-only substitutions", () => {
    const snapshot = buildPlanSessionSnapshot(
      { dayIndex: 0, dayName: "Upper A" },
      [planned],
      [{ exerciseId: "db-bench", plannedExerciseId: "bench" }],
    );

    expect(snapshot.planned[0]).toMatchObject({ exerciseId: "bench", sets: 3, repLow: 5, repHigh: 8 });
    expect(snapshot.substitutions).toEqual([
      { plannedExerciseId: "bench", performedExerciseId: "db-bench" },
    ]);
    expect(isPlanSessionSnapshot(snapshot)).toBe(true);
  });

  it("rejects malformed persisted JSON", () => {
    expect(isPlanSessionSnapshot({ version: 1, dayIndex: 0, dayName: "A", planned: "bad" })).toBe(false);
    expect(isPlanSessionSnapshot({ version: 2, planned: [], substitutions: [] })).toBe(false);
  });
});

describe("summarisePlanAdherenceMemory", () => {
  it("remembers exact set adherence, misses, and substitutions", () => {
    const snapshot = buildPlanSessionSnapshot(
      { dayIndex: 0, dayName: "Upper A" },
      [planned, { ...planned, exerciseId: "row", name: "Barbell Row", target: { ...planned.target, sets: 2 } }],
      [{ exerciseId: "db-bench", plannedExerciseId: "bench" }, { exerciseId: "row", plannedExerciseId: "row" }],
    );
    const context: StoredPlanSessionContext = {
      sessionId: "session",
      performedAt: "2026-09-08T12:00:00.000Z",
      planId: "plan",
      planDayId: "day",
      snapshot,
    };
    const sets: TrainingSet[] = [
      {
        date: context.performedAt,
        sessionId: context.sessionId,
        exerciseId: "db-bench",
        exerciseName: "Dumbbell Bench Press",
        muscleGroup: "Chest",
        isMajor: true,
        reps: 8,
        weight: 30,
        rpe: 8,
      },
      {
        date: context.performedAt,
        sessionId: context.sessionId,
        exerciseId: "db-bench",
        exerciseName: "Dumbbell Bench Press",
        muscleGroup: "Chest",
        isMajor: true,
        reps: 8,
        weight: 30,
        rpe: 8,
      },
    ];

    const memory = summarisePlanAdherenceMemory([context], sets);
    expect(memory).toContain("logged 2 of 5 planned sets");
    expect(memory).toContain("missed Barbell Row");
    expect(memory).toContain("swapped Bench Press to Dumbbell Bench Press");
  });

  it("stays absent when no workout has durable plan context", () => {
    expect(summarisePlanAdherenceMemory([], [])).toBeNull();
  });
});

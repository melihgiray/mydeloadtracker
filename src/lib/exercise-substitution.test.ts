import { describe, expect, it } from "vitest";
import {
  buildExerciseSubstitutions,
  resetSetsForSubstitution,
} from "@/lib/exercise-substitution";
import type { Exercise } from "@/lib/types";

function exercise(overrides: Partial<Exercise>): Exercise {
  return {
    id: "bench",
    user_id: null,
    name: "Barbell Bench Press",
    muscle_group: "Chest",
    movement_pattern: "Horizontal Push",
    equipment: "barbell",
    is_major: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const current = exercise({});
const library = [
  current,
  exercise({ id: "db-bench", name: "Dumbbell Bench Press", equipment: "dumbbell" }),
  exercise({ id: "pushup", name: "Push Up", equipment: "bodyweight" }),
  exercise({
    id: "fly",
    name: "Cable Chest Fly",
    movement_pattern: "Horizontal Adduction",
    equipment: "cable",
    is_major: false,
  }),
  exercise({
    id: "row",
    name: "Barbell Row",
    muscle_group: "Back",
    movement_pattern: "Horizontal Pull",
  }),
];

describe("buildExerciseSubstitutions", () => {
  it("ranks the closest training stimulus before broader muscle matches", () => {
    const result = buildExerciseSubstitutions(current, library, new Set());

    expect(result.map((candidate) => candidate.exercise.id)).toEqual([
      "db-bench",
      "pushup",
      "fly",
    ]);
    expect(result.map((candidate) => candidate.match)).toEqual([
      "same_stimulus",
      "same_stimulus",
      "same_muscle",
    ]);
  });

  it("excludes exercises already used in the active workout", () => {
    const result = buildExerciseSubstitutions(current, library, new Set(["db-bench"]));
    expect(result.some((candidate) => candidate.exercise.id === "db-bench")).toBe(false);
  });

  it("respects the plan's available equipment", () => {
    const result = buildExerciseSubstitutions(current, library, new Set(), {
      equipment: ["dumbbell", "cable"],
    });
    expect(result.map((candidate) => candidate.exercise.id)).toEqual(["db-bench", "fly"]);
  });

  it("does not offer alternatives that conflict with an athlete restriction", () => {
    const result = buildExerciseSubstitutions(current, library, new Set(), {
      avoid: ["dumbbell"],
    });
    expect(result.some((candidate) => candidate.exercise.id === "db-bench")).toBe(false);
  });
});

describe("resetSetsForSubstitution", () => {
  it("clears exercise-specific performance and keeps the planned prescription", () => {
    const sets = resetSetsForSubstitution(
      [{ reps: "9", weight: "100", rpe: "9", origin: "plan", completed: true }],
      { sets: 3, repLow: 6, repHigh: 10, rpe: 8, restSeconds: 120, role: "secondary" },
    );

    expect(sets).toEqual([
      { reps: "6", weight: "", rpe: "8", origin: "manual", completed: false },
    ]);
  });

  it("preserves intended reps but clears effort when there is no plan target", () => {
    expect(
      resetSetsForSubstitution([
        { reps: "12", weight: "20", rpe: "9", origin: "manual", completed: false },
      ]),
    ).toEqual([
      { reps: "12", weight: "", rpe: "", origin: "manual", completed: false },
    ]);
  });
});

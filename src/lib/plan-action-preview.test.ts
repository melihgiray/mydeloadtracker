import { describe, expect, it } from "vitest";
import { previewPlanActions } from "@/lib/plan-action-preview";
import type { Exercise, PlanWithDays } from "@/lib/types";

const exercise = (id: string, name: string): Exercise => ({
  id,
  user_id: null,
  name,
  muscle_group: "Chest",
  movement_pattern: "Horizontal Push",
  equipment: "barbell",
  is_major: true,
  created_at: "2026-01-01T00:00:00.000Z",
});

const library = [exercise("bench", "Bench Press"), exercise("db", "Dumbbell Bench Press")];
const plan: PlanWithDays = {
  id: "plan",
  user_id: "user",
  name: "Strength",
  goal: "strength",
  split: "full_body",
  days_per_week: 1,
  session_minutes: 60,
  equipment: ["barbell"],
  avoid: [],
  mesocycle_weeks: 5,
  deload_week: 5,
  notes: null,
  active: true,
  started_on: "2026-09-01",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  last_reviewed_on: null,
  training_style: null,
  days: [
    {
      id: "day",
      plan_id: "plan",
      day_index: 0,
      name: "Upper A",
      focus: "chest",
      exercises: [
        {
          id: "row",
          plan_day_id: "day",
          exercise_id: "bench",
          position: 0,
          sets: 3,
          rep_low: 5,
          rep_high: 8,
          rpe_target: 8,
          rest_seconds: 180,
          role: "primary",
          note: null,
          name: "Bench Press",
          muscle_group: "Chest",
          equipment: "barbell",
        },
      ],
    },
  ],
};

describe("previewPlanActions", () => {
  it("shows the exact exercise before and after a swap", () => {
    const result = previewPlanActions(
      plan,
      [{ op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "db", reason: "Easier setup." }],
      library,
    );

    expect(result.changes).toEqual([
      {
        title: "Swap an exercise in Upper A",
        before: "Bench Press",
        after: "Dumbbell Bench Press",
        reason: "Easier setup.",
      },
    ]);
  });

  it("describes sequential actions against the proposed state", () => {
    const result = previewPlanActions(
      plan,
      [
        { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "db", reason: "Easier setup." },
        { op: "set_prescription", dayIndex: 0, position: 0, sets: 4, reason: "Add one set." },
      ],
      library,
    );

    expect(result.changes[1]).toMatchObject({
      title: "Update Dumbbell Bench Press in Upper A",
      before: "3 sets, 5 to 8 reps, RPE 8",
      after: "4 sets, 5 to 8 reps, RPE 8",
    });
  });

  it("returns rejected actions without presenting them as changes", () => {
    const result = previewPlanActions(
      plan,
      [{ op: "remove_exercise", dayIndex: 0, position: 0, reason: "Remove it." }],
      library,
    );

    expect(result.applied).toEqual([]);
    expect(result.changes).toEqual([]);
    expect(result.rejected[0].error).toContain("left empty");
  });
});

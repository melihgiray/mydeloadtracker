import { describe, expect, it } from "vitest";
import { summariseActivePlan } from "@/lib/active-plan-context";
import type { PlanWithDays } from "@/lib/types";

const plan: PlanWithDays = {
  id: "plan-id",
  user_id: "user-id",
  name: "Strength block",
  goal: "strength",
  split: "upper_lower",
  days_per_week: 2,
  session_minutes: 60,
  equipment: ["barbell", "rack"],
  avoid: ["overhead pressing"],
  mesocycle_weeks: 5,
  deload_week: 5,
  notes: null,
  active: true,
  started_on: "2026-09-01",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  last_reviewed_on: null,
  training_style: "Low volume with focused main lifts",
  days: [
    {
      id: "upper-id",
      plan_id: "plan-id",
      day_index: 0,
      name: "Upper A",
      focus: "Pressing strength",
      exercises: [
        {
          id: "planned-bench",
          plan_day_id: "upper-id",
          exercise_id: "bench-id",
          position: 0,
          sets: 3,
          rep_low: 5,
          rep_high: 8,
          rpe_target: 8,
          rest_seconds: 180,
          role: "primary",
          note: "Pause the first rep",
          name: "Bench Press",
          muscle_group: "Chest",
          equipment: "barbell",
        },
      ],
    },
    {
      id: "lower-id",
      plan_id: "plan-id",
      day_index: 1,
      name: "Lower A",
      focus: null,
      exercises: [],
    },
  ],
};

describe("summariseActivePlan", () => {
  it("gives Coach the full prescription and marks the current rotation day", () => {
    const context = summariseActivePlan(plan, plan.days[1], "2026-09-09");

    expect(context).toContain("=== ACTIVE TRAINING PLAN ===");
    expect(context).toContain("Cycle: week 2 of 5. Deload is scheduled for week 5.");
    expect(context).toContain("Training style: Low volume with focused main lifts.");
    expect(context).toContain("Avoid: overhead pressing.");
    expect(context).toContain(
      "Bench Press (3 sets of 5 to 8 reps, RPE 8, 180 seconds rest, primary, note: Pause the first rep)",
    );
    expect(context).toContain("Day 2, Lower A. Current rotation day.");
    expect(context).not.toContain("Day 1, Upper A. Current rotation day.");
  });

  it("bounds free text before it enters the model context", () => {
    const context = summariseActivePlan(
      {
        ...plan,
        name: "n".repeat(200),
        training_style: "s".repeat(300),
        days: [{
          ...plan.days[0],
          exercises: [{ ...plan.days[0].exercises[0], name: "e".repeat(200) }],
        }],
      },
      plan.days[0],
      "2026-09-01",
    );

    expect(context).not.toContain("n".repeat(101));
    expect(context).not.toContain("s".repeat(161));
    expect(context).not.toContain("e".repeat(81));
  });
});

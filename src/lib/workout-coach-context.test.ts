import { describe, expect, it } from "vitest";
import type { SessionWithSets } from "@/lib/data";
import { buildWorkoutCoachContext } from "@/lib/workout-coach-context";

const session: SessionWithSets = {
  id: "session-1",
  performed_at: "2026-09-08T19:00:00.000Z",
  notes: "Felt steady",
  sets: [
    {
      id: "set-1",
      reps: 5,
      weight: 100,
      rpe: 8,
      set_number: 1,
      exerciseId: "squat",
      exerciseName: "Back Squat",
      muscleGroup: "Quads",
      movementPattern: "Squat",
      isMajor: true,
    },
    {
      id: "set-2",
      reps: 6,
      weight: 0,
      rpe: null,
      set_number: 1,
      exerciseId: "pullup",
      exerciseName: "Pull Up",
      muscleGroup: "Back",
      movementPattern: "Vertical Pull",
      isMajor: true,
    },
  ],
};

describe("buildWorkoutCoachContext", () => {
  it("serializes the exact workout with units, effort, and notes", () => {
    const context = buildWorkoutCoachContext(session, "kg");

    expect(context).toContain("Date: 2026-09-08");
    expect(context).toContain("Notes: Felt steady");
    expect(context).toContain("Back Squat: set 1: 100 kg x 5, RPE 8");
    expect(context).toContain("Pull Up: set 1: bodyweight x 6, RPE not logged");
  });

  it("states plainly when the workout has no notes", () => {
    expect(buildWorkoutCoachContext({ ...session, notes: null }, "lb")).toContain("Notes: None");
  });

  it("compares the workout with its saved prescription rather than the current plan", () => {
    const context = buildWorkoutCoachContext(session, "kg", {
      sessionId: session.id,
      performedAt: session.performed_at,
      planId: "old-plan",
      planDayId: "old-day",
      snapshot: {
        version: 1,
        dayIndex: 0,
        dayName: "Upper A",
        planned: [
          {
            exerciseId: "bench",
            name: "Bench Press",
            position: 0,
            sets: 3,
            repLow: 5,
            repHigh: 8,
            rpeTarget: 8,
          },
          {
            exerciseId: "row",
            name: "Barbell Row",
            position: 1,
            sets: 2,
            repLow: 8,
            repHigh: 10,
            rpeTarget: null,
          },
        ],
        substitutions: [
          { plannedExerciseId: "bench", performedExerciseId: "squat" },
        ],
      },
    });

    expect(context).toContain("=== PLAN PRESCRIPTION FOR THIS WORKOUT ===");
    expect(context).toContain("Plan day: Upper A");
    expect(context).toContain(
      "Bench Press: planned 3 sets of 5 to 8 reps, RPE 8. Performed as Back Squat: 1 set, reps 5, RPE 8.",
    );
    expect(context).toContain("Barbell Row: planned 2 sets of 8 to 10 reps. Not logged.");
  });

  it("names work that was added outside the saved plan", () => {
    const context = buildWorkoutCoachContext(session, "kg", {
      sessionId: session.id,
      performedAt: session.performed_at,
      planId: "plan",
      planDayId: "day",
      snapshot: {
        version: 1,
        dayIndex: 0,
        dayName: "Lower A",
        planned: [],
        substitutions: [],
      },
    });

    expect(context).toContain("Additional work not in the saved plan: Back Squat, Pull Up.");
  });
});

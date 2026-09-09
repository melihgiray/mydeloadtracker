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
});

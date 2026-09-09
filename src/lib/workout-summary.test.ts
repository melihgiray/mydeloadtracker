import { describe, expect, it } from "vitest";
import type { SessionWithSets } from "@/lib/data";
import type { TrainingSet } from "@/lib/types";
import { buildWorkoutSummary } from "@/lib/workout-summary";

const session: SessionWithSets = {
  id: "current",
  performed_at: "2026-09-08T12:00:00.000Z",
  notes: "Good session",
  sets: [
    {
      id: "a1",
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
      id: "a2",
      reps: 6,
      weight: 95,
      rpe: 7,
      set_number: 2,
      exerciseId: "squat",
      exerciseName: "Back Squat",
      muscleGroup: "Quads",
      movementPattern: "Squat",
      isMajor: true,
    },
  ],
};

function trainingSet(overrides: Partial<TrainingSet> = {}): TrainingSet {
  return {
    date: "2026-09-01T12:00:00.000Z",
    sessionId: "prior",
    exerciseId: "squat",
    exerciseName: "Back Squat",
    muscleGroup: "Quads",
    isMajor: true,
    reps: 5,
    weight: 90,
    rpe: 8,
    ...overrides,
  };
}

const currentHistory = session.sets.map((set) =>
  trainingSet({
    date: session.performed_at,
    sessionId: session.id,
    reps: set.reps,
    weight: set.weight,
    rpe: set.rpe,
  }),
);

describe("buildWorkoutSummary", () => {
  it("groups sets and reports the average effort and strongest set", () => {
    const summary = buildWorkoutSummary(session, currentHistory, "kg");

    expect(summary).toMatchObject({ exerciseCount: 1, setCount: 2, averageRpe: 7.5 });
    expect(summary.exercises[0]).toMatchObject({
      name: "Back Squat",
      setCount: 2,
      topSet: { weight: 100, reps: 5, rpe: 8 },
    });
  });

  it("does not call the first recorded session a personal record", () => {
    expect(buildWorkoutSummary(session, currentHistory, "kg").prNames).toEqual([]);
  });

  it("marks a lift when its best estimated max beats prior sessions", () => {
    const summary = buildWorkoutSummary(session, [trainingSet(), ...currentHistory], "kg");

    expect(summary.prNames).toEqual(["Back Squat"]);
    expect(summary.exercises[0].isPr).toBe(true);
  });

  it("uses reps to recognize bodyweight records", () => {
    const bodyweight: SessionWithSets = {
      ...session,
      sets: session.sets.map((set, index) => ({
        ...set,
        exerciseId: "pullup",
        exerciseName: "Pull Up",
        muscleGroup: "Back",
        movementPattern: "Vertical Pull",
        weight: 0,
        reps: 10 + index,
      })),
    };
    const history = [
      trainingSet({ exerciseId: "pullup", exerciseName: "Pull Up", weight: 0, reps: 9 }),
      ...bodyweight.sets.map((set) =>
        trainingSet({
          date: bodyweight.performed_at,
          sessionId: bodyweight.id,
          exerciseId: "pullup",
          exerciseName: "Pull Up",
          weight: 0,
          reps: set.reps,
        }),
      ),
    ];

    expect(buildWorkoutSummary(bodyweight, history, "kg").prNames).toEqual(["Pull Up"]);
  });

  it("only attaches a next target to the latest session for an exercise", () => {
    const current = buildWorkoutSummary(session, [trainingSet(), ...currentHistory], "kg");
    expect(current.exercises[0].next?.target).toEqual({ weight: 100, reps: 6, sets: 2 });

    const newer = trainingSet({ date: "2026-09-09T12:00:00.000Z", sessionId: "newer" });
    const old = buildWorkoutSummary(session, [trainingSet(), ...currentHistory, newer], "kg");
    expect(old.exercises[0].next).toBeNull();
  });
});

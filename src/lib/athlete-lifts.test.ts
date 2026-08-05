import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect } from "vitest";
import {
  COLD_START_LIFTS,
  coldStartQuestions,
  mergeSelfReported,
  parseLiftClaims,
  saveAthleteLifts,
  type AthleteLift,
} from "@/lib/athlete-lifts";
import { assessWeakPoints } from "@/lib/analytics/weak-points";
import type { PersonalRecord } from "@/lib/analytics/records";
import type { SetVolumeReport } from "@/lib/analytics/setVolume";
import type { Exercise } from "@/lib/types";

const ex = (id: string, name: string, muscle: string, hidden = false): Exercise => ({
  id,
  user_id: null,
  name,
  muscle_group: muscle,
  movement_pattern: "Squat",
  equipment: "barbell",
  is_major: false,
  hidden,
  created_at: "2026-07-01T00:00:00.000Z",
});

const library: Exercise[] = [
  ex("squat", "Squat", "Quads"),
  ex("bench", "Bench Press", "Chest"),
  ex("dead", "Deadlift", "Back"),
  ex("ohp", "Shoulder Press", "Shoulders"),
  ex("curl", "Barbell Curl", "Biceps"),
  ex("push", "Tricep Pushdown", "Triceps"),
];

const claim = (exercise_id: string, weight: number, reps: number): AthleteLift => ({
  exercise_id,
  weight,
  reps,
  source: "self_reported",
  recorded_on: "2026-07-30",
});

const logged = (exerciseId: string, name: string, muscle: string, e1rm: number): PersonalRecord => ({
  exerciseId,
  exerciseName: name,
  muscleGroup: muscle,
  isMajor: false,
  maxWeight: e1rm,
  bestE1RM: e1rm,
  bestE1RMWeight: e1rm,
  bestE1RMReps: 1,
  bestReps: 5,
  achievedAt: "2026-07-20T00:00:00.000Z",
});

describe("coldStartQuestions", () => {
  it("asks about lifts covering six different muscle groups", () => {
    const qs = coldStartQuestions(library, []);
    expect(qs).toHaveLength(6);
    expect(new Set(qs.map((q) => q.covers)).size).toBe(6);
  });

  it("drops a question whose exercise is not in the library", () => {
    const qs = coldStartQuestions([ex("squat", "Squat", "Quads")], []);
    expect(qs.map((q) => q.exercise.name)).toEqual(["Squat"]);
  });

  it("never asks about a retired exercise", () => {
    const qs = coldStartQuestions([ex("squat", "Squat", "Quads", true)], []);
    expect(qs).toHaveLength(0);
  });

  it("prefills an answer the athlete has already given", () => {
    const qs = coldStartQuestions(library, [claim("squat", 140, 3)]);
    const squat = qs.find((q) => q.exercise.id === "squat")!;
    expect(squat.answer).toMatchObject({ weight: 140, reps: 3 });
    expect(qs.find((q) => q.exercise.id === "bench")!.answer).toBeNull();
  });

  // Asking for weight and reps rather than a 1RM is deliberate: nobody knows
  // their true 1RM, and asking for one invites a made-up number.
  it("covers the muscles the weak-point engine can actually score", () => {
    expect(COLD_START_LIFTS.map((l) => l.covers)).toEqual([
      "Quads",
      "Chest",
      "Back",
      "Shoulders",
      "Biceps",
      "Triceps",
    ]);
  });
});

describe("mergeSelfReported", () => {
  it("turns a claim into a record with an estimated 1RM", () => {
    const merged = mergeSelfReported([], [claim("squat", 100, 5)], library);
    expect(merged).toHaveLength(1);
    // Brzycki: 100 * 36 / (37 - 5) = 112.5
    expect(merged[0].bestE1RM).toBeCloseTo(112.5, 1);
    expect(merged[0].source).toBe("self_reported");
    expect(merged[0].muscleGroup).toBe("Quads");
  });

  // The claim was a starting estimate, not a standing truth.
  it("lets logged history win over a claim for the same lift", () => {
    const merged = mergeSelfReported(
      [logged("squat", "Squat", "Quads", 90)],
      [claim("squat", 200, 1)],
      library,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("logged");
    expect(merged[0].bestE1RM).toBe(90);
  });

  it("keeps a claim for a lift with no logged history", () => {
    const merged = mergeSelfReported(
      [logged("squat", "Squat", "Quads", 140)],
      [claim("curl", 30, 8)],
      library,
    );
    expect(merged.map((m) => m.exerciseId).sort()).toEqual(["curl", "squat"]);
    expect(merged.find((m) => m.exerciseId === "curl")!.source).toBe("self_reported");
  });

  it("drops a claim whose exercise left the library rather than inventing one", () => {
    expect(mergeSelfReported([], [claim("gone", 100, 5)], library)).toHaveLength(0);
  });

  it("marks logged records as logged", () => {
    const merged = mergeSelfReported([logged("squat", "Squat", "Quads", 140)], [], library);
    expect(merged[0].source).toBe("logged");
  });
});

// The point of the whole step: a first-time athlete gets a real assessment.
describe("cold start feeds the weak-point engine", () => {
  const emptyVolume: SetVolumeReport = {
    muscles: [],
    rows: [],
    muscleGroups: [],
    windowWeeks: 4,
  };
  const opts = { bodyweight: 85, sex: "male" as const, units: "kg" as const };

  it("says there is not enough data when nothing has been asked or logged", () => {
    const report = assessWeakPoints(mergeSelfReported([], [], library), emptyVolume, opts);
    expect(report.insufficientData).toBe(true);
  });

  it("produces a real lag ranking from claims alone", () => {
    // Strong lower body, weak arms. The founder's own shape, but claimed rather
    // than logged, which is exactly the first-time-user case.
    const claims = [
      claim("squat", 140, 5),
      claim("bench", 100, 5),
      claim("dead", 180, 3),
      claim("ohp", 60, 5),
      claim("curl", 25, 8),
      claim("push", 25, 10),
    ];
    const report = assessWeakPoints(mergeSelfReported([], claims, library), emptyVolume, opts);

    expect(report.insufficientData).toBe(false);
    expect(report.medianScore).not.toBeNull();
    const lagging = report.lagging.map((m) => m.muscle);
    expect(lagging.length).toBeGreaterThan(0);
    // Arms should be behind a 180 kg deadlift and a 140 kg squat.
    expect(lagging.some((m) => m === "Biceps" || m === "Triceps")).toBe(true);
  });

  it("still works when the athlete skipped most of the questions", () => {
    const report = assessWeakPoints(
      mergeSelfReported([], [claim("squat", 140, 5), claim("curl", 20, 8)], library),
      emptyVolume,
      opts,
    );
    // Two scored muscles is the minimum for a median to mean anything.
    expect(report.insufficientData).toBe(false);
  });
});

function fakeSaveSupabase(writes: unknown[][]): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: () => ({
      upsert: async (rows: unknown[]) => {
        writes.push(rows);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

describe("saveAthleteLifts", () => {
  it("never writes a zero-weight claim", async () => {
    const writes: unknown[][] = [];
    await saveAthleteLifts(fakeSaveSupabase(writes), [
      { exerciseId: "bench", weight: 0, reps: 5 },
    ]);
    expect(writes).toHaveLength(0);
  });

  it("writes valid claims and drops invalid claims in the same request", async () => {
    const writes: unknown[][] = [];
    await saveAthleteLifts(fakeSaveSupabase(writes), [
      { exerciseId: "bench", weight: 100, reps: 5 },
      { exerciseId: "curl", weight: -1, reps: 8 },
      { exerciseId: "squat", weight: 140, reps: 0 },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      {
        user_id: "u1",
        exercise_id: "bench",
        weight: 100,
        reps: 5,
        source: "self_reported",
      },
    ]);
  });
});

describe("parseLiftClaims", () => {
  it("accepts an empty array as an intentional skip", () => {
    expect(parseLiftClaims([])).toEqual([]);
  });

  it("rejects zero weight instead of reporting a silent zero-row save", () => {
    expect(parseLiftClaims([{ exerciseId: "bench", weight: 0, reps: 5 }])).toBeNull();
  });

  it("accepts a valid numeric claim", () => {
    expect(parseLiftClaims([{ exerciseId: "bench", weight: 100, reps: 5 }])).toEqual([
      { exerciseId: "bench", weight: 100, reps: 5 },
    ]);
  });
});

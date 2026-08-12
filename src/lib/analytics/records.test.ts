// Tests for personal-record derivation. The subtle contract: the heaviest
// single (maxWeight) and the best estimated 1RM can come from different sets,
// and bestReps tracks the most reps in any set (used by bodyweight standards).

import { describe, it, expect } from "vitest";
import { buildRecords } from "@/lib/analytics/records";
import type { TrainingSet } from "@/lib/types";

function set(o: Partial<TrainingSet> & { weight: number; reps: number }): TrainingSet {
  return {
    date: o.date ?? "2026-06-01T12:00:00.000Z",
    sessionId: o.sessionId ?? "s1",
    exerciseId: o.exerciseId ?? "squat",
    exerciseName: o.exerciseName ?? "Squat",
    muscleGroup: o.muscleGroup ?? "Legs",
    isMajor: o.isMajor ?? true,
    reps: o.reps,
    weight: o.weight,
    rpe: o.rpe ?? null,
  };
}

describe("buildRecords", () => {
  it("separates the heaviest single from the best estimated 1RM", () => {
    const recs = buildRecords([
      set({ weight: 100, reps: 5, date: "2026-05-01T12:00:00.000Z" }), // Brzycki e1RM 112.5
      set({ weight: 110, reps: 1, date: "2026-05-08T12:00:00.000Z" }), // heaviest single, e1RM 110
      set({ weight: 105, reps: 3 }), // e1RM ~111.2
    ]);
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(r.maxWeight).toBe(110); // heaviest single
    expect(r.bestE1RM).toBe(112.5); // from the 100x5 set, not the 110x1
    expect(r.bestE1RMWeight).toBe(100);
    expect(r.bestE1RMReps).toBe(5);
    expect(r.bestReps).toBe(5); // most reps in any set
    expect(r.achievedAt).toBe("2026-05-01T12:00:00.000Z"); // date of the best-e1RM set
  });

  it("orders major lifts first, then by best e1RM", () => {
    const recs = buildRecords([
      set({ exerciseId: "curl", exerciseName: "Curl", isMajor: false, weight: 30, reps: 10 }),
      set({ exerciseId: "squat", exerciseName: "Squat", isMajor: true, weight: 140, reps: 3 }),
    ]);
    expect(recs.map((r) => r.exerciseName)).toEqual(["Squat", "Curl"]);
  });

  it("returns an empty list for no sets", () => {
    expect(buildRecords([])).toEqual([]);
  });
});

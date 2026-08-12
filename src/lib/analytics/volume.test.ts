// Tests for weekly tonnage bucketing per muscle group. Guards that every
// muscle cell is a number (0 when absent) so the coach prompt and the stacked
// chart never see `undefined`.

import { describe, it, expect } from "vitest";
import { buildVolumeReport } from "@/lib/analytics/volume";
import type { TrainingSet } from "@/lib/types";

const now = new Date("2026-06-08T12:00:00");

function set(weeksAgo: number, muscleGroup: string, weight: number, reps: number): TrainingSet {
  const d = new Date(now);
  d.setDate(d.getDate() - weeksAgo * 7);
  d.setHours(12, 0, 0, 0);
  return {
    date: d.toISOString(),
    sessionId: `s${weeksAgo}`,
    exerciseId: muscleGroup,
    exerciseName: muscleGroup,
    muscleGroup,
    isMajor: false,
    reps,
    weight,
    rpe: null,
  };
}

describe("buildVolumeReport", () => {
  it("buckets tonnage per muscle per week and fills absent cells with 0", () => {
    const report = buildVolumeReport(
      [set(1, "Chest", 100, 5), set(0, "Chest", 100, 5), set(0, "Legs", 100, 5)],
      2,
      now,
    );
    expect(report.muscleGroups).toEqual(["Chest", "Legs"]); // sorted
    expect(report.rows).toHaveLength(2);
    // older week (index 0): only Chest was trained; Legs must be 0, not undefined.
    expect(report.rows[0]["Chest"]).toBe(500);
    expect(report.rows[0]["Legs"]).toBe(0);
    expect(report.rows[0].total).toBe(500);
    // current week (index 1): both muscles.
    expect(report.rows[1].total).toBe(1000);
  });

  it("returns no muscle groups but still one row per week when empty", () => {
    const report = buildVolumeReport([], 4, now);
    expect(report.muscleGroups).toEqual([]);
    expect(report.rows).toHaveLength(4);
    expect(report.rows[0].total).toBe(0);
  });
});

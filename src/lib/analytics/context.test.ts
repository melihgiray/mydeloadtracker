// Smoke tests for the coach context builder. It orchestrates the (individually
// tested) analytics into the system-prompt string, so the value here is that it
// does not crash on real data and that the key sections the coach relies on are
// present — plus the cold-start branch.

import { describe, it, expect } from "vitest";
import { buildCoachContext } from "@/lib/analytics/context";
import type { TrainingSet } from "@/lib/types";

const now = new Date("2026-06-08T12:00:00Z");

function set(daysAgo: number, weight: number, reps: number): TrainingSet {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return {
    date: d.toISOString(),
    sessionId: `s${daysAgo}`,
    exerciseId: "squat",
    exerciseName: "Squat",
    muscleGroup: "Legs",
    isMajor: true,
    reps,
    weight,
    rpe: 8,
  };
}

describe("buildCoachContext", () => {
  it("returns a cold-start message with hasData false when no sets exist", () => {
    const ctx = buildCoachContext([], { full_name: "Alex", units: "kg", bodyweight: null, sex: null }, [], now);
    expect(ctx.hasData).toBe(false);
    expect(ctx.summary.toLowerCase()).toContain("not logged");
  });

  it("assembles the key sections from real numbers", () => {
    const sets = [set(0, 100, 5), set(7, 95, 5), set(14, 90, 5)];
    const ctx = buildCoachContext(
      sets,
      { full_name: "Alex", units: "kg", bodyweight: 80, sex: "male" },
      [],
      now,
    );
    expect(ctx.hasData).toBe(true);
    for (const section of [
      "ATHLETE",
      "DELOAD ANALYSIS",
      "TRAINING READINESS",
      "PER-LIFT TREND",
      "PERSONAL RECORDS",
    ]) {
      expect(ctx.summary).toContain(section);
    }
    expect(ctx.summary).toContain("kg");
  });
});

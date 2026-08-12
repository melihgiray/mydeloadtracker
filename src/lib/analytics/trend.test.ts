// Tests for the historical readiness trend. The correctness that matters: each
// weekly point is scored using ONLY the sets that existed by that date, so the
// trend never leaks future data, and weeks with no data yet are skipped.

import { describe, it, expect } from "vitest";
import { buildReadinessTrend } from "@/lib/analytics/trend";
import type { TrainingSet } from "@/lib/types";

const now = new Date("2026-06-08T12:00:00Z");
const opts = { bodyweight: null, sex: null, units: "kg" as const };

function setDaysAgo(days: number): TrainingSet {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return {
    date: d.toISOString(),
    sessionId: `s${days}`,
    exerciseId: "squat",
    exerciseName: "Squat",
    muscleGroup: "Legs",
    isMajor: true,
    reps: 5,
    weight: 100,
    rpe: 8,
  };
}

describe("buildReadinessTrend", () => {
  it("scores only weeks with data and never leaks future sets", () => {
    // A single recent set: earlier as-of points have no data yet and are skipped.
    const trend = buildReadinessTrend([setDaysAgo(2)], [], now, opts, 8);
    expect(trend).toHaveLength(1);
    expect(trend[0]).toBeGreaterThanOrEqual(0);
    expect(trend[0]).toBeLessThanOrEqual(100);
  });

  it("emits one score per week that has accumulated data", () => {
    const trend = buildReadinessTrend(
      [setDaysAgo(14), setDaysAgo(7), setDaysAgo(0)],
      [],
      now,
      opts,
      8,
    );
    expect(trend).toHaveLength(3);
    for (const s of trend) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("falls back to a single current score when nothing predates the points", () => {
    // One set far in the future of every as-of point => loop skips all, fallback fires.
    const future = { ...setDaysAgo(-30) };
    const trend = buildReadinessTrend([future], [], now, opts, 8);
    expect(trend).toHaveLength(1);
  });
});

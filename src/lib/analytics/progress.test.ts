// Characterization tests for the progressive-overload classifier — the e1RM
// trend + progressing/plateauing/regressing status that feeds the dashboard,
// the progress page, and the coach. Previously untested.

import { describe, it, expect } from "vitest";
import {
  classifyProgress,
  weeklyPointsForExercise,
  buildProgressReport,
  type WeeklyExercisePoint,
} from "@/lib/analytics/progress";
import type { TrainingSet } from "@/lib/types";

const now = new Date("2026-06-08T12:00:00");

function point(bestE1RM: number): WeeklyExercisePoint {
  return {
    week: "2026-06-01",
    bestE1RM,
    volume: bestE1RM,
    topSetWeight: bestE1RM,
    topSetReps: 1,
    avgRpe: null,
    sets: bestE1RM > 0 ? 1 : 0,
  };
}

function set(
  weeksAgo: number,
  opts: {
    weight: number;
    reps?: number;
    exerciseId?: string;
    name?: string;
    isMajor?: boolean;
    muscleGroup?: string;
  },
): TrainingSet {
  const d = new Date(now);
  d.setDate(d.getDate() - weeksAgo * 7);
  d.setHours(12, 0, 0, 0);
  return {
    date: d.toISOString(),
    sessionId: `s-${weeksAgo}`,
    exerciseId: opts.exerciseId ?? "squat",
    exerciseName: opts.name ?? "Squat",
    muscleGroup: opts.muscleGroup ?? "Legs",
    isMajor: opts.isMajor ?? true,
    reps: opts.reps ?? 5,
    weight: opts.weight,
    rpe: 8,
  };
}

describe("classifyProgress", () => {
  it("is insufficient with fewer than two active weeks", () => {
    expect(classifyProgress([point(100)]).status).toBe("insufficient");
    expect(classifyProgress([point(0), point(0)]).status).toBe("insufficient");
  });

  it("is progressing when e1RM rises more than 2%", () => {
    const r = classifyProgress([point(100), point(105)]);
    expect(r.status).toBe("progressing");
    expect(r.changePct).toBe(5);
  });

  it("is regressing when e1RM falls more than 2%", () => {
    expect(classifyProgress([point(100), point(95)]).status).toBe("regressing");
  });

  it("is plateauing within +/-2% either way", () => {
    expect(classifyProgress([point(100), point(101)]).status).toBe("plateauing");
    expect(classifyProgress([point(100), point(99)]).status).toBe("plateauing");
  });

  it("compares first vs last ACTIVE week, ignoring empty weeks in between", () => {
    const r = classifyProgress([point(100), point(0), point(0), point(106)]);
    expect(r.status).toBe("progressing");
    expect(r.changePct).toBe(6);
  });
});

describe("weeklyPointsForExercise", () => {
  it("takes the best Epley e1RM as the week's top set and sums volume", () => {
    const pts = weeklyPointsForExercise(
      [set(0, { weight: 100, reps: 5 }), set(0, { weight: 110, reps: 3 })],
      4,
      now,
    );
    const current = pts[pts.length - 1];
    expect(current.sets).toBe(2);
    // Brzycki: 110x3 = 116.5 beats 100x5 = 112.5, so 110x3 is the top set.
    expect(current.topSetWeight).toBe(110);
    expect(current.bestE1RM).toBe(116.5);
    expect(current.volume).toBe(100 * 5 + 110 * 3);
  });

  it("leaves weeks with no sets empty", () => {
    const pts = weeklyPointsForExercise([set(0, { weight: 100 })], 4, now);
    expect(pts).toHaveLength(4);
    expect(pts[0].sets).toBe(0);
    expect(pts[0].bestE1RM).toBe(0);
    expect(pts[3].sets).toBe(1);
  });
});

describe("buildProgressReport", () => {
  it("orders major lifts first and reads currentE1RM from the last active week", () => {
    const sets = [
      set(0, { weight: 30, exerciseId: "curl", name: "Curl", isMajor: false, muscleGroup: "Biceps" }),
      set(1, { weight: 100 }),
      set(0, { weight: 105 }),
    ];
    const report = buildProgressReport(sets, 4, now);
    expect(report[0].isMajor).toBe(true);
    expect(report[0].exerciseName).toBe("Squat");
    // last active week is now (105x5) -> Brzycki e1RM 118.1
    expect(report[0].currentE1RM).toBe(118.1);
  });
});

import { describe, expect, it } from "vitest";
import {
  BIG_CHANGE_SHARE,
  buildPlanReview,
  isBigChange,
  isReviewDue,
  summariseReview,
} from "@/lib/plan-review";
import type { PlanOp } from "@/lib/plan-patch";
import type { PlanWithDays, TrainingSet } from "@/lib/types";

function planExercise(exerciseId: string, name: string, position: number, sets = 3) {
  return {
    id: `pe-${exerciseId}`,
    plan_day_id: "d1",
    exercise_id: exerciseId,
    position,
    sets,
    rep_low: 6,
    rep_high: 10,
    rpe_target: 9,
    rest_seconds: null,
    role: null,
    note: null,
    name,
    muscle_group: "Chest",
    equipment: "barbell",
  };
}

function plan(overrides: Partial<PlanWithDays> = {}): PlanWithDays {
  return {
    id: "p1",
    user_id: "u1",
    name: "Test Plan",
    goal: "hypertrophy",
    split: "full_body",
    days_per_week: 1,
    session_minutes: 60,
    equipment: ["barbell"],
    avoid: [],
    mesocycle_weeks: 5,
    deload_week: 5,
    notes: null,
    last_reviewed_on: null,
    training_style: null,
    active: true,
    started_on: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    days: [
      {
        id: "d1",
        plan_id: "p1",
        day_index: 0,
        name: "Full Body A",
        focus: null,
        exercises: [planExercise("bench", "Bench Press", 1), planExercise("row", "Barbell Row", 2)],
      },
    ],
    ...overrides,
  };
}

function set(
  exerciseId: string,
  date: string,
  weight: number,
  rpe: number | null = null,
): TrainingSet {
  return {
    date: `${date}T12:00:00.000Z`,
    sessionId: `s-${date}`,
    exerciseId,
    exerciseName: exerciseId,
    muscleGroup: "Chest",
    isMajor: true,
    reps: 8,
    weight,
    rpe,
  };
}

describe("isReviewDue", () => {
  it("waits a full week from the plan start when nothing was reviewed yet", () => {
    expect(isReviewDue(plan(), "2026-07-08")).toBe(true);
    expect(isReviewDue(plan(), "2026-07-07")).toBe(false);
  });

  it("counts from the last review once there has been one", () => {
    const reviewed = plan({ last_reviewed_on: "2026-07-20" });
    expect(isReviewDue(reviewed, "2026-07-26")).toBe(false);
    expect(isReviewDue(reviewed, "2026-07-27")).toBe(true);
  });
});

describe("buildPlanReview", () => {
  const today = "2026-07-29";

  it("calls a lift progressed when the top weight rose against last week", () => {
    const review = buildPlanReview(
      plan(),
      [set("bench", "2026-07-16", 60), set("bench", "2026-07-24", 65)],
      today,
    );
    const bench = review.lifts.find((l) => l.exerciseId === "bench")!;
    expect(bench.trend).toBe("progressed");
    expect(bench.topWeight).toBe(65);
    expect(bench.priorTopWeight).toBe(60);
  });

  it("makes no trend claim in the first week, because there is nothing to compare", () => {
    // Golden rule 4 as a test: a single data point is not a direction.
    const review = buildPlanReview(plan(), [set("bench", "2026-07-24", 60, 9.5)], today);
    const bench = review.lifts.find((l) => l.exerciseId === "bench")!;
    expect(bench.trend).toBe("held");
    expect(bench.priorTopWeight).toBeNull();
  });

  it("only calls a repeated weight stalled when the effort was already high", () => {
    const hard = buildPlanReview(
      plan(),
      [set("bench", "2026-07-16", 60, 9), set("bench", "2026-07-24", 60, 9.5)],
      today,
    );
    expect(hard.lifts.find((l) => l.exerciseId === "bench")!.trend).toBe("stalled");

    const easy = buildPlanReview(
      plan(),
      [set("bench", "2026-07-16", 60, 7), set("bench", "2026-07-24", 60, 7)],
      today,
    );
    expect(easy.lifts.find((l) => l.exerciseId === "bench")!.trend).toBe("held");
  });

  it("reports a lift that was skipped rather than guessing at it", () => {
    const review = buildPlanReview(plan(), [set("bench", "2026-07-24", 60)], today);
    expect(review.untrained.map((l) => l.exerciseId)).toEqual(["row"]);
    const row = review.lifts.find((l) => l.exerciseId === "row")!;
    expect(row.setsLogged).toBe(0);
    expect(row.topWeight).toBeNull();
    expect(row.meanRpe).toBeNull();
  });

  it("ignores work outside the two week comparison window", () => {
    const review = buildPlanReview(
      plan(),
      [set("bench", "2026-05-01", 200), set("bench", "2026-07-24", 60)],
      today,
    );
    const bench = review.lifts.find((l) => l.exerciseId === "bench")!;
    expect(bench.topWeight).toBe(60);
    expect(bench.priorTopWeight).toBeNull();
  });

  it("counts distinct training days, not sets", () => {
    const review = buildPlanReview(
      plan(),
      [
        set("bench", "2026-07-24", 60),
        set("bench", "2026-07-24", 60),
        set("row", "2026-07-26", 70),
      ],
      today,
    );
    expect(review.sessionsLogged).toBe(2);
    expect(review.sessionsPlanned).toBe(1);
  });
});

describe("isBigChange", () => {
  const ops = (n: number): PlanOp[] =>
    Array.from({ length: n }, (_, i) => ({
      op: "remove_exercise" as const,
      dayIndex: 0,
      position: i + 1,
      reason: "test",
    }));

  it("lets a small patch through", () => {
    // Two planned exercises, so touching one is half. Use a bigger plan to test
    // the threshold honestly rather than against a two item edge case.
    const big = plan({
      days: [
        {
          id: "d1",
          plan_id: "p1",
          day_index: 0,
          name: "Full Body A",
          focus: null,
          exercises: Array.from({ length: 6 }, (_, i) =>
            planExercise(`e${i}`, `Lift ${i}`, i + 1),
          ),
        },
      ],
    });
    expect(isBigChange(big, ops(2))).toBe(false);
    expect(isBigChange(big, ops(3))).toBe(true);
    expect(BIG_CHANGE_SHARE).toBeCloseTo(1 / 3);
  });

  it("says no when there is nothing to change", () => {
    expect(isBigChange(plan({ days: [] }), ops(1))).toBe(false);
  });
});

describe("summariseReview", () => {
  it("states adherence and never fills a missing number", () => {
    const review = buildPlanReview(plan(), [set("bench", "2026-07-24", 60)], "2026-07-29");
    const text = summariseReview(review);
    expect(text).toContain("Trained 1 of 1 planned days");
    expect(text).toContain("Bench Press: 1 of 3 sets");
    expect(text).toContain("no prior week");
    expect(text).toContain("Barbell Row: not trained this week");
    expect(text).not.toMatch(/RPE (null|undefined|NaN)/);
  });
});

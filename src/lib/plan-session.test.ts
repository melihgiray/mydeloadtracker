import { describe, it, expect } from "vitest";
import {
  buildPlannedSession,
  completedSetCount,
  repsWithinRange,
  targetLabel,
} from "@/lib/plan-session";
import type { NextSession } from "@/lib/analytics/progression";
import type { PlanDayWithExercises } from "@/lib/types";

const planned = (
  over: Partial<PlanDayWithExercises["exercises"][number]> = {},
): PlanDayWithExercises["exercises"][number] => ({
  id: "pe1",
  plan_day_id: "d1",
  exercise_id: "ex1",
  position: 0,
  sets: 4,
  rep_low: 5,
  rep_high: 8,
  rpe_target: 8,
  rest_seconds: 180,
  role: "primary",
  note: null,
  name: "Bench Press",
  muscle_group: "Chest",
  equipment: "barbell",
  ...over,
});

const day = (exercises = [planned()]): PlanDayWithExercises => ({
  id: "d1",
  plan_id: "p1",
  day_index: 0,
  name: "Upper A",
  focus: "chest, back",
  exercises,
});

const next = (over: Partial<NextSession> = {}): NextSession => ({
  exerciseId: "ex1",
  exerciseName: "Bench Press",
  isMajor: true,
  last: { weight: 95, reps: 6, rpe: 8, sets: 4 },
  target: { weight: 100, reps: 6, sets: 4 },
  action: "progress",
  note: "Add load, last set felt easy.",
  ...over,
});

describe("repsWithinRange", () => {
  it("keeps a suggestion already inside the range", () => {
    expect(repsWithinRange(6, 5, 8)).toBe(6);
  });

  // The plan's rep ceiling is a deliberate choice about stimulus, so it wins
  // over double progression wanting more reps at the same load.
  it("clamps to the plan's ceiling", () => {
    expect(repsWithinRange(12, 5, 8)).toBe(8);
  });

  it("clamps up to the plan's floor", () => {
    expect(repsWithinRange(3, 5, 8)).toBe(5);
  });

  it("falls back to the floor on a nonsense suggestion", () => {
    expect(repsWithinRange(0, 5, 8)).toBe(5);
    expect(repsWithinRange(NaN, 5, 8)).toBe(5);
    expect(repsWithinRange(-4, 5, 8)).toBe(5);
  });

  it("handles a single-rep prescription", () => {
    expect(repsWithinRange(9, 6, 6)).toBe(6);
  });
});

describe("buildPlannedSession", () => {
  it("creates one row per prescribed set", () => {
    const [ex] = buildPlannedSession(day([planned({ sets: 4 })]), [next()]);
    expect(ex.sets).toHaveLength(4);
  });

  it("prefills weight from progression, not from the plan", () => {
    const [ex] = buildPlannedSession(day(), [next({ target: { weight: 102.5, reps: 6, sets: 4 } })]);
    expect(ex.sets.every((s) => s.weight === "102.5")).toBe(true);
    expect(ex.weightBasis).toBe("progression");
  });

  it("prefills RPE from the plan, so the athlete does not type one", () => {
    const [ex] = buildPlannedSession(day([planned({ rpe_target: 8.5 })]), [next()]);
    expect(ex.sets.every((s) => s.rpe === "8.5")).toBe(true);
  });

  it("leaves RPE blank when the plan does not prescribe one", () => {
    const [ex] = buildPlannedSession(day([planned({ rpe_target: null })]), [next()]);
    expect(ex.sets.every((s) => s.rpe === "")).toBe(true);
  });

  // Golden rule 4. A lift never trained has no weight to suggest, and a blank
  // field asks the question honestly where a 0 would answer it wrongly.
  it("leaves weight BLANK for a lift with no history, never a guess", () => {
    const [ex] = buildPlannedSession(day(), []);
    expect(ex.sets.every((s) => s.weight === "")).toBe(true);
    expect(ex.weightBasis).toBe("no_history");
    expect(ex.note).toBeNull();
  });

  it("treats a zero-weight target as no history rather than a real answer", () => {
    const [ex] = buildPlannedSession(day(), [next({ target: { weight: 0, reps: 6, sets: 4 } })]);
    expect(ex.weightBasis).toBe("no_history");
    expect(ex.sets[0].weight).toBe("");
  });

  it("starts at the rep floor when there is no history", () => {
    const [ex] = buildPlannedSession(day([planned({ rep_low: 8, rep_high: 12 })]), []);
    expect(ex.sets.every((s) => s.reps === "8")).toBe(true);
  });

  it("clamps progression's reps into the plan range", () => {
    const [ex] = buildPlannedSession(
      day([planned({ rep_low: 5, rep_high: 8 })]),
      [next({ target: { weight: 100, reps: 15, sets: 4 } })],
    );
    expect(ex.sets.every((s) => s.reps === "8")).toBe(true);
  });

  it("applies both sides of a deload, lighter history weight and fewer plan sets", () => {
    const [ex] = buildPlannedSession(day(), [
      next({ action: "deload", target: { weight: 70, reps: 5, sets: 3 }, note: "Deload week." }),
    ], "kg", { deload: true });
    expect(ex.sets[0].weight).toBe("70");
    expect(ex.sets).toHaveLength(2);
    expect(ex.target.sets).toBe(2);
    expect(ex.target.rpe).toBe(6);
    expect(ex.sets.every((set) => set.rpe === "6")).toBe(true);
    expect(ex.note).toBe("Deload week.");
  });

  it("rounds an odd deload set count up and never below one", () => {
    const [three, one] = buildPlannedSession(
      day([
        planned({ exercise_id: "a", sets: 3 }),
        planned({ exercise_id: "b", sets: 1 }),
      ]),
      [],
      "kg",
      { deload: true },
    );
    expect(three.sets).toHaveLength(2);
    expect(one.sets).toHaveLength(1);
  });

  it("reduces a deload prescription even when the lift has no history", () => {
    const [ex] = buildPlannedSession(
      day([planned({ sets: 5, rpe_target: null })]),
      [],
      "kg",
      { deload: true },
    );
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets.every((set) => set.weight === "")).toBe(true);
    expect(ex.sets.every((set) => set.rpe === "6")).toBe(true);
    expect(ex.note).toContain("Deload week");
  });

  it("uses zero as a real history weight for bodyweight work", () => {
    const [ex] = buildPlannedSession(
      day([planned({ equipment: "bodyweight", name: "Pull Up" })]),
      [next({ target: { weight: 0, reps: 9, sets: 4 } })],
    );
    expect(ex.weightBasis).toBe("progression");
    expect(ex.sets[0].weight).toBe("0");
    expect(ex.sets[0].reps).toBe("8");
  });

  it("keeps the plan's order and passes through the target", () => {
    const result = buildPlannedSession(
      day([
        planned({ exercise_id: "a", name: "Bench Press", position: 0 }),
        planned({ exercise_id: "b", name: "Row", position: 1, sets: 3, rep_low: 8, rep_high: 12 }),
      ]),
      [next()],
    );
    expect(result.map((r) => r.name)).toEqual(["Bench Press", "Row"]);
    expect(result[1].target).toMatchObject({ sets: 3, repLow: 8, repHigh: 12 });
  });

  it("never emits zero set rows even if the plan says zero", () => {
    const [ex] = buildPlannedSession(day([planned({ sets: 0 })]), [next()]);
    expect(ex.sets.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores progression entries for lifts not in today's day", () => {
    const result = buildPlannedSession(day(), [next({ exerciseId: "other" })]);
    expect(result).toHaveLength(1);
    expect(result[0].weightBasis).toBe("no_history");
  });
});

describe("targetLabel", () => {
  it("reads as a prescription", () => {
    expect(targetLabel({ sets: 4, repLow: 5, repHigh: 8, rpe: 8, restSeconds: 180, role: "primary" }))
      .toBe("4 x 5-8 @ RPE 8");
  });

  it("collapses a single rep target", () => {
    expect(targetLabel({ sets: 3, repLow: 6, repHigh: 6, rpe: null, restSeconds: null, role: null }))
      .toBe("3 x 6");
  });

  it("omits RPE when there is none, rather than printing null", () => {
    const label = targetLabel({ sets: 3, repLow: 8, repHigh: 12, rpe: null, restSeconds: null, role: null });
    expect(label).toBe("3 x 8-12");
    expect(label).not.toMatch(/null|RPE/);
  });

  it("uses no dash as punctuation, per house style", () => {
    const label = targetLabel({ sets: 4, repLow: 5, repHigh: 8, rpe: 8, restSeconds: 180, role: null });
    expect(label).not.toMatch(/[—–]/);
  });
});

describe("completedSetCount", () => {
  it("counts only rows with both reps and weight", () => {
    expect(
      completedSetCount([
        { reps: "8", weight: "100", rpe: "8" },
        { reps: "8", weight: "", rpe: "8" },
        { reps: "", weight: "100", rpe: "" },
      ]),
    ).toBe(1);
  });

  it("is zero for a freshly prefilled lift with no history", () => {
    expect(completedSetCount([{ reps: "5", weight: "", rpe: "8" }])).toBe(0);
  });
});

describe("plan versus history conflicts", () => {
  it("is silent when progression and the plan agree", () => {
    const [ex] = buildPlannedSession(day(), [next({ target: { weight: 100, reps: 6, sets: 4 } })]);
    expect(ex.repsAdjusted).toBe("none");
    expect(ex.conflict).toBeNull();
  });

  // The case that matters. Progression held the lift because it is near
  // maximal, and the plan's floor asks for MORE reps at that weight. Grinding
  // into that silently is exactly what this app exists to prevent.
  it("warns when the plan's floor asks for more reps than the athlete managed", () => {
    const [ex] = buildPlannedSession(
      day([planned({ rep_low: 6, rep_high: 10 })]),
      [next({
        last: { weight: 50, reps: 5, rpe: 9, sets: 3 },
        target: { weight: 50, reps: 5, sets: 3 },
        action: "hold",
      })],
      "kg",
    );
    expect(ex.repsAdjusted).toBe("raised_to_floor");
    expect(ex.conflict).toContain("5 at 50 kg");
    expect(ex.conflict).toContain("RPE 9");
    expect(ex.conflict).toMatch(/dropping the load/);
    // The prescription is still followed. The conflict informs, it does not override.
    expect(ex.sets[0].reps).toBe("6");
  });

  it("names the athlete's own unit in the warning", () => {
    const [ex] = buildPlannedSession(
      day([planned({ rep_low: 6, rep_high: 10 })]),
      [next({ last: { weight: 110, reps: 5, rpe: 9, sets: 3 }, target: { weight: 110, reps: 5, sets: 3 } })],
      "lb",
    );
    expect(ex.conflict).toContain("110 lb");
  });

  it("mentions adding load when the athlete has outgrown the rep ceiling", () => {
    const [ex] = buildPlannedSession(
      day([planned({ rep_low: 5, rep_high: 8 })]),
      [next({ target: { weight: 100, reps: 14, sets: 4 } })],
    );
    expect(ex.repsAdjusted).toBe("lowered_to_ceiling");
    expect(ex.conflict).toMatch(/add load/i);
    expect(ex.sets[0].reps).toBe("8");
  });

  it("says nothing about a conflict for a lift with no history", () => {
    const [ex] = buildPlannedSession(day(), []);
    expect(ex.repsAdjusted).toBe("none");
    expect(ex.conflict).toBeNull();
  });

  it("keeps conflict copy free of dashes and exclamation points", () => {
    const cases = buildPlannedSession(
      day([planned({ rep_low: 6, rep_high: 10 }), planned({ exercise_id: "b", rep_low: 5, rep_high: 8 })]),
      [
        next({ last: { weight: 50, reps: 5, rpe: 9, sets: 3 }, target: { weight: 50, reps: 5, sets: 3 } }),
        next({ exerciseId: "b", target: { weight: 60, reps: 20, sets: 3 } }),
      ],
    );
    for (const c of cases) {
      if (!c.conflict) continue;
      expect(c.conflict).not.toMatch(/[—–]/);
      expect(c.conflict).not.toContain("!");
    }
  });
});

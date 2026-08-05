import { describe, it, expect } from "vitest";
import {
  applyPlanPatch,
  patchFootprint,
  summarisePatch,
  type PlanOp,
} from "@/lib/plan-patch";
import type { Exercise, PlanWithDays } from "@/lib/types";

const exercise = (id: string, name: string, muscle = "Chest", hidden = false): Exercise => ({
  id,
  user_id: null,
  name,
  muscle_group: muscle,
  movement_pattern: "Horizontal Push",
  equipment: "barbell",
  is_major: false,
  hidden,
  created_at: "2026-07-01T00:00:00.000Z",
});

const library: Exercise[] = [
  exercise("bench", "Bench Press"),
  exercise("incline", "Incline Dumbbell Bench Press"),
  exercise("curl", "Barbell Curl", "Biceps"),
  exercise("row", "Bent Over Row", "Back"),
  exercise("retired", "Old Machine Press", "Chest", true),
];

const planExercise = (exerciseId: string, position: number, name: string) => ({
  id: `pe-${exerciseId}`,
  plan_day_id: "d1",
  exercise_id: exerciseId,
  position,
  sets: 3,
  rep_low: 8,
  rep_high: 12,
  rpe_target: 8,
  rest_seconds: 120,
  role: null,
  note: null,
  name,
  muscle_group: "Chest",
  equipment: "barbell",
});

const plan = (): PlanWithDays => ({
  id: "p1",
  user_id: "u1",
  name: "Test Plan",
  goal: "hypertrophy",
  split: "upper_lower",
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
      name: "Upper A",
      focus: "chest, arms",
      exercises: [
        planExercise("bench", 0, "Bench Press"),
        planExercise("curl", 1, "Barbell Curl"),
        planExercise("row", 2, "Bent Over Row"),
      ],
    },
  ],
});

const apply = (ops: PlanOp[]) => applyPlanPatch(plan(), ops, library);
const because = "athlete asked";

describe("the patch never mutates the plan it was given", () => {
  it("leaves the original untouched", () => {
    const original = plan();
    const before = JSON.stringify(original);
    applyPlanPatch(original, [{ op: "remove_exercise", dayIndex: 0, position: 0, reason: because }], library);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("remove_exercise", () => {
  it("removes it and closes the gap in positions", () => {
    const r = apply([{ op: "remove_exercise", dayIndex: 0, position: 1, reason: because }]);
    const day = r.plan.days[0];
    expect(day.exercises.map((e) => e.name)).toEqual(["Bench Press", "Bent Over Row"]);
    // Positions must stay contiguous from zero: migration 0016 has a unique
    // index on (plan_day_id, position).
    expect(day.exercises.map((e) => e.position)).toEqual([0, 1]);
  });

  it("refuses to empty a day, and says to remove the day instead", () => {
    let p = plan();
    p.days[0].exercises = [p.days[0].exercises[0]];
    const r = applyPlanPatch(p, [{ op: "remove_exercise", dayIndex: 0, position: 0, reason: because }], library);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected[0].error).toMatch(/Remove the day instead/);
  });
});

describe("replace_exercise", () => {
  it("swaps the movement and keeps the prescription", () => {
    const r = apply([
      { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "incline", reason: because },
    ]);
    const swapped = r.plan.days[0].exercises[0];
    expect(swapped.name).toBe("Incline Dumbbell Bench Press");
    expect(swapped.exercise_id).toBe("incline");
    // Someone swapping a lift is changing what they do, not how much of it.
    expect(swapped.sets).toBe(3);
    expect(swapped.rep_low).toBe(8);
    expect(swapped.rpe_target).toBe(8);
    expect(swapped.position).toBe(0);
  });

  it("refuses a retired exercise", () => {
    const r = apply([
      { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "retired", reason: because },
    ]);
    expect(r.rejected[0].error).toMatch(/retired/);
  });

  it("refuses an exercise that is not in the library", () => {
    const r = apply([
      { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "nope", reason: because },
    ]);
    expect(r.rejected[0].error).toMatch(/not in the library/);
  });

  it("refuses a duplicate already in the same day", () => {
    const r = apply([
      { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "curl", reason: because },
    ]);
    expect(r.rejected[0].error).toMatch(/already in Upper A/);
  });
});

describe("insert_exercise", () => {
  it("inserts at the position and renumbers everything after it", () => {
    const r = apply([
      {
        op: "insert_exercise",
        dayIndex: 0,
        position: 1,
        exerciseId: "incline",
        sets: 4,
        repLow: 6,
        repHigh: 10,
        reason: because,
      },
    ]);
    const day = r.plan.days[0];
    expect(day.exercises.map((e) => e.name)).toEqual([
      "Bench Press",
      "Incline Dumbbell Bench Press",
      "Barbell Curl",
      "Bent Over Row",
    ]);
    expect(day.exercises.map((e) => e.position)).toEqual([0, 1, 2, 3]);
  });

  it("marks a new row so the persistence layer knows to create it", () => {
    const r = apply([
      { op: "insert_exercise", dayIndex: 0, position: 0, exerciseId: "incline", sets: 3, repLow: 8, repHigh: 12, reason: because },
    ]);
    expect(r.plan.days[0].exercises[0].id).toMatch(/^new:/);
  });

  it("rejects a backwards rep range", () => {
    const r = apply([
      { op: "insert_exercise", dayIndex: 0, position: 0, exerciseId: "incline", sets: 3, repLow: 12, repHigh: 6, reason: because },
    ]);
    expect(r.rejected[0].error).toMatch(/backwards/);
  });

  it("rejects set counts the database would reject", () => {
    const r = apply([
      { op: "insert_exercise", dayIndex: 0, position: 0, exerciseId: "incline", sets: 99, repLow: 8, repHigh: 12, reason: because },
    ]);
    expect(r.rejected[0].error).toMatch(/Sets must be between/);
  });

  it("clamps an out-of-range position rather than rejecting, since the intent is clear", () => {
    const r = apply([
      { op: "insert_exercise", dayIndex: 0, position: 99, exerciseId: "incline", sets: 3, repLow: 8, repHigh: 12, reason: because },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.plan.days[0].exercises[3].name).toBe("Incline Dumbbell Bench Press");
  });
});

describe("set_prescription", () => {
  it("changes only the fields it names", () => {
    const r = apply([{ op: "set_prescription", dayIndex: 0, position: 0, sets: 5, reason: because }]);
    const e = r.plan.days[0].exercises[0];
    expect(e.sets).toBe(5);
    expect(e.rep_low).toBe(8);
    expect(e.rep_high).toBe(12);
    expect(e.rpe_target).toBe(8);
  });

  it("can clear an RPE target explicitly", () => {
    const r = apply([
      { op: "set_prescription", dayIndex: 0, position: 0, rpeTarget: null, reason: because },
    ]);
    expect(r.plan.days[0].exercises[0].rpe_target).toBeNull();
  });

  it("validates a partial change against the existing values", () => {
    // Only repLow is given, and it would cross the existing repHigh of 12.
    const r = apply([{ op: "set_prescription", dayIndex: 0, position: 0, repLow: 20, reason: because }]);
    expect(r.rejected[0].error).toMatch(/backwards/);
  });

  it("rejects an out-of-range RPE", () => {
    const r = apply([{ op: "set_prescription", dayIndex: 0, position: 0, rpeTarget: 99, reason: because }]);
    expect(r.rejected[0].error).toMatch(/RPE must be between/);
  });
});

describe("reorder", () => {
  it("moves an exercise later and renumbers", () => {
    const r = apply([{ op: "reorder", dayIndex: 0, fromPosition: 0, toPosition: 2, reason: because }]);
    expect(r.plan.days[0].exercises.map((e) => e.name)).toEqual([
      "Barbell Curl",
      "Bent Over Row",
      "Bench Press",
    ]);
    expect(r.plan.days[0].exercises.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it("moves an exercise earlier", () => {
    const r = apply([{ op: "reorder", dayIndex: 0, fromPosition: 2, toPosition: 0, reason: because }]);
    expect(r.plan.days[0].exercises[0].name).toBe("Bent Over Row");
  });

  it("rejects a move to where it already is", () => {
    const r = apply([{ op: "reorder", dayIndex: 0, fromPosition: 1, toPosition: 1, reason: because }]);
    expect(r.rejected[0].error).toMatch(/already there/);
  });
});

describe("rename_day", () => {
  it("renames and can clear the focus", () => {
    const r = apply([{ op: "rename_day", dayIndex: 0, name: "Push", focus: null, reason: because }]);
    expect(r.plan.days[0].name).toBe("Push");
    expect(r.plan.days[0].focus).toBeNull();
  });

  it("refuses a blank name", () => {
    const r = apply([{ op: "rename_day", dayIndex: 0, name: "   ", reason: because }]);
    expect(r.rejected[0].error).toMatch(/needs a name/);
  });
});

describe("sequencing and failure handling", () => {
  it("applies ops in order, each seeing the previous result", () => {
    const r = apply([
      { op: "remove_exercise", dayIndex: 0, position: 1, reason: because },
      {
        op: "insert_exercise",
        dayIndex: 0,
        position: 1,
        exerciseId: "incline",
        sets: 3,
        repLow: 8,
        repHigh: 12,
        reason: because,
      },
    ]);
    expect(r.applied).toHaveLength(2);
    expect(r.plan.days[0].exercises.map((e) => e.name)).toEqual([
      "Bench Press",
      "Incline Dumbbell Bench Press",
      "Bent Over Row",
    ]);
  });

  // The rule that matters most: a patch that quietly ignores half its
  // instructions is worse than one that fails loudly.
  it("never silently drops an op, and keeps going after one fails", () => {
    const r = apply([
      { op: "replace_exercise", dayIndex: 0, position: 0, exerciseId: "nope", reason: "bad" },
      { op: "set_prescription", dayIndex: 0, position: 1, sets: 5, reason: "good" },
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].op.reason).toBe("bad");
    expect(r.plan.days[0].exercises[1].sets).toBe(5);
  });

  it("rejects an op aimed at a day that does not exist", () => {
    const r = apply([{ op: "remove_exercise", dayIndex: 9, position: 0, reason: because }]);
    expect(r.rejected[0].error).toMatch(/no day 10/);
  });
});

describe("summarisePatch", () => {
  it("uses the single reason when there is one change", () => {
    expect(summarisePatch([{ op: "remove_exercise", dayIndex: 0, position: 0, reason: "Dropped the deadlift." }]))
      .toBe("Dropped the deadlift.");
  });

  it("says so plainly when nothing changed", () => {
    expect(summarisePatch([])).toBe("No changes.");
  });

  it("keeps the summary free of dashes, per house style", () => {
    const s = summarisePatch([
      { op: "remove_exercise", dayIndex: 0, position: 0, reason: "Removed one lift." },
      { op: "reorder", dayIndex: 0, fromPosition: 0, toPosition: 1, reason: "Moved another." },
    ]);
    expect(s).not.toMatch(/[—–]/);
  });
});

describe("patchFootprint", () => {
  // The founder asked that the weekly review adjust rather than rebuild. This
  // is how that gets measured instead of hoped for.
  it("is small for a single change", () => {
    expect(patchFootprint(plan(), [{ op: "remove_exercise", dayIndex: 0, position: 0, reason: because }]))
      .toBeCloseTo(1 / 3, 5);
  });

  it("counts a day rename as touching nothing", () => {
    expect(patchFootprint(plan(), [{ op: "rename_day", dayIndex: 0, name: "Push", reason: because }])).toBe(0);
  });

  it("does not double count two ops on the same exercise", () => {
    const ops: PlanOp[] = [
      { op: "set_prescription", dayIndex: 0, position: 0, sets: 4, reason: because },
      { op: "set_prescription", dayIndex: 0, position: 0, repLow: 6, reason: because },
    ];
    expect(patchFootprint(plan(), ops)).toBeCloseTo(1 / 3, 5);
  });
});

import { describe, it, expect } from "vitest";
import {
  buildPlannedSession,
  completedSetCount,
  isWorkoutDraft,
  isDraftSetComplete,
  mergePlannedIntoDraft,
  mergeScanIntoDraft,
  plannedSessionFingerprint,
  reconcileDraftUnits,
  repsWithinRange,
  saveableCompletedSets,
  targetLabel,
  type DraftEntry,
  type PlannedExercise,
  type PlannedSet,
  type WorkoutDraft,
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
    expect(ex.sets.every((set) => set.completed === false)).toBe(true);
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
  it("does not treat a fully prefilled planned row as performed", () => {
    expect(
      isDraftSetComplete({
        reps: "8",
        weight: "100",
        rpe: "8",
        origin: "plan",
      }),
    ).toBe(false);
  });

  it("keeps known manual and scanned work completed across the draft upgrade", () => {
    expect(
      isDraftSetComplete({ reps: "8", weight: "100", rpe: "8", origin: "manual" }),
    ).toBe(true);
    expect(
      isDraftSetComplete({ reps: "8", weight: "100", rpe: "", origin: "scan" }),
    ).toBe(true);
  });

  it("does not guess that a legacy origin-less row was performed", () => {
    expect(isDraftSetComplete({ reps: "8", weight: "100", rpe: "8" })).toBe(false);
  });

  it("lets an explicit completion choice override origin inference", () => {
    expect(
      isDraftSetComplete({
        reps: "8",
        weight: "100",
        rpe: "8",
        origin: "manual",
        completed: false,
      }),
    ).toBe(false);
    expect(
      isDraftSetComplete({ reps: "8", weight: "", rpe: "", completed: true }),
    ).toBe(true);
  });

  it("counts performed rows, not populated prescription rows", () => {
    expect(
      completedSetCount([
        { reps: "8", weight: "100", rpe: "8", origin: "plan" },
        { reps: "8", weight: "100", rpe: "8", origin: "manual" },
        { reps: "8", weight: "", rpe: "", completed: true },
      ]),
    ).toBe(2);
  });

  it("does not count a new empty manual row", () => {
    expect(
      completedSetCount([
        { reps: "", weight: "", rpe: "", origin: "manual", completed: false },
      ]),
    ).toBe(0);
  });

  it("keeps populated prescriptions out of the save payload until completed", () => {
    expect(
      saveableCompletedSets(
        [{ reps: "8", weight: "100", rpe: "8", origin: "plan" }],
        false,
      ),
    ).toEqual([]);
  });

  it("lets completed bodyweight work save with a blank added-weight field", () => {
    const set: PlannedSet = { reps: "8", weight: "", rpe: "8", completed: true };
    expect(saveableCompletedSets([set], true)).toEqual([set]);
    expect(saveableCompletedSets([set], false)).toEqual([]);
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

describe("mergePlannedIntoDraft", () => {
  // Found by opening Log, adding an exercise to today's plan on the Coach tab,
  // and coming back. The exercise was simply not there. Opening Log writes a
  // draft immediately, because the plan prefill itself counts as entries, so
  // this needed no typing to reproduce.
  const set = (): PlannedSet => ({ reps: "8", weight: "60", rpe: "9" });

  function plannedExercise(exerciseId: string, name = exerciseId): PlannedExercise {
    return {
      exerciseId,
      name,
      muscleGroup: "Chest",
      target: { sets: 3, repLow: 8, repHigh: 12, rpe: 9, restSeconds: null, role: null },
      sets: [set(), set(), set()],
      weightBasis: "no_history",
      note: null,
      repsAdjusted: "none",
      conflict: null,
    };
  }

  const draftEntry = (exerciseId: string): DraftEntry => ({
    key: `${exerciseId}-draft`,
    exerciseId,
    sets: [{ reps: "5", weight: "100", rpe: "8" }],
  });

  it("appends an exercise added to the plan after the draft was written", () => {
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench")],
      [plannedExercise("bench"), plannedExercise("facepull")],
      "2026-08-07",
      "2026-08-07",
    );
    expect(merged.map((e) => e.exerciseId)).toEqual(["bench", "facepull"]);
  });

  it("never touches work already in the draft", () => {
    // The whole reason this only adds. The athlete's typed sets outrank any
    // prescription.
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench")],
      [plannedExercise("bench")],
      "2026-08-07",
      "2026-08-07",
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].sets).toEqual([{ reps: "5", weight: "100", rpe: "8" }]);
  });

  it("keeps an exercise the athlete added by hand and the plan does not have", () => {
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench"), draftEntry("curl")],
      [plannedExercise("bench")],
      "2026-08-07",
      "2026-08-07",
    );
    expect(merged.map((e) => e.exerciseId)).toEqual(["bench", "curl"]);
  });

  it("keeps an exercise that was taken OFF the plan, deliberately", () => {
    // A legacy draft carries neither origin nor completion. Dropping the wrong
    // row loses real work, and a stale row is visible and removable while a
    // missing one is neither.
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench"), draftEntry("removed")],
      [plannedExercise("bench")],
      "2026-08-07",
      "2026-08-07",
    );
    expect(merged.map((e) => e.exerciseId)).toContain("removed");
  });

  it("refuses to mix yesterday's draft with today's plan", () => {
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench")],
      [plannedExercise("squat")],
      "2026-08-06",
      "2026-08-07",
    );
    expect(merged.map((e) => e.exerciseId)).toEqual(["bench"]);
  });

  it("merges when the draft carries no date at all", () => {
    const merged = mergePlannedIntoDraft(
      [draftEntry("bench")],
      [plannedExercise("squat")],
      null,
      "2026-08-07",
    );
    expect(merged.map((e) => e.exerciseId)).toEqual(["bench", "squat"]);
  });

  it("copies the planned sets rather than sharing them", () => {
    const planned = plannedExercise("facepull");
    const merged = mergePlannedIntoDraft([draftEntry("bench")], [planned], null, "2026-08-07");
    merged[1].sets[0].reps = "99";
    expect(planned.sets[0].reps).toBe("8");
  });
});

describe("mergeScanIntoDraft", () => {
  const planSet = (reps = "8", weight = "60"): PlannedSet => ({
    reps,
    weight,
    rpe: "9",
    origin: "plan",
  });
  const scanSet = (reps = "7", weight = "62.5"): PlannedSet => ({
    reps,
    weight,
    rpe: "",
    origin: "scan",
    completed: true,
  });
  const draft = (sets: PlannedSet[]): WorkoutDraft => ({
    date: "2026-08-08",
    notes: "working",
    entries: [{ key: "bench-plan", exerciseId: "bench", sets }],
  });

  it("replaces the next untouched plan slot instead of creating a duplicate set", () => {
    const result = mergeScanIntoDraft(
      draft([planSet(), planSet(), planSet()]),
      "bench",
      scanSet(),
    );
    expect(result.setNumber).toBe(1);
    expect(result.draft.entries[0].sets).toHaveLength(3);
    expect(result.draft.entries[0].sets[0]).toEqual(scanSet());
    expect(result.draft.entries[0].sets[1].origin).toBe("plan");
  });

  it("puts a repeated scan into the next untouched plan slot", () => {
    const first = mergeScanIntoDraft(
      draft([planSet(), planSet(), planSet()]),
      "bench",
      scanSet("7", "62.5"),
    );
    const second = mergeScanIntoDraft(first.draft, "bench", scanSet("6", "65"));
    expect(second.setNumber).toBe(2);
    expect(second.draft.entries[0].sets.map((set) => set.origin)).toEqual([
      "scan",
      "scan",
      "plan",
    ]);
    expect(second.draft.entries[0].sets[1].weight).toBe("65");
  });

  it("never overwrites manual or legacy rows when no plan slot remains", () => {
    const existing = draft([
      { reps: "5", weight: "100", rpe: "8", origin: "manual" },
      { reps: "6", weight: "95", rpe: "" },
    ]);
    const result = mergeScanIntoDraft(existing, "bench", scanSet());
    expect(result.setNumber).toBe(3);
    expect(result.draft.entries[0].sets).toEqual([
      { reps: "5", weight: "100", rpe: "8", origin: "manual" },
      { reps: "6", weight: "95", rpe: "" },
      scanSet(),
    ]);
  });

  it("finds an untouched plan slot even when a manual entry for the exercise comes first", () => {
    const existing: WorkoutDraft = {
      date: "2026-08-08",
      notes: "",
      entries: [
        {
          key: "bench-manual",
          exerciseId: "bench",
          sets: [{ reps: "5", weight: "70", rpe: "", origin: "manual" }],
        },
        { key: "bench-plan", exerciseId: "bench", sets: [planSet()] },
      ],
    };
    const result = mergeScanIntoDraft(existing, "bench", scanSet());
    expect(result.draft.entries[0].sets[0].origin).toBe("manual");
    expect(result.draft.entries[1].sets[0]).toEqual(scanSet());
  });

  it("adds a newly scanned exercise without losing the draft date or notes", () => {
    const existing = draft([planSet()]);
    const result = mergeScanIntoDraft(existing, "deadlift", scanSet());
    expect(result.setNumber).toBe(1);
    expect(result.draft.date).toBe("2026-08-08");
    expect(result.draft.notes).toBe("working");
    expect(result.draft.entries.map((entry) => entry.exerciseId)).toEqual([
      "bench",
      "deadlift",
    ]);
  });

  it("rejects a corrupt stored shape rather than letting Scan overwrite it", () => {
    expect(isWorkoutDraft({ date: "2026-08-08", notes: "", entries: "broken" })).toBe(false);
    expect(isWorkoutDraft(draft([planSet()]))).toBe(true);
  });
});

describe("reconcileDraftUnits", () => {
  const draftIn = (units?: "kg" | "lb"): WorkoutDraft => ({
    date: "2026-08-08",
    notes: "unit seam",
    units,
    entries: [
      {
        key: "bench-plan",
        exerciseId: "bench",
        sets: [
          { reps: "5", weight: "225", rpe: "8", origin: "manual" },
          { reps: "5", weight: "", rpe: "", origin: "plan" },
        ],
      },
    ],
  });

  it("converts pound draft weights before a kilogram Log can save them", () => {
    const source = draftIn("lb");
    const result = reconcileDraftUnits(source, "kg");
    expect(result.units).toBe("kg");
    expect(result.entries[0].sets[0].weight).toBe("102.06");
    expect(result.entries[0].sets[1].weight).toBe("");
    expect(source.entries[0].sets[0].weight).toBe("225");
  });

  it("converts kilogram draft weights before a pound Log can save them", () => {
    const source = draftIn("kg");
    source.entries[0].sets[0].weight = "100";
    const result = reconcileDraftUnits(source, "lb");
    expect(result.units).toBe("lb");
    expect(result.entries[0].sets[0].weight).toBe("220.46");
  });

  it("marks a legacy unit-less draft as current without guessing a conversion", () => {
    const result = reconcileDraftUnits(draftIn(), "lb");
    expect(result.units).toBe("lb");
    expect(result.entries[0].sets[0].weight).toBe("225");
  });

  it("rejects an unknown stored unit", () => {
    const invalid = { ...draftIn("kg"), units: "stone" };
    expect(isWorkoutDraft(invalid)).toBe(false);
    expect(isWorkoutDraft({ ...draftIn("kg"), planFingerprint: 7 })).toBe(false);
  });
});

describe("plannedSessionFingerprint", () => {
  it("is stable across kg and lb display values for the same physical plan", () => {
    const kg = buildPlannedSession(
      day(),
      [next({ target: { weight: 100, reps: 6, sets: 4 } })],
      "kg",
    );
    const lb = buildPlannedSession(
      day(),
      [next({ target: { weight: 220.46, reps: 6, sets: 4 } })],
      "lb",
    );
    expect(plannedSessionFingerprint(kg, "kg")).toBe(plannedSessionFingerprint(lb, "lb"));
  });

  it("changes when a plan edit changes the prescription", () => {
    const before = buildPlannedSession(day([planned({ rpe_target: 8 })]), [next()], "kg");
    const after = buildPlannedSession(day([planned({ rpe_target: 7 })]), [next()], "kg");
    expect(plannedSessionFingerprint(before, "kg")).not.toBe(
      plannedSessionFingerprint(after, "kg"),
    );
  });

  it("changes when a deload adapts the same plan", () => {
    const normal = buildPlannedSession(day(), [next()], "kg");
    const deload = buildPlannedSession(day(), [next()], "kg", { deload: true });
    expect(plannedSessionFingerprint(normal, "kg")).not.toBe(
      plannedSessionFingerprint(deload, "kg"),
    );
  });

  it("changes when the plan is edited while a deload is active", () => {
    const before = buildPlannedSession(
      day([planned({ sets: 4 })]),
      [next()],
      "kg",
      { deload: true },
    );
    const after = buildPlannedSession(
      day([planned({ sets: 5 })]),
      [next()],
      "kg",
      { deload: true },
    );
    expect(plannedSessionFingerprint(before, "kg")).not.toBe(
      plannedSessionFingerprint(after, "kg"),
    );
  });
});

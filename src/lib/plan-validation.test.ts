import { describe, expect, it } from "vitest";
import { prescriptionRange } from "@/lib/analytics/volume-landmarks";
import type {
  GeneratedPlan,
  GeneratedPlanExercise,
  PlanIntake,
} from "@/lib/plan-generation";
import {
  estimateSessionMinutes,
  exerciseConflictsWithAvoid,
  unmatchedAvoidTerms,
  validateGeneratedPlan,
} from "@/lib/plan-validation";
import type { Exercise } from "@/lib/types";

const intake: PlanIntake = {
  daysPerWeek: 1,
  sessionMinutes: 60,
  equipment: ["barbell", "bodyweight"],
  goal: "both",
  avoid: [],
  splitPreference: "full_body",
  note: null,
};

function libraryExercise(
  id: string,
  overrides: Partial<Exercise> = {},
): Exercise {
  return {
    id,
    user_id: null,
    name: "Squat",
    muscle_group: "Quads",
    movement_pattern: "Squat",
    equipment: "barbell",
    is_major: true,
    hidden: false,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function plannedExercise(
  exerciseId: string,
  overrides: Partial<GeneratedPlanExercise> = {},
): GeneratedPlanExercise {
  return {
    exercise_id: exerciseId,
    sets: 3,
    rep_low: 5,
    rep_high: 8,
    rpe_target: 8,
    rest_seconds: null,
    role: "primary",
    note: null,
    ...overrides,
  };
}

function plan(exercises: GeneratedPlanExercise[]): GeneratedPlan {
  return {
    name: "Measured Full Body",
    split: "full_body",
    mesocycle_weeks: 5,
    deload_week: 5,
    notes: null,
    days: [{ name: "Full Body A", focus: null, exercises }],
  };
}

describe("exerciseConflictsWithAvoid", () => {
  it("matches named exercises without fuzzy model judgment", () => {
    expect(
      exerciseConflictsWithAvoid(libraryExercise("squat"), ["Squats hurt my knees"]),
    ).toBe("Squats hurt my knees");
  });

  it("treats shoulder presses as overhead pressing without blocking bench press", () => {
    const shoulderPress = libraryExercise("shoulder", {
      name: "Shoulder Press",
      muscle_group: "Shoulders",
      movement_pattern: "Vertical Push",
    });
    const benchPress = libraryExercise("bench", {
      name: "Bench Press",
      muscle_group: "Chest",
      movement_pattern: "Horizontal Push",
    });

    expect(exerciseConflictsWithAvoid(shoulderPress, ["No overhead pressing"])).toBe(
      "No overhead pressing",
    );
    expect(exerciseConflictsWithAvoid(benchPress, ["No overhead pressing"])).toBeNull();
  });
});

describe("validateGeneratedPlan hard constraints", () => {
  it("accepts a visible exercise that uses selected equipment", () => {
    const result = validateGeneratedPlan(
      plan([plannedExercise("squat")]),
      intake,
      [libraryExercise("squat")],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing and hidden exercise rows", () => {
    const missing = validateGeneratedPlan(
      plan([plannedExercise("missing")]),
      intake,
      [libraryExercise("squat")],
    );
    const hidden = validateGeneratedPlan(
      plan([plannedExercise("hidden")]),
      intake,
      [libraryExercise("hidden", { hidden: true })],
    );

    expect(missing.errors.map((issue) => issue.code)).toContain("exercise_unavailable");
    expect(hidden.errors.map((issue) => issue.code)).toContain("exercise_unavailable");
  });

  it("rejects equipment outside the athlete's selection", () => {
    const result = validateGeneratedPlan(
      plan([plannedExercise("machine")]),
      intake,
      [libraryExercise("machine", { equipment: "machine" })],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "equipment_unavailable",
          exerciseId: "machine",
        }),
      ]),
    );
  });

  it("rejects an exercise that conflicts with the athlete's avoid list", () => {
    const shoulderPress = libraryExercise("shoulder", {
      name: "Shoulder Press",
      muscle_group: "Shoulders",
      movement_pattern: "Vertical Push",
    });
    const result = validateGeneratedPlan(
      plan([plannedExercise("shoulder")]),
      { ...intake, avoid: ["No overhead pressing"] },
      [shoulderPress],
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      severity: "error",
      code: "avoid_conflict",
      exerciseId: "shoulder",
    });
    expect(result.errors[0].message).toContain("No overhead pressing");
  });

  it("requires a deload week inside the mesocycle", () => {
    const generated = plan([plannedExercise("squat")]);
    generated.deload_week = 6;
    const result = validateGeneratedPlan(generated, intake, [libraryExercise("squat")]);
    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("deload_missing");
  });
});

describe("validateGeneratedPlan advisory checks", () => {
  it("reports landmark misses as warnings and never validates unsupported muscles", () => {
    const quads = prescriptionRange("Quads");
    expect(quads).not.toBeNull();
    const result = validateGeneratedPlan(
      plan([plannedExercise("squat", { sets: 1 })]),
      intake,
      [libraryExercise("squat")],
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "volume_below_target",
          muscle: "Quads",
        }),
      ]),
    );
    expect(result.warnings.some((issue) => issue.muscle === "Adductors")).toBe(false);
  });

  it("warns above the per-muscle target without blocking persistence", () => {
    const quads = prescriptionRange("Quads")!;
    const result = validateGeneratedPlan(
      plan([
        plannedExercise("squat", { sets: 12 }),
        plannedExercise("front-squat", { sets: quads.max - 11 }),
      ]),
      intake,
      [
        libraryExercise("squat"),
        libraryExercise("front-squat", { name: "Front Squat" }),
      ],
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "volume_above_target", muscle: "Quads" }),
      ]),
    );
  });

  it("uses the documented arithmetic and warns when a session runs long", () => {
    const longExercise = plannedExercise("squat", { sets: 12, rest_seconds: 300 });
    expect(estimateSessionMinutes([longExercise])).toBe(81);

    const result = validateGeneratedPlan(
      plan([longExercise]),
      { ...intake, sessionMinutes: 60 },
      [libraryExercise("squat")],
    );
    expect(result.valid).toBe(true);
    expect(result.sessionEstimates).toEqual([
      { dayIndex: 0, dayName: "Full Body A", minutes: 81 },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", code: "session_too_long" }),
      ]),
    );
  });
});

// F5 from docs/AUDIT_2026-07-30_pr4.md. The avoid matcher is a conjunctive AND
// over the restriction's words, so one word the library does not use disables
// the whole restriction. That failure used to be completely silent.
describe("unmatched avoid restrictions", () => {
  const library = [
    libraryExercise("squat", { name: "Squat", movement_pattern: "Squat", muscle_group: "Quads" }),
    libraryExercise("bench", {
      name: "Bench Press",
      movement_pattern: "Horizontal Push",
      muscle_group: "Chest",
    }),
    libraryExercise("ohp", {
      name: "Shoulder Press",
      movement_pattern: "Vertical Push",
      muscle_group: "Shoulders",
    }),
  ];

  it("reports nothing when every restriction matched something", () => {
    expect(unmatchedAvoidTerms(["squat"], library)).toEqual([]);
    expect(unmatchedAvoidTerms(["overhead press"], library)).toEqual([]);
  });

  // Naming a lift survives extra words, because a second match rule fires when
  // the exercise's whole name is contained in the restriction. This is the
  // mitigation that keeps the feature useful, and it is why the warning only
  // covers restrictions that name no lift at all.
  it("stays quiet when the restriction still names a lift, extra words and all", () => {
    expect(unmatchedAvoidTerms(["squat aggravates my knee"], library)).toEqual([]);
    expect(unmatchedAvoidTerms(["bench press hurts"], library)).toEqual([]);
  });

  // The measured case. A restriction built from category words plus filler
  // satisfies neither rule: no exercise name is a subset of it, and its own
  // tokens are not all present in any exercise's metadata.
  it("reports a category restriction that one ordinary word disabled", () => {
    expect(unmatchedAvoidTerms(["barbell"], library)).toEqual([]);
    expect(unmatchedAvoidTerms(["no barbell work"], library)).toEqual(["no barbell work"]);
  });

  it("reports natural phrasing that names a symptom rather than a lift", () => {
    expect(unmatchedAvoidTerms(["lower back pain"], library)).toEqual(["lower back pain"]);
    expect(unmatchedAvoidTerms(["shoulder impingement"], library)).toEqual([
      "shoulder impingement",
    ]);
  });

  it("ignores blank entries rather than warning about them", () => {
    expect(unmatchedAvoidTerms(["", "   "], library)).toEqual([]);
  });

  it("reports each unmatched restriction separately", () => {
    expect(unmatchedAvoidTerms(["squat", "lower back pain", "knee pain"], library)).toEqual([
      "lower back pain",
      "knee pain",
    ]);
  });
});

describe("validateGeneratedPlan surfaces unenforced restrictions", () => {
  const library = [libraryExercise("squat", { name: "Squat" })];
  const withAvoid = (avoid: string[]): PlanIntake => ({ ...intake, avoid });

  it("warns rather than blocking, since an unmatched term is unknown not violated", () => {
    const result = validateGeneratedPlan(
      plan([plannedExercise("squat")]),
      withAvoid(["lower back pain"]),
      library,
    );
    expect(result.valid).toBe(true);
    const issue = result.warnings.find((w) => w.code === "avoid_unmatched");
    expect(issue).toBeTruthy();
    expect(issue!.restriction).toBe("lower back pain");
    expect(issue!.message).toContain("not enforced");
    expect(result.unmatchedAvoid).toEqual(["lower back pain"]);
  });

  it("says nothing when the restriction was actually enforced", () => {
    const result = validateGeneratedPlan(
      plan([plannedExercise("squat")]),
      withAvoid(["deadlift"]),
      library,
    );
    // "deadlift" matches nothing in this one-exercise library, so it IS
    // unmatched. Use a restriction that does match to prove the quiet path.
    expect(result.unmatchedAvoid).toEqual(["deadlift"]);

    const enforced = validateGeneratedPlan(
      plan([plannedExercise("squat")]),
      withAvoid(["squat"]),
      library,
    );
    expect(enforced.unmatchedAvoid).toEqual([]);
    expect(enforced.warnings.some((w) => w.code === "avoid_unmatched")).toBe(false);
    // It matched, so it is a hard error instead.
    expect(enforced.errors.some((e) => e.code === "avoid_conflict")).toBe(true);
  });

  it("keeps the message free of dashes and exclamation points", () => {
    const result = validateGeneratedPlan(
      plan([plannedExercise("squat")]),
      withAvoid(["shoulder impingement"]),
      library,
    );
    const msg = result.warnings.find((w) => w.code === "avoid_unmatched")!.message;
    expect(msg).not.toMatch(/[—–]/);
    expect(msg).not.toContain("!");
  });
});

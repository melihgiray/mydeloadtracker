import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_TAGS,
  buildPlannerPrompt,
  buildPlannerRetryPrompt,
  filterExercisesForEquipment,
  parseGeneratedPlan,
  parsePlanIntake,
  referenceExercises,
  recentSessionFrequency,
  resolveExerciseReferences,
  toNewPlan,
  type GeneratedPlan,
  type PlanIntake,
  type PlannerSnapshot,
} from "@/lib/plan-generation";
import type { Exercise, TrainingSet } from "@/lib/types";

const intake: PlanIntake = {
  daysPerWeek: 1,
  sessionMinutes: 60,
  equipment: ["barbell", "bodyweight"],
  goal: "both",
  avoid: ["Overhead pressing"],
  splitPreference: "full_body",
  note: "Keep the warmup short.",
};

const generated: GeneratedPlan = {
  name: "Measured Full Body",
  split: "full_body",
  mesocycle_weeks: 5,
  deload_week: 5,
  notes: "Start conservatively.",
  days: [
    {
      name: "Full Body A",
      focus: "Squat, push, pull",
      exercises: [
        {
          exercise_id: "squat-id",
          sets: 3,
          rep_low: 5,
          rep_high: 8,
          rpe_target: 8,
          rest_seconds: 180,
          role: "primary",
          note: null,
        },
      ],
    },
  ],
};

const exercise = (id: string, equipment: string | null): Exercise => ({
  id,
  user_id: null,
  name: id,
  muscle_group: "Quads",
  movement_pattern: "Squat",
  equipment,
  is_major: true,
  hidden: false,
  created_at: "2026-07-01T00:00:00.000Z",
});

describe("parsePlanIntake", () => {
  it("accepts only the genuine intake gaps", () => {
    expect(parsePlanIntake(intake)).toEqual(intake);
  });

  it("requires at least one supported equipment option", () => {
    expect(() => parsePlanIntake({ ...intake, equipment: [] })).toThrow(/equipment/);
    expect(() => parsePlanIntake({ ...intake, equipment: ["teleporter"] })).toThrow(
      /unsupported equipment/,
    );
  });

  it("bounds availability rather than passing arbitrary values to the model", () => {
    expect(() => parsePlanIntake({ ...intake, daysPerWeek: 8 })).toThrow(/1 to 7/);
    expect(() => parsePlanIntake({ ...intake, sessionMinutes: 10 })).toThrow(/20 to 180/);
  });
});

describe("measured snapshot helpers", () => {
  it("filters the library strictly to selected equipment", () => {
    const library = [
      exercise("barbell", "barbell"),
      exercise("bodyweight", "bodyweight"),
      exercise("machine", "machine"),
      exercise("unknown", null),
    ];
    expect(filterExercisesForEquipment(library, ["barbell", "bodyweight"]).map((e) => e.id)).toEqual([
      "barbell",
      "bodyweight",
    ]);
  });

  it("derives recent session frequency from distinct measured sessions", () => {
    const base = {
      exerciseId: "squat-id",
      exerciseName: "Squat",
      muscleGroup: "Quads",
      isMajor: true,
      reps: 5,
      weight: 100,
      rpe: 8,
    };
    const sets: TrainingSet[] = [
      { ...base, sessionId: "s1", date: "2026-07-28T18:00:00.000Z" },
      { ...base, sessionId: "s1", date: "2026-07-28T18:00:00.000Z" },
      { ...base, sessionId: "s2", date: "2026-07-21T18:00:00.000Z" },
      { ...base, sessionId: "old", date: "2026-06-01T18:00:00.000Z" },
    ];
    expect(recentSessionFrequency(sets, new Date("2026-07-29T12:00:00.000Z"), 4)).toBe(0.5);
  });

  it("uses compact prompt references and resolves them to database IDs", () => {
    const library = [
      exercise("6ec2b603-f99b-4c58-9338-3b3dd903f202", "barbell"),
      exercise("9891df0e-2e08-4e43-87bb-d86cd37b9f64", "bodyweight"),
    ];
    const referenced = referenceExercises(library);
    expect(referenced.map((item) => item.reference)).toEqual(["e1", "e2"]);

    const referencedPlan: GeneratedPlan = {
      ...generated,
      days: [
        {
          ...generated.days[0],
          exercises: [{ ...generated.days[0].exercises[0], exercise_id: "e2" }],
        },
      ],
    };
    const resolved = resolveExerciseReferences(
      referencedPlan,
      new Map(referenced.map((item) => [item.reference, item.exercise.id])),
    );
    expect(resolved.days[0].exercises[0].exercise_id).toBe(library[1].id);
  });
});

describe("parseGeneratedPlan", () => {
  it("accepts a structured plan made only from allowed exercise ids", () => {
    expect(parseGeneratedPlan(generated, new Set(["squat-id"]), intake)).toEqual(generated);
  });

  it("rejects an exercise id the model invented", () => {
    expect(() => parseGeneratedPlan(generated, new Set(["bench-id"]), intake)).toThrow(
      /outside the available library/,
    );
  });

  it("rejects the wrong day count or requested split", () => {
    expect(() =>
      parseGeneratedPlan({ ...generated, days: [...generated.days, ...generated.days] }, new Set(["squat-id"]), intake),
    ).toThrow(/wrong number of days/);
    expect(() =>
      parseGeneratedPlan({ ...generated, split: "ppl" }, new Set(["squat-id"]), intake),
    ).toThrow(/requested split/);
  });

  it("rejects a reversed rep range before createPlan is called", () => {
    const reversed = {
      ...generated,
      days: [
        {
          ...generated.days[0],
          exercises: [{ ...generated.days[0].exercises[0], rep_low: 10, rep_high: 5 }],
        },
      ],
    };
    expect(() => parseGeneratedPlan(reversed, new Set(["squat-id"]), intake)).toThrow(
      /reversed rep range/,
    );
  });
});

describe("planner prompt and persistence mapping", () => {
  const snapshot: PlannerSnapshot = {
    loggedSets: 40,
    sessionsPerWeek: 3,
    currentSetsPerMuscle: [{ muscle: "Quads", setsPerWeek: 8, thisWeek: 3 }],
    strengthLevels: [{ lift: "Squat", level: "Intermediate", metric: "weight" }],
    muscleAssessment: [
      {
        muscle: "Biceps",
        strengthLabel: "Novice",
        basedOn: "Barbell Curl",
        setsPerWeek: 4,
        status: "lagging",
        lag: 0.9,
        reasons: ["Novice on Barbell Curl, about 0.9 levels behind the rest of your lifts."],
      },
    ],
    priorityMuscles: ["Biceps"],
    assessmentInsufficient: false,
    readiness: { score: 72, band: "Solid", topDrivers: [] },
    deload: { recommended: false, reasons: [] },
    landmarks: [
      { muscle: "Quads", canValidate: true, target: { min: 6, max: 20 } },
      { muscle: "Adductors", canValidate: false, target: null },
    ],
    evidenceCaveat: "Coach estimates, not trial results.",
    exercises: [
      {
        id: "e1",
        name: "Squat",
        muscleGroup: "Quads",
        equipment: "barbell",
        isMajor: true,
      },
    ],
  };

  it("keeps unsupported landmark targets explicitly null in the prompt", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toContain('"muscle": "Adductors"');
    expect(prompt).toContain('"target": null');
    expect(prompt).toContain("compact references such as e1");
    expect(prompt).toContain('"id": "e1"');
    expect(prompt).toContain("Do not replace null with a plausible number");
    expect(prompt).toContain(snapshot.evidenceCaveat);
  });

  it("maps generated output to createPlan without adding a weight field", () => {
    const plan = toNewPlan(intake, generated);
    expect(plan).toMatchObject({
      goal: "both",
      split: "full_body",
      days_per_week: 1,
      session_minutes: 60,
      equipment: ["barbell", "bodyweight"],
      avoid: ["Overhead pressing"],
      deload_week: 5,
    });
    expect(plan.days[0].exercises[0]).not.toHaveProperty("weight");
  });

  it("names the rejected constraint when asking for one regeneration", () => {
    const retry = buildPlannerRetryPrompt(
      buildPlannerPrompt(intake, snapshot),
      "Full Body A uses Shoulder Press, which conflicts with no overhead pressing.",
    );
    expect(retry).toContain("REGENERATION_REQUIRED");
    expect(retry).toContain("Full Body A uses Shoulder Press");
    expect(retry).toContain("All original rules still apply");
  });
});

// Found by running the route end to end against production: the model reliably
// wrote plan notes past the cap, every candidate was rejected, and the retry
// pushed the request past the 60s function ceiling. A wordy summary must never
// cost the athlete a whole plan.
describe("model prose is trimmed, not rejected", () => {
  const long = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);
  const ids = new Set(["squat-id"]);
  // parseGeneratedPlan reads a raw candidate, so start from the typed fixture
  // and widen it rather than hand-rolling a second shape.
  const candidate = (over: Record<string, unknown> = {}) =>
    JSON.parse(JSON.stringify({ ...generated, ...over })) as Record<string, unknown>;

  it("accepts a plan whose notes run past the limit", () => {
    const parsed = parseGeneratedPlan(candidate({ notes: long(2000) }), ids, intake);
    expect(parsed.notes).toBeTruthy();
    expect(parsed.notes!.length).toBeLessThanOrEqual(500);
  });

  it("accepts an over-long exercise note and day focus", () => {
    const c = candidate();
    (c.days as any)[0].focus = long(900);
    (c.days as any)[0].exercises[0].note = long(900);
    const parsed = parseGeneratedPlan(c, ids, intake);
    expect(parsed.days[0].focus!.length).toBeLessThanOrEqual(160);
    expect(parsed.days[0].exercises[0].note!.length).toBeLessThanOrEqual(240);
  });

  it("leaves prose that already fits completely untouched", () => {
    const parsed = parseGeneratedPlan(candidate({ notes: "Short and useful." }), ids, intake);
    expect(parsed.notes).toBe("Short and useful.");
  });

  it("cuts on a word boundary, so the text reads as a sentence that stops", () => {
    const parsed = parseGeneratedPlan(candidate({ notes: long(2000) }), ids, intake);
    expect(parsed.notes).not.toMatch(/\s$/);
  });

  it("still refuses a structural violation, which is not cosmetic", () => {
    expect(() => parseGeneratedPlan(candidate({ days: [] }), ids, intake)).toThrow();
  });
});

// The founder's complaint, as a contract on the prompt: the plan put compounds
// before arm work, which is why the arms lagged. The model cannot fix that
// unless it is told both which muscles lag and what to do about the order.
describe("the prompt carries the weak-point assessment", () => {
  const snapshot: PlannerSnapshot = {
    loggedSets: 40,
    sessionsPerWeek: 4,
    currentSetsPerMuscle: [{ muscle: "Biceps", setsPerWeek: 4, thisWeek: 2 }],
    strengthLevels: [{ lift: "Squat", level: "Intermediate", metric: "weight" }],
    muscleAssessment: [
      {
        muscle: "Biceps",
        strengthLabel: "Novice",
        basedOn: "Barbell Curl",
        setsPerWeek: 4,
        status: "lagging",
        lag: 0.9,
        reasons: ["Novice on Barbell Curl, about 0.9 levels behind the rest of your lifts."],
      },
    ],
    priorityMuscles: ["Biceps"],
    assessmentInsufficient: false,
    readiness: { score: 72, band: "Solid", topDrivers: [] },
    deload: { recommended: false, reasons: [] },
    landmarks: [{ muscle: "Biceps", canValidate: true, target: { min: 8, max: 20 } }],
    evidenceCaveat: "Coach estimates, not trial results.",
    exercises: [
      { id: "e1", name: "Barbell Curl", muscleGroup: "Biceps", equipment: "barbell", isMajor: false },
    ],
  };

  it("names the priority muscles it was given", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toContain("Biceps");
    expect(prompt).toContain("priorityMuscles");
  });

  it("tells the model to open a day with the lagging muscle's direct work", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toMatch(/ORDER WITHIN EACH DAY/);
    expect(prompt).toMatch(/before the compounds that fatigue it/);
  });

  it("tells the model to move sets rather than inflate total volume", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toMatch(/move sets from leading muscles to lagging ones/);
  });

  it("forbids asking the athlete what is already computed", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toMatch(/do not ask them what is weak/);
  });

  it("carries the reason a muscle was flagged, so the plan can explain itself", () => {
    const prompt = buildPlannerPrompt(intake, snapshot);
    expect(prompt).toContain("Barbell Curl");
  });
});

describe("equipment options suit the audience", () => {
  it("no longer offers kettlebells", () => {
    expect(EQUIPMENT_TAGS).not.toContain("kettlebell" as never);
  });

  it("keeps the equipment a gym lifter actually uses", () => {
    for (const tag of ["barbell", "dumbbell", "machine", "cable", "bodyweight"]) {
      expect(EQUIPMENT_TAGS).toContain(tag as never);
    }
  });
});

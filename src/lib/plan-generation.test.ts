import { describe, expect, it } from "vitest";
import {
  buildPlannerPrompt,
  buildPlannerRetryPrompt,
  filterExercisesForEquipment,
  parseGeneratedPlan,
  parsePlanIntake,
  recentSessionFrequency,
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
    readiness: { score: 72, band: "Solid", topDrivers: [] },
    deload: { recommended: false, reasons: [] },
    landmarks: [
      { muscle: "Quads", canValidate: true, target: { min: 6, max: 20 } },
      { muscle: "Adductors", canValidate: false, target: null },
    ],
    evidenceCaveat: "Coach estimates, not trial results.",
    exercises: [
      {
        id: "squat-id",
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

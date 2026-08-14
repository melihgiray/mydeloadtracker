import { describe, it, expect } from "vitest";
import {
  parseIntakeTurn,
  missingEssentials,
  completeIntake,
  resolveInterviewLifts,
} from "@/lib/plan-intake";
import type { Exercise } from "@/lib/types";

// Minimal library covering an exact name, an aliased name, and a hidden entry.
const LIBRARY = [
  { id: "sq", name: "Squat", muscle_group: "Quads", hidden: false },
  { id: "bc", name: "Barbell Curl", muscle_group: "Biceps", hidden: false },
  { id: "rdl", name: "Romanian Deadlift", muscle_group: "Hamstrings", hidden: false },
  { id: "old", name: "Retired Lift", muscle_group: "Chest", hidden: true },
] as unknown as Exercise[];

describe("parseIntakeTurn", () => {
  it("extracts a full, valid intake and trims the reply", () => {
    const turn = parseIntakeTurn({
      reply: "  Got it, building a 4-day strength plan.  ",
      ready: true,
      goal: "strength",
      daysPerWeek: 4,
      sessionMinutes: 75,
      equipment: ["barbell", "dumbbell"],
      splitPreference: "upper_lower",
      trainingStyle: "few_hard",
      avoid: ["  Deadlift  "],
      note: "bad left knee",
    });
    expect(turn.reply).toBe("Got it, building a 4-day strength plan.");
    expect(turn.modelReady).toBe(true);
    expect(turn.intake).toEqual({
      goal: "strength",
      daysPerWeek: 4,
      sessionMinutes: 75,
      equipment: ["barbell", "dumbbell"],
      splitPreference: "upper_lower",
      trainingStyle: "few_hard",
      avoid: ["Deadlift"],
      note: "bad left knee",
    });
  });

  it("drops invalid enums and out-of-range numbers, never guessing", () => {
    const turn = parseIntakeTurn({
      reply: "ok",
      ready: false,
      goal: "bulk", // not a real goal
      daysPerWeek: 9, // out of 1-7
      sessionMinutes: 5, // below 20
      equipment: ["barbell", "spaceship"], // one invalid
      splitPreference: "nonsense",
      trainingStyle: "insane",
    });
    expect(turn.intake).toEqual({ equipment: ["barbell"] });
    expect(turn.modelReady).toBe(false);
  });

  it("dedupes equipment and coerces a non-string reply to empty", () => {
    const turn = parseIntakeTurn({ reply: 42, equipment: ["cable", "cable", "machine"] });
    expect(turn.reply).toBe("");
    expect(turn.intake.equipment).toEqual(["cable", "machine"]);
  });

  it("caps the avoid list and its entries", () => {
    const turn = parseIntakeTurn({
      reply: "ok",
      avoid: Array.from({ length: 20 }, (_, i) => `move ${i}`),
    });
    expect(turn.intake.avoid).toHaveLength(12);
  });

  it("captures reported lifts and drops malformed rows", () => {
    const turn = parseIntakeTurn({
      reply: "ok",
      lifts: [
        { exercise: "Bench Press", weight: 100, reps: 5 },
        { exercise: "Squat", weight: "heavy", reps: 5 }, // weight not a number
        { exercise: "", weight: 60, reps: 8 }, // empty name
        { exercise: "Barbell Curl", weight: 40, reps: 10 },
      ],
    });
    expect(turn.lifts).toEqual([
      { exercise: "Bench Press", weight: 100, reps: 5 },
      { exercise: "Barbell Curl", weight: 40, reps: 10 },
    ]);
  });

  it("defaults lifts to an empty array when none are given", () => {
    expect(parseIntakeTurn({ reply: "ok" }).lifts).toEqual([]);
  });
});

describe("resolveInterviewLifts", () => {
  it("matches by exact name and by alias, carrying the muscle group", () => {
    const resolved = resolveInterviewLifts(
      [
        { exercise: "squat", weight: 140, reps: 3 }, // exact, case-insensitive
        { exercise: "bb curl", weight: 40, reps: 10 }, // alias of Barbell Curl
      ],
      LIBRARY,
    );
    expect(resolved).toEqual([
      { exerciseId: "sq", name: "Squat", muscleGroup: "Quads", weight: 140, reps: 3 },
      { exerciseId: "bc", name: "Barbell Curl", muscleGroup: "Biceps", weight: 40, reps: 10 },
    ]);
  });

  it("drops unknown lifts and hidden library entries rather than guessing", () => {
    const resolved = resolveInterviewLifts(
      [
        { exercise: "Jefferson Curl", weight: 20, reps: 10 }, // not in library
        { exercise: "Retired Lift", weight: 50, reps: 5 }, // hidden
      ],
      LIBRARY,
    );
    expect(resolved).toEqual([]);
  });

  it("dedupes by exercise, keeping the first mention, and rejects bad numbers", () => {
    const resolved = resolveInterviewLifts(
      [
        { exercise: "Squat", weight: 140, reps: 3 },
        { exercise: "squat", weight: 999, reps: 1 }, // duplicate exercise
        { exercise: "Barbell Curl", weight: -5, reps: 10 }, // non-positive weight
        { exercise: "Romanian Deadlift", weight: 120, reps: 8.5 }, // non-integer reps
      ],
      LIBRARY,
    );
    expect(resolved).toEqual([
      { exerciseId: "sq", name: "Squat", muscleGroup: "Quads", weight: 140, reps: 3 },
    ]);
  });
});

describe("missingEssentials", () => {
  it("lists all essentials when the intake is empty", () => {
    expect(missingEssentials({})).toEqual(["goal", "daysPerWeek", "equipment"]);
  });

  it("is empty once goal, days, and equipment are known", () => {
    expect(
      missingEssentials({ goal: "both", daysPerWeek: 3, equipment: ["dumbbell"] }),
    ).toEqual([]);
  });

  it("still flags empty equipment", () => {
    expect(missingEssentials({ goal: "both", daysPerWeek: 3, equipment: [] })).toEqual([
      "equipment",
    ]);
  });
});

describe("completeIntake", () => {
  it("returns null until the essentials are present", () => {
    expect(completeIntake({ goal: "strength", daysPerWeek: 4 })).toBeNull();
  });

  it("fills safe defaults for the non-essential fields", () => {
    expect(
      completeIntake({ goal: "hypertrophy", daysPerWeek: 5, equipment: ["barbell"] }),
    ).toEqual({
      daysPerWeek: 5,
      sessionMinutes: 60,
      equipment: ["barbell"],
      goal: "hypertrophy",
      avoid: [],
      splitPreference: "auto",
      trainingStyle: null,
      note: null,
    });
  });
});

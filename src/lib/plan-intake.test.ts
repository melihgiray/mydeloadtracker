import { describe, it, expect } from "vitest";
import {
  parseIntakeTurn,
  missingEssentials,
  completeIntake,
} from "@/lib/plan-intake";

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

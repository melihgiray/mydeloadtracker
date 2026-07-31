import { describe, it, expect } from "vitest";
import { sameStimulus, stimulusKey, systemicCost } from "@/lib/exercise-profile";
import type { Exercise } from "@/lib/types";

// Real library rows. Both functions read name, muscle_group and
// movement_pattern, so a fabricated row would prove nothing about the rules.
const ex = (
  name: string,
  muscle_group: string,
  movement_pattern: string | null,
  equipment: string | null = "barbell",
): Exercise => ({
  id: name,
  user_id: null,
  name,
  muscle_group,
  movement_pattern,
  equipment,
  is_major: false,
  hidden: false,
  created_at: "2026-07-01T00:00:00.000Z",
});

describe("systemicCost", () => {
  it("calls an axially loaded barbell lift high", () => {
    expect(systemicCost(ex("Deadlift", "Back", "Hinge"))).toBe("high");
    expect(systemicCost(ex("Squat", "Quads", "Squat"))).toBe("high");
    expect(systemicCost(ex("Good Morning", "Hamstrings", "Hinge"))).toBe("high");
  });

  it("calls Olympic work high on the pattern alone", () => {
    expect(systemicCost(ex("Power Clean", "Back", "Olympic"))).toBe("high");
  });

  // The whole point of the distinction: same joints, spine supported.
  it("drops the supported version of a heavy pattern to moderate", () => {
    expect(systemicCost(ex("Sled Leg Press", "Quads", "Squat", "machine"))).toBe("moderate");
    expect(systemicCost(ex("Smith Machine Squat", "Quads", "Squat", "machine"))).toBe("moderate");
  });

  it("calls unsupported multi-joint work moderate", () => {
    expect(systemicCost(ex("Bench Press", "Chest", "Horizontal Push"))).toBe("moderate");
    expect(systemicCost(ex("Pull Ups", "Back", "Vertical Pull", "bodyweight"))).toBe("moderate");
  });

  it("calls single-joint and machine isolation low", () => {
    expect(systemicCost(ex("Tricep Pushdown", "Triceps", "Elbow Extension", "cable"))).toBe("low");
    expect(systemicCost(ex("Leg Extension", "Quads", "Knee Extension", "machine"))).toBe("low");
    expect(systemicCost(ex("Dumbbell Lateral Raise", "Shoulders", "Abduction", "dumbbell"))).toBe("low");
  });

  // Caught by probing the real library: a name-token match alone called all of
  // these high, and none of them is axially loaded.
  it("does not call a lift high just because its name contains a heavy word", () => {
    expect(systemicCost(ex("Sissy Squat", "Quads", "Squat", "bodyweight"))).not.toBe("high");
    expect(systemicCost(ex("Snatch-Grip Shrug", "Traps", "Shrug"))).not.toBe("high");
    expect(systemicCost(ex("Kettlebell Deadlift", "Hamstrings", "Hinge", "kettlebell"))).not.toBe("high");
  });

  it("returns null rather than guessing when the pattern is missing", () => {
    expect(systemicCost(ex("Mystery Lift", "Chest", null))).toBeNull();
  });
});

describe("stimulusKey", () => {
  // The founder's actual complaint. The first generated plan carried Bench
  // Press on one day and Dumbbell Bench Press on another.
  it("treats a barbell and a dumbbell flat press as the same stimulus", () => {
    expect(
      sameStimulus(
        ex("Bench Press", "Chest", "Horizontal Push"),
        ex("Dumbbell Bench Press", "Chest", "Horizontal Push", "dumbbell"),
      ),
    ).toBe(true);
  });

  // ...but incline is genuinely a different stimulus, so a plan may carry both.
  // Whether it SHOULD prefer incline is a preference, handled elsewhere.
  it("separates incline from flat", () => {
    expect(
      sameStimulus(
        ex("Bench Press", "Chest", "Horizontal Push"),
        ex("Incline Dumbbell Bench Press", "Chest", "Horizontal Push", "dumbbell"),
      ),
    ).toBe(false);
  });

  it("separates a press from a fly at the same angle", () => {
    expect(
      sameStimulus(
        ex("Bench Press", "Chest", "Horizontal Push"),
        ex("Dumbbell Fly", "Chest", "Horizontal Push", "dumbbell"),
      ),
    ).toBe(false);
  });

  it("groups every pulldown and pull-up variant together", () => {
    const key = stimulusKey(ex("Lat Pulldown", "Back", "Vertical Pull", "machine"));
    expect(stimulusKey(ex("Pull Ups", "Back", "Vertical Pull", "bodyweight"))).toBe(key);
    expect(stimulusKey(ex("Neutral Grip Pull Ups", "Back", "Vertical Pull", "bodyweight"))).toBe(key);
    expect(stimulusKey(ex("Chin Ups", "Back", "Vertical Pull", "bodyweight"))).toBe(key);
  });

  it("groups rear delt work whatever the name calls it", () => {
    const key = stimulusKey(ex("Rear Delt Fly", "Shoulders", "Horizontal Pull", "dumbbell"));
    expect(stimulusKey(ex("Face Pull", "Shoulders", "Horizontal Pull", "cable"))).toBe(key);
    expect(stimulusKey(ex("Cable Rear Delt Row", "Shoulders", "Horizontal Pull", "cable"))).toBe(key);
  });

  it("keeps a leg curl away from a biceps curl", () => {
    const leg = stimulusKey(ex("Lying Leg Curl", "Hamstrings", "Knee Flexion", "machine"));
    const arm = stimulusKey(ex("Barbell Curl", "Biceps", "Elbow Flexion"));
    expect(leg).not.toBe(arm);
    expect(leg).toMatch(/knee-flexion/);
  });

  it("splits curl variants that work the muscle at different lengths", () => {
    const straight = stimulusKey(ex("Barbell Curl", "Biceps", "Elbow Flexion"));
    const hammer = stimulusKey(ex("Hammer Curl", "Biceps", "Elbow Flexion", "dumbbell"));
    const preacher = stimulusKey(ex("Preacher Curl", "Biceps", "Elbow Flexion"));
    expect(new Set([straight, hammer, preacher]).size).toBe(3);
  });

  it("returns null when no rule matches, and null never counts as a match", () => {
    const plank = ex("Plank", "Core", "Anti-Extension", "bodyweight");
    const deadBug = ex("Dead Bug", "Core", "Anti-Extension", "bodyweight");
    expect(stimulusKey(plank)).toBeNull();
    // Two unclassifiable lifts are not evidence of redundancy.
    expect(sameStimulus(plank, deadBug)).toBe(false);
  });

  it("never merges across muscle groups", () => {
    expect(
      sameStimulus(
        ex("Bench Press", "Chest", "Horizontal Push"),
        ex("Close Grip Bench Press", "Triceps", "Horizontal Push"),
      ),
    ).toBe(false);
  });
});
